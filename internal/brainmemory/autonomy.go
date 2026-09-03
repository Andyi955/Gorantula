package brainmemory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Andyi955/Gorantula/models"
)

const (
	autonomySettingsFilename = "autonomy_settings.json"
	autonomyQueueFilename    = "autonomy_queue.json"
	autonomyAuditFilename    = "autonomy_audit.json"

	autonomyStrongMemoryThreshold        = 0.78
	autonomyPossibleBridgeHighConfidence = 0.86

	AutonomyModeOff               = "off"
	AutonomyModeSuggestOnly       = "suggest-only"
	AutonomyModePrepareOnly       = "prepare-only"
	AutonomyModeAskBeforeLaunch   = "ask-before-launch"
	AutonomyModeLimitedBackground = "limited-background"

	AutonomyDecisionPrepared     = "prepared"
	AutonomyDecisionWouldPrepare = "would-prepare"
	AutonomyDecisionBlocked      = "blocked"

	AutonomyQueueStatusPrepared = "prepared"
	AutonomyQueueStatusWaiting  = "waiting"
	AutonomyQueueStatusBlocked  = "blocked"

	AutonomyBlockerUnresolvedGap           = "unresolved-gap"
	AutonomyBlockerUnresolvedContradiction = "unresolved-contradiction"
	AutonomyBlockerDuplicateFollowUp       = "duplicate-follow-up"
	AutonomyBlockerInvestigationBudget     = "investigation-budget"
	AutonomyBlockerActivePreparedBudget    = "active-prepared-budget"
	AutonomyBlockerUnsafeRelevance         = "unsafe-relevance"
)

var ErrInvalidAutonomySettings = errors.New("invalid brain autonomy settings")

type BrainAutonomySettings struct {
	Mode                            string `json:"mode"`
	MaxAutoPreparedPerInvestigation int    `json:"maxAutoPreparedPerInvestigation"`
	MaxActivePrepared               int    `json:"maxActivePrepared"`
	UpdatedAt                       string `json:"updatedAt,omitempty"`
}

type BrainAutonomyQueueItem struct {
	ID                     string   `json:"id"`
	InvestigationID        string   `json:"investigationId"`
	SuggestionID           string   `json:"suggestionId"`
	ActionID               string   `json:"actionId,omitempty"`
	Decision               string   `json:"decision"`
	Status                 string   `json:"status"`
	Mode                   string   `json:"mode"`
	Title                  string   `json:"title"`
	Summary                string   `json:"summary"`
	Score                  float64  `json:"score"`
	Relevance              string   `json:"relevance,omitempty"`
	Reason                 string   `json:"reason"`
	Blockers               []string `json:"blockers"`
	ApprovalRequired       bool     `json:"approvalRequired"`
	TargetInvestigationIDs []string `json:"targetInvestigationIds"`
	// Stream provenance: which live signals and gateway drove this decision.
	SourceSignalIds []string `json:"sourceSignalIds"`
	Gateway         string   `json:"gateway,omitempty"`
	GatewayLabel    string   `json:"gatewayLabel,omitempty"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
}

type BrainAutonomyAuditEntry struct {
	ID               string   `json:"id"`
	QueueItemID      string   `json:"queueItemId"`
	InvestigationID  string   `json:"investigationId"`
	SuggestionID     string   `json:"suggestionId"`
	ActionID         string   `json:"actionId,omitempty"`
	Decision         string   `json:"decision"`
	Mode             string   `json:"mode"`
	Reason           string   `json:"reason"`
	Blockers         []string `json:"blockers"`
	ApprovalRequired bool     `json:"approvalRequired"`
	SourceSignalIds  []string `json:"sourceSignalIds"`
	CreatedAt        string   `json:"createdAt"`
}

type BrainAutonomyState struct {
	Settings BrainAutonomySettings     `json:"settings"`
	Queue    []BrainAutonomyQueueItem  `json:"queue"`
	Audit    []BrainAutonomyAuditEntry `json:"audit"`
}

func (s *Service) AutonomyForInvestigation(investigationID string) (BrainAutonomyState, error) {
	investigationID = strings.TrimSpace(investigationID)
	if !models.ValidInvestigationID(investigationID) {
		return BrainAutonomyState{}, models.ErrInvalidInvestigationID
	}
	if _, err := s.store.LoadMetadata(investigationID); err != nil {
		return BrainAutonomyState{}, err
	}

	settings, err := s.loadAutonomySettings()
	if err != nil {
		return BrainAutonomyState{}, err
	}
	queue, err := s.loadAutonomyQueue()
	if err != nil {
		return BrainAutonomyState{}, err
	}
	audit, err := s.loadAutonomyAudit()
	if err != nil {
		return BrainAutonomyState{}, err
	}

	return BrainAutonomyState{
		Settings: settings,
		Queue:    autonomyQueueForInvestigation(queue, investigationID),
		Audit:    autonomyAuditForInvestigation(audit, investigationID),
	}, nil
}

// reevaluateAutonomyFromPersistedSuggestions rebuilds the autonomy decision
// from the suggestions already persisted for an investigation. Read-path safe:
// unlike the full recompute pass it never parses boards.
func (s *Service) reevaluateAutonomyFromPersistedSuggestions(investigationID string) error {
	suggestions, err := s.loadSuggestions()
	if err != nil {
		return err
	}
	visible := make([]BrainSuggestion, 0)
	for _, suggestion := range suggestions {
		if suggestion.InvestigationID != investigationID || suggestion.Status == SuggestionStatusDismissed {
			continue
		}
		visible = append(visible, normalizeSuggestionCollections(suggestion))
	}
	sortSuggestions(visible)
	return s.evaluateAutonomyForInvestigation(investigationID, visible, time.Now().UTC().Format(time.RFC3339))
}

func (s *Service) UpdateAutonomySettings(settings BrainAutonomySettings) (BrainAutonomySettings, error) {
	settings = normalizeAutonomySettings(settings)
	if !validAutonomyMode(settings.Mode) {
		return BrainAutonomySettings{}, ErrInvalidAutonomySettings
	}
	settings.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := s.saveAutonomySettings(settings); err != nil {
		return BrainAutonomySettings{}, err
	}

	// Re-apply the new mode immediately across every investigation so flipping
	// the switch updates queues and prepared actions without waiting for the
	// next evidence event or panel refresh.
	records, err := s.store.List()
	if err != nil {
		return BrainAutonomySettings{}, err
	}
	for _, record := range records {
		if err := s.reevaluateAutonomyFromPersistedSuggestions(record.ID); err != nil {
			return BrainAutonomySettings{}, err
		}
	}
	return settings, nil
}

func (s *Service) evaluateAutonomyForInvestigation(investigationID string, suggestions []BrainSuggestion, timestamp string) error {
	settings, err := s.loadAutonomySettings()
	if err != nil {
		return err
	}
	if settings.Mode == AutonomyModeOff {
		return nil
	}

	candidates := launchReadyAutonomySuggestions(suggestions)
	if len(candidates) == 0 {
		return nil
	}

	queue, err := s.loadAutonomyQueue()
	if err != nil {
		return err
	}
	audit, err := s.loadAutonomyAudit()
	if err != nil {
		return err
	}
	followUps, err := s.loadFollowUps()
	if err != nil {
		return err
	}

	suggestions, err = s.autonomyPreflightBlockerSuggestions(suggestions, timestamp)
	if err != nil {
		return err
	}

	// Evaluate every launch-ready candidate in rank order, not just the
	// first. Budgets re-check per candidate because each preparation
	// consumes them: a scan whose stream surfaces several qualified
	// suggestions prepares up to MaxAutoPreparedPerInvestigation /
	// MaxActivePrepared and records an audited decision for the rest.
	for _, candidate := range candidates {
		item := buildAutonomyQueueItem(candidate, settings, timestamp)
		if previous, exists := queue[item.ID]; exists {
			// A prepared follow-up stays prepared: the operator owns
			// approval, and re-evaluating would flip the item to blocked
			// on its own now-existing follow-up.
			if previous.Decision == AutonomyDecisionPrepared && previous.Status == AutonomyQueueStatusPrepared {
				continue
			}
		}

		blockers := autonomyBlockers(candidate, suggestions, followUps, queue, settings, investigationID)
		item.Blockers = blockers

		switch {
		case len(blockers) > 0:
			item.Decision = AutonomyDecisionBlocked
			item.Status = AutonomyQueueStatusBlocked
			item.Reason = "Autonomy did not prepare this follow-up because safety blockers are still active."
		case settings.Mode == AutonomyModeSuggestOnly || settings.Mode == AutonomyModeLimitedBackground:
			item.Decision = AutonomyDecisionWouldPrepare
			item.Status = AutonomyQueueStatusWaiting
			item.Reason = "Autonomy would prepare this focused follow-up, but the current mode does not permit V16 preparation."
		default:
			action, err := s.PrepareFollowUp(PrepareFollowUpRequest{
				InvestigationID: investigationID,
				SourceKind:      FollowUpSourceSuggestion,
				SourceID:        candidate.ID,
			})
			if err != nil {
				return err
			}
			item.ActionID = action.ID
			item.Decision = AutonomyDecisionPrepared
			item.Status = AutonomyQueueStatusPrepared
			item.ApprovalRequired = true
			item.Reason = "Autonomy prepared one focused follow-up. Review and approve it before launching; no Rabbit Hole starts automatically."
			// Reload so the next candidate's duplicate and budget checks
			// see this preparation.
			followUps, err = s.loadFollowUps()
			if err != nil {
				return err
			}
		}

		// Unchanged decisions are not re-saved - recomputes run on every
		// evidence event and the queue/audit only needs a new entry when
		// the decision actually changed.
		if previous, exists := queue[item.ID]; exists &&
			previous.Decision == item.Decision &&
			previous.Status == item.Status &&
			previous.ActionID == item.ActionID &&
			strings.Join(previous.Blockers, ",") == strings.Join(item.Blockers, ",") {
			continue
		}
		if err := s.saveAutonomyDecision(queue, audit, item); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) saveAutonomyDecision(
	queue map[string]BrainAutonomyQueueItem,
	audit map[string]BrainAutonomyAuditEntry,
	item BrainAutonomyQueueItem,
) error {
	previous := queue[item.ID]
	if strings.TrimSpace(previous.CreatedAt) != "" {
		item.CreatedAt = previous.CreatedAt
	}
	item = normalizeAutonomyQueueItem(item)
	queue[item.ID] = item

	entry := BrainAutonomyAuditEntry{
		ID:               deterministicID("brain-autonomy-audit", item.ID, item.Decision, item.ActionID, strings.Join(item.Blockers, ",")),
		QueueItemID:      item.ID,
		InvestigationID:  item.InvestigationID,
		SuggestionID:     item.SuggestionID,
		ActionID:         item.ActionID,
		Decision:         item.Decision,
		Mode:             item.Mode,
		Reason:           item.Reason,
		Blockers:         cleanStringSet(item.Blockers),
		ApprovalRequired: item.ApprovalRequired,
		SourceSignalIds:  cleanStringSet(item.SourceSignalIds),
		CreatedAt:        item.UpdatedAt,
	}
	audit[entry.ID] = entry

	if err := s.saveAutonomyQueue(queue); err != nil {
		return err
	}
	return s.saveAutonomyAudit(audit)
}

func (s *Service) autonomyPreflightBlockerSuggestions(suggestions []BrainSuggestion, timestamp string) ([]BrainSuggestion, error) {
	existing, err := s.loadSuggestions()
	if err != nil {
		return nil, err
	}

	changed := false
	for index, suggestion := range suggestions {
		// Evidence resolver: a needs-source suggestion resolves itself when
		// saved board evidence or a web lookup can attach a source.
		updated, autoResolved, err := s.autoResolveSuggestionSourceEvidence(suggestion, timestamp)
		if err != nil {
			return nil, err
		}
		if autoResolved {
			suggestions[index] = updated
			existing[updated.ID] = updated
			suggestion = updated
			changed = true
		}
		updated, ok := autonomyPreflightBlockerSuggestion(suggestion, timestamp)
		if !ok {
			continue
		}
		suggestions[index] = updated
		existing[updated.ID] = updated
		changed = true
	}

	if !changed {
		return suggestions, nil
	}
	if err := s.saveSuggestions(existing); err != nil {
		return nil, err
	}
	return suggestions, nil
}

// autoResolveSuggestionSourceEvidence resolves a needs-source suggestion by
// attaching source evidence: saved board evidence first (a related node's
// source URLs), then a web lookup via the wired evidence finder. Attaching
// clears the missing-source marker and flips the review to resolved so the
// unresolved-contradiction blocker stops scoring.
func (s *Service) autoResolveSuggestionSourceEvidence(suggestion BrainSuggestion, timestamp string) (BrainSuggestion, bool, error) {
	suggestion = normalizeSuggestionCollections(suggestion)
	if !suggestionNeedsSourceEvidence(suggestion) {
		return suggestion, false, nil
	}
	lookupAttempted := false

	evidence, err := s.savedSourceEvidenceForSuggestion(suggestion, timestamp)
	if err != nil {
		return suggestion, false, err
	}
	if len(evidence) == 0 {
		// The web lookup is expensive and slow: it runs OUT OF BAND. The
		// attempt is recorded (cooldown) and the lookup dispatched; when it
		// lands the results are applied and the queue re-evaluated.
		if sourceLookupInCooldown(suggestion.LastSourceLookupAt, timestamp) {
			return suggestion, false, nil
		}
		suggestion.LastSourceLookupAt = timestamp
		lookupAttempted = true
		s.dispatchSourceLookup(suggestion, timestamp)
	}
	if len(evidence) == 0 {
		if lookupAttempted {
			suggestion.UpdatedAt = timestamp
			return normalizeSuggestionCollections(suggestion), true, nil
		}
		return suggestion, false, nil
	}

	previousEvidenceCount := len(suggestion.SourceEvidence)
	suggestion.SourceEvidence = normalizeSuggestionSourceEvidence(append(suggestion.SourceEvidence, evidence...))
	hadSourceMissing := containsString(suggestion.MissingEvidence, SuggestionMissingSource)
	suggestion.MissingEvidence = removeString(suggestion.MissingEvidence, SuggestionMissingSource)
	if suggestion.ReviewOutcome == SuggestionOutcomeNeedsSource {
		suggestion.Status = SuggestionStatusReviewed
		suggestion.ReviewOutcome = SuggestionOutcomeResolved
		suggestion.ReviewSource = SuggestionReviewSourceSourceEvidence
		if strings.TrimSpace(suggestion.ReviewedAt) == "" {
			suggestion.ReviewedAt = timestamp
		}
		suggestion.ResolvedAt = timestamp
	}
	if len(suggestion.SourceEvidence) == previousEvidenceCount && !hadSourceMissing && !lookupAttempted {
		return suggestion, false, nil
	}
	suggestion.UpdatedAt = timestamp
	return normalizeSuggestionCollections(suggestion), true, nil
}

func suggestionNeedsSourceEvidence(suggestion BrainSuggestion) bool {
	if suggestion.ReviewOutcome == SuggestionOutcomeNeedsSource {
		return true
	}
	// A resolved review stays resolved even if the recomputed missing list
	// still mentions source: otherwise the evidence lookup would re-run on
	// every evidence event forever (the Leg 0 storm).
	if suggestionOutcomeIsResolved(suggestion.ReviewOutcome) {
		return false
	}
	return containsString(suggestion.MissingEvidence, SuggestionMissingSource)
}

// dispatchSourceLookup hands the lookup to the out-of-band goroutine so the
// recompute pass (which holds the brain mutex) never waits on the network.
func (s *Service) dispatchSourceLookup(suggestion BrainSuggestion, timestamp string) {
	if s.sourceEvidence == nil {
		return
	}
	request := SourceEvidenceLookupRequest{
		Suggestion:      normalizeSuggestionCollections(suggestion),
		SuggestionID:    suggestion.ID,
		InvestigationID: suggestion.InvestigationID,
		SearchPrompt:    sourceEvidenceLookupPrompt(suggestion),
	}
	dispatch := s.sourceLookupDispatcher
	if dispatch == nil {
		dispatch = func(work func()) { go work() }
	}
	dispatch(func() { s.processSourceLookup(request, timestamp) })
}

// processSourceLookup runs the finder and applies whatever it finds back
// onto the suggestion, resolving needs-source and re-evaluating autonomy.
func (s *Service) processSourceLookup(request SourceEvidenceLookupRequest, dispatchedAt string) {
	if s.sourceEvidence == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	items, err := s.sourceEvidence.FindSourceEvidence(ctx, request)
	if err != nil {
		return
	}
	evidence := normalizeLookupSourceEvidence(request.SuggestionID, items, dispatchedAt)
	if len(evidence) == 0 {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	suggestions, err := s.loadSuggestions()
	if err != nil {
		return
	}
	suggestion, ok := suggestions[request.SuggestionID]
	if !ok || suggestion.Status == SuggestionStatusDismissed {
		return
	}
	// Another path may already have resolved it while the lookup ran.
	if !suggestionNeedsSourceEvidence(suggestion) {
		return
	}

	previousEvidenceCount := len(suggestion.SourceEvidence)
	suggestion.SourceEvidence = normalizeSuggestionSourceEvidence(append(suggestion.SourceEvidence, evidence...))
	hadSourceMissing := containsString(suggestion.MissingEvidence, SuggestionMissingSource)
	suggestion.MissingEvidence = removeString(suggestion.MissingEvidence, SuggestionMissingSource)
	if suggestion.ReviewOutcome == SuggestionOutcomeNeedsSource {
		suggestion.Status = SuggestionStatusReviewed
		suggestion.ReviewOutcome = SuggestionOutcomeResolved
		suggestion.ReviewSource = SuggestionReviewSourceSourceEvidence
		if strings.TrimSpace(suggestion.ReviewedAt) == "" {
			suggestion.ReviewedAt = dispatchedAt
		}
		suggestion.ResolvedAt = dispatchedAt
	}
	if len(suggestion.SourceEvidence) == previousEvidenceCount && !hadSourceMissing {
		return
	}
	suggestion.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	suggestions[request.SuggestionID] = normalizeSuggestionCollections(suggestion)
	if err := s.saveSuggestions(suggestions); err != nil {
		return
	}
	s.reevaluateAutonomyFromPersistedSuggestions(request.InvestigationID)
}

func sourceEvidenceLookupPrompt(suggestion BrainSuggestion) string {
	return nonEmptyString(
		suggestion.SearchPrompt,
		buildAutonomySourceSearchPrompt(suggestion),
		suggestion.Title,
		suggestion.Summary,
		suggestion.Reason,
	)
}

// savedSourceEvidenceForSuggestion scans the current and target boards for
// nodes related to the suggestion that already carry a source URL.
func (s *Service) savedSourceEvidenceForSuggestion(suggestion BrainSuggestion, timestamp string) ([]BrainSuggestionSourceEvidence, error) {
	currentNodeIDs, targetNodeIDs := suggestionSourceEvidenceNodeIDs(suggestion)
	if len(currentNodeIDs) == 0 && len(targetNodeIDs) == 0 {
		return nil, nil
	}

	evidence := make([]BrainSuggestionSourceEvidence, 0)
	if strings.TrimSpace(suggestion.InvestigationID) != "" && len(currentNodeIDs) > 0 {
		items, err := s.savedSourceEvidenceForNodes(suggestion.ID, suggestion.InvestigationID, currentNodeIDs, timestamp)
		if err != nil {
			return nil, err
		}
		evidence = append(evidence, items...)
	}
	for _, targetID := range cleanStringSet(suggestion.TargetInvestigationIDs) {
		items, err := s.savedSourceEvidenceForNodes(suggestion.ID, targetID, targetNodeIDs, timestamp)
		if err != nil {
			return nil, err
		}
		evidence = append(evidence, items...)
	}
	return normalizeSuggestionSourceEvidence(evidence), nil
}

func suggestionSourceEvidenceNodeIDs(suggestion BrainSuggestion) ([]string, []string) {
	current := make([]string, 0)
	target := make([]string, 0)
	for _, reason := range suggestion.ReasonSamples {
		current = append(current, reason.CurrentNodeIDs...)
		target = append(target, reason.TargetNodeIDs...)
	}
	return cleanStringSet(current), cleanStringSet(target)
}

func (s *Service) savedSourceEvidenceForNodes(suggestionID string, investigationID string, nodeIDs []string, timestamp string) ([]BrainSuggestionSourceEvidence, error) {
	investigationID = strings.TrimSpace(investigationID)
	nodeIDs = cleanStringSet(nodeIDs)
	if investigationID == "" || len(nodeIDs) == 0 {
		return nil, nil
	}
	wanted := make(map[string]struct{}, len(nodeIDs))
	for _, nodeID := range nodeIDs {
		wanted[nodeID] = struct{}{}
	}

	rawBoard, err := s.store.LoadJSON(investigationID, models.InvestigationBoardFilename)
	if err != nil {
		if errors.Is(err, models.ErrInvestigationNotFound) {
			return nil, nil
		}
		return nil, err
	}

	var board persistedBoard
	if err := json.Unmarshal(rawBoard, &board); err != nil {
		return nil, err
	}

	evidence := make([]BrainSuggestionSourceEvidence, 0)
	for _, node := range board.Nodes {
		nodeID := strings.TrimSpace(node.ID)
		if nodeID == "" {
			nodeID = strings.TrimSpace(node.Data.ID)
		}
		if _, ok := wanted[nodeID]; !ok {
			continue
		}
		for _, sourceURL := range cleanStringSet(append([]string{node.Data.SourceURL}, node.Data.SourceURLs...)) {
			if !validSourceEvidenceURL(sourceURL) {
				continue
			}
			evidence = append(evidence, BrainSuggestionSourceEvidence{
				ID:         deterministicID("brain-source-evidence", suggestionID, investigationID, nodeID, sourceURL),
				SourceURL:  sourceURL,
				EvidenceID: nodeID,
				Note:       "Auto-attached from saved board evidence.",
				CreatedAt:  timestamp,
			})
		}
	}
	return normalizeSuggestionSourceEvidence(evidence), nil
}

// sourceEvidenceLookupCooldown keeps a fruitless web lookup from being
// re-dispatched on every evidence event (the Leg 0 storm).
const sourceEvidenceLookupCooldown = 30 * time.Minute

func sourceLookupInCooldown(lastAttempt string, now string) bool {
	last, err := time.Parse(time.RFC3339, strings.TrimSpace(lastAttempt))
	if err != nil {
		return false
	}
	current, err := time.Parse(time.RFC3339, strings.TrimSpace(now))
	if err != nil {
		return false
	}
	return current.Sub(last) < sourceEvidenceLookupCooldown
}

func normalizeLookupSourceEvidence(suggestionID string, items []BrainSuggestionSourceEvidence, timestamp string) []BrainSuggestionSourceEvidence {
	cleaned := make([]BrainSuggestionSourceEvidence, 0, len(items))
	for _, item := range items {
		item.SourceURL = strings.TrimSpace(item.SourceURL)
		if !validSourceEvidenceURL(item.SourceURL) {
			continue
		}
		item.EvidenceID = strings.TrimSpace(item.EvidenceID)
		if item.EvidenceID == "" {
			item.EvidenceID = "source-lookup"
		}
		item.Note = strings.TrimSpace(item.Note)
		if item.Note == "" {
			item.Note = "Auto-attached from source lookup."
		}
		item.CreatedAt = strings.TrimSpace(item.CreatedAt)
		if item.CreatedAt == "" {
			item.CreatedAt = timestamp
		}
		item.ID = strings.TrimSpace(item.ID)
		if item.ID == "" {
			item.ID = deterministicID("brain-source-evidence", suggestionID, item.EvidenceID, item.SourceURL, item.Note)
		}
		cleaned = append(cleaned, item)
	}
	return normalizeSuggestionSourceEvidence(cleaned)
}

func autonomyPreflightBlockerSuggestion(suggestion BrainSuggestion, timestamp string) (BrainSuggestion, bool) {
	suggestion = normalizeSuggestionCollections(suggestion)
	if suggestion.Status == SuggestionStatusDismissed {
		return suggestion, false
	}
	if strings.TrimSpace(suggestion.ReviewOutcome) != "" {
		return suggestion, false
	}

	outcome := autonomyPreflightOutcome(suggestion)
	if outcome == "" {
		return suggestion, false
	}

	suggestion.Status = SuggestionStatusReviewed
	suggestion.ReviewOutcome = outcome
	suggestion.ReviewSource = SuggestionReviewSourceAutonomyPreflight
	suggestion = applyAutonomyPreflightOutcomeGuidance(suggestion)
	suggestion.ReviewedAt = timestamp
	suggestion.ResolvedAt = ""
	suggestion.UpdatedAt = timestamp
	return normalizeSuggestionCollections(suggestion), true
}

func autonomyPreflightOutcome(suggestion BrainSuggestion) string {
	switch suggestion.ActionMode {
	case SuggestionActionVerify:
		if !reasonSamplesHaveMatchedEvidence(suggestion.ReasonSamples) {
			return SuggestionOutcomeNeedsSource
		}
		return SuggestionOutcomeVerifiedConflict
	case SuggestionActionFillGap:
		for _, item := range autonomyPreflightMissingEvidencePriority() {
			if !containsString(suggestion.MissingEvidence, item) {
				continue
			}
			if outcome := autonomyPreflightMissingEvidenceOutcome(item); outcome != "" {
				return outcome
			}
		}
		return SuggestionOutcomeNeedsCorroborate
	default:
		return ""
	}
}

func autonomyPreflightMissingEvidencePriority() []string {
	return []string{
		SuggestionMissingSource,
		SuggestionMissingDate,
		SuggestionMissingEntityBridge,
		SuggestionMissingRelation,
		SuggestionMissingCorroboration,
	}
}

func autonomyPreflightMissingEvidenceOutcome(item string) string {
	switch item {
	case SuggestionMissingSource:
		return SuggestionOutcomeNeedsSource
	case SuggestionMissingDate:
		return SuggestionOutcomeNeedsDate
	case SuggestionMissingEntityBridge:
		return SuggestionOutcomeNeedsEntity
	case SuggestionMissingRelation:
		return SuggestionOutcomeNeedsRelation
	case SuggestionMissingCorroboration:
		return SuggestionOutcomeNeedsCorroborate
	default:
		return ""
	}
}

func applyAutonomyPreflightOutcomeGuidance(suggestion BrainSuggestion) BrainSuggestion {
	switch suggestion.ReviewOutcome {
	case SuggestionOutcomeNeedsSource:
		if !containsString(suggestion.MissingEvidence, SuggestionMissingSource) {
			suggestion.MissingEvidence = append(suggestion.MissingEvidence, SuggestionMissingSource)
		}
		if strings.TrimSpace(suggestion.SearchPrompt) == "" {
			suggestion.SearchPrompt = buildAutonomySourceSearchPrompt(suggestion)
		}
		suggestion.SuggestedAction = "Find source evidence"
	}
	return suggestion
}

func buildAutonomySourceSearchPrompt(suggestion BrainSuggestion) string {
	title := nonEmptyString(suggestion.Title, suggestion.Summary, suggestion.ID, "Brain memory cue")
	targets := cleanStringSet(suggestion.TargetInvestigationIDs)
	targetLabel := "remembered evidence"
	if len(targets) > 0 {
		targetLabel = strings.Join(targets, ", ")
	}
	reason := nonEmptyString(suggestion.Reason, suggestion.Summary)
	prompt := fmt.Sprintf("Find source evidence for %s against %s.", title, targetLabel)
	if reason != "" {
		prompt += " Ground this cue: " + reason
	}
	return prompt + " Capture source URLs or evidence ids before autonomy prepares a Rabbit Hole."
}

func reasonSamplesHaveMatchedEvidence(reasons []SignalReason) bool {
	for _, reason := range reasons {
		if len(reason.CurrentNodeIDs) > 0 && len(reason.TargetNodeIDs) > 0 {
			return true
		}
	}
	return false
}

// launchReadyAutonomySuggestions returns every active, launch-follow-up
// suggestion with controlled confidence and concrete targets, in the order
// the suggestions are ranked. Multi-candidate autonomy evaluates all of
// them under the configured budgets instead of only the first.
func launchReadyAutonomySuggestions(suggestions []BrainSuggestion) []BrainSuggestion {
	candidates := make([]BrainSuggestion, 0, len(suggestions))
	for _, suggestion := range suggestions {
		suggestion = normalizeSuggestionCollections(suggestion)
		if suggestion.Status != SuggestionStatusActive {
			continue
		}
		if suggestion.ActionMode != SuggestionActionLaunchFollowUp {
			continue
		}
		if !autonomySuggestionHasControlledConfidence(suggestion) {
			continue
		}
		if len(suggestion.TargetInvestigationIDs) == 0 {
			continue
		}
		candidates = append(candidates, suggestion)
	}
	return candidates
}

func autonomyBlockers(
	candidate BrainSuggestion,
	suggestions []BrainSuggestion,
	followUps map[string]BrainFollowUpAction,
	queue map[string]BrainAutonomyQueueItem,
	settings BrainAutonomySettings,
	investigationID string,
) []string {
	blockers := make([]string, 0)
	if !autonomySuggestionHasControlledConfidence(candidate) {
		blockers = append(blockers, AutonomyBlockerUnsafeRelevance)
	}
	if autonomyHasUnresolvedAction(suggestions, SuggestionActionFillGap) {
		blockers = append(blockers, AutonomyBlockerUnresolvedGap)
	}
	if autonomyHasUnresolvedAction(suggestions, SuggestionActionVerify) {
		blockers = append(blockers, AutonomyBlockerUnresolvedContradiction)
	}
	if autonomyHasExistingFollowUp(candidate.ID, followUps) {
		blockers = append(blockers, AutonomyBlockerDuplicateFollowUp)
	}
	if countAutonomyPreparedForInvestigation(queue, investigationID) >= settings.MaxAutoPreparedPerInvestigation {
		blockers = append(blockers, AutonomyBlockerInvestigationBudget)
	}
	if countActivePreparedFollowUps(followUps) >= settings.MaxActivePrepared {
		blockers = append(blockers, AutonomyBlockerActivePreparedBudget)
	}
	return cleanStringSet(blockers)
}

func autonomyHasUnresolvedAction(suggestions []BrainSuggestion, actionMode string) bool {
	for _, suggestion := range suggestions {
		suggestion = normalizeSuggestionCollections(suggestion)
		if suggestion.ActionMode != actionMode {
			continue
		}
		if suggestion.Status == SuggestionStatusDismissed {
			continue
		}
		if suggestionOutcomeIsResolved(suggestion.ReviewOutcome) {
			continue
		}
		return true
	}
	return false
}

func autonomyHasExistingFollowUp(suggestionID string, followUps map[string]BrainFollowUpAction) bool {
	for _, action := range followUps {
		action = normalizeFollowUpAction(action)
		if action.SourceKind == FollowUpSourceSuggestion && action.SourceID == suggestionID && action.Status != FollowUpStatusCancelled {
			return true
		}
	}
	return false
}

func countAutonomyPreparedForInvestigation(queue map[string]BrainAutonomyQueueItem, investigationID string) int {
	count := 0
	for _, item := range queue {
		if item.InvestigationID == investigationID && item.Decision == AutonomyDecisionPrepared && item.Status == AutonomyQueueStatusPrepared {
			count++
		}
	}
	return count
}

func countActivePreparedFollowUps(followUps map[string]BrainFollowUpAction) int {
	count := 0
	for _, action := range followUps {
		action = normalizeFollowUpAction(action)
		if action.Status == FollowUpStatusPrepared {
			count++
		}
	}
	return count
}

func buildAutonomyQueueItem(suggestion BrainSuggestion, settings BrainAutonomySettings, timestamp string) BrainAutonomyQueueItem {
	return BrainAutonomyQueueItem{
		ID:                     deterministicID("brain-autonomy", suggestion.InvestigationID, suggestion.ID),
		InvestigationID:        suggestion.InvestigationID,
		SuggestionID:           suggestion.ID,
		Mode:                   settings.Mode,
		Title:                  suggestion.Title,
		Summary:                suggestion.Summary,
		Score:                  suggestion.Score,
		Relevance:              suggestion.Relevance,
		TargetInvestigationIDs: cleanStringSet(suggestion.TargetInvestigationIDs),
		SourceSignalIds:        cleanStringSet(suggestion.RelatedSignalIDs),
		Gateway:                strings.TrimSpace(suggestion.ThinkingGateway),
		GatewayLabel:           strings.TrimSpace(suggestion.ThinkingLabel),
		CreatedAt:              timestamp,
		UpdatedAt:              timestamp,
	}
}

func autonomySuggestionHasControlledConfidence(suggestion BrainSuggestion) bool {
	relevance := normalizeRelevance(suggestion.Relevance)
	switch relevance {
	case RelevanceStrongMemory:
		return suggestion.Score >= autonomyStrongMemoryThreshold
	case RelevancePossibleBridge:
		return suggestion.Score >= autonomyPossibleBridgeHighConfidence
	default:
		return false
	}
}

func normalizeAutonomySettings(settings BrainAutonomySettings) BrainAutonomySettings {
	settings.Mode = strings.TrimSpace(settings.Mode)
	if settings.Mode == "" {
		settings.Mode = AutonomyModeOff
	}
	if settings.MaxAutoPreparedPerInvestigation <= 0 {
		settings.MaxAutoPreparedPerInvestigation = 1
	}
	if settings.MaxActivePrepared <= 0 {
		settings.MaxActivePrepared = 3
	}
	return settings
}

func validAutonomyMode(mode string) bool {
	switch mode {
	case AutonomyModeOff,
		AutonomyModeSuggestOnly,
		AutonomyModePrepareOnly,
		AutonomyModeAskBeforeLaunch,
		AutonomyModeLimitedBackground:
		return true
	default:
		return false
	}
}

func normalizeAutonomyQueueItem(item BrainAutonomyQueueItem) BrainAutonomyQueueItem {
	item.Blockers = cleanStringSet(item.Blockers)
	item.TargetInvestigationIDs = cleanStringSet(item.TargetInvestigationIDs)
	item.SourceSignalIds = cleanStringSet(item.SourceSignalIds)
	return item
}

func autonomyQueueForInvestigation(queue map[string]BrainAutonomyQueueItem, investigationID string) []BrainAutonomyQueueItem {
	result := make([]BrainAutonomyQueueItem, 0)
	for _, item := range queue {
		item = normalizeAutonomyQueueItem(item)
		if item.InvestigationID == investigationID {
			result = append(result, item)
		}
	}
	sortAutonomyQueue(result)
	return result
}

func autonomyAuditForInvestigation(audit map[string]BrainAutonomyAuditEntry, investigationID string) []BrainAutonomyAuditEntry {
	result := make([]BrainAutonomyAuditEntry, 0)
	for _, entry := range audit {
		entry.Blockers = cleanStringSet(entry.Blockers)
		if entry.InvestigationID == investigationID {
			result = append(result, entry)
		}
	}
	sortAutonomyAudit(result)
	return result
}

func sortAutonomyQueue(items []BrainAutonomyQueueItem) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].UpdatedAt == items[j].UpdatedAt {
			return items[i].Title < items[j].Title
		}
		return items[i].UpdatedAt > items[j].UpdatedAt
	})
}

func sortAutonomyAudit(items []BrainAutonomyAuditEntry) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].CreatedAt == items[j].CreatedAt {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt > items[j].CreatedAt
	})
}

func (s *Service) loadAutonomySettings() (BrainAutonomySettings, error) {
	settings := BrainAutonomySettings{}
	if err := s.loadBrainJSON(autonomySettingsFilename, &settings); err != nil {
		return BrainAutonomySettings{}, err
	}
	return normalizeAutonomySettings(settings), nil
}

func (s *Service) saveAutonomySettings(settings BrainAutonomySettings) error {
	return s.saveBrainJSON(autonomySettingsFilename, normalizeAutonomySettings(settings))
}

func (s *Service) loadAutonomyQueue() (map[string]BrainAutonomyQueueItem, error) {
	items := []BrainAutonomyQueueItem{}
	if err := s.loadBrainJSON(autonomyQueueFilename, &items); err != nil {
		return nil, err
	}
	byID := make(map[string]BrainAutonomyQueueItem, len(items))
	for _, item := range items {
		item = normalizeAutonomyQueueItem(item)
		if strings.TrimSpace(item.ID) != "" {
			byID[item.ID] = item
		}
	}
	return byID, nil
}

func (s *Service) saveAutonomyQueue(queue map[string]BrainAutonomyQueueItem) error {
	items := make([]BrainAutonomyQueueItem, 0, len(queue))
	for _, item := range queue {
		items = append(items, normalizeAutonomyQueueItem(item))
	}
	sortAutonomyQueue(items)
	return s.saveBrainJSON(autonomyQueueFilename, items)
}

func (s *Service) loadAutonomyAudit() (map[string]BrainAutonomyAuditEntry, error) {
	items := []BrainAutonomyAuditEntry{}
	if err := s.loadBrainJSON(autonomyAuditFilename, &items); err != nil {
		return nil, err
	}
	byID := make(map[string]BrainAutonomyAuditEntry, len(items))
	for _, item := range items {
		item.Blockers = cleanStringSet(item.Blockers)
		item.SourceSignalIds = cleanStringSet(item.SourceSignalIds)
		if strings.TrimSpace(item.ID) != "" {
			byID[item.ID] = item
		}
	}
	return byID, nil
}

func (s *Service) saveAutonomyAudit(audit map[string]BrainAutonomyAuditEntry) error {
	items := make([]BrainAutonomyAuditEntry, 0, len(audit))
	for _, item := range audit {
		item.Blockers = cleanStringSet(item.Blockers)
		item.SourceSignalIds = cleanStringSet(item.SourceSignalIds)
		items = append(items, item)
	}
	sortAutonomyAudit(items)
	return s.saveBrainJSON(autonomyAuditFilename, items)
}
