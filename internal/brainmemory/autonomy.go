package brainmemory

import (
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
	CreatedAt              string   `json:"createdAt"`
	UpdatedAt              string   `json:"updatedAt"`
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

func (s *Service) UpdateAutonomySettings(settings BrainAutonomySettings) (BrainAutonomySettings, error) {
	settings = normalizeAutonomySettings(settings)
	if !validAutonomyMode(settings.Mode) {
		return BrainAutonomySettings{}, ErrInvalidAutonomySettings
	}
	settings.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := s.saveAutonomySettings(settings); err != nil {
		return BrainAutonomySettings{}, err
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

	candidate, ok := firstLaunchReadyAutonomySuggestion(suggestions)
	if !ok {
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

	blockers := autonomyBlockers(candidate, suggestions, followUps, queue, settings, investigationID)
	item := buildAutonomyQueueItem(candidate, settings, timestamp)
	item.Blockers = blockers

	if len(blockers) > 0 {
		item.Decision = AutonomyDecisionBlocked
		item.Status = AutonomyQueueStatusBlocked
		item.Reason = "Autonomy did not prepare this follow-up because safety blockers are still active."
		return s.saveAutonomyDecision(queue, audit, item)
	}

	if settings.Mode == AutonomyModeSuggestOnly || settings.Mode == AutonomyModeLimitedBackground {
		item.Decision = AutonomyDecisionWouldPrepare
		item.Status = AutonomyQueueStatusWaiting
		item.Reason = "Autonomy would prepare this focused follow-up, but the current mode does not permit V16 preparation."
		return s.saveAutonomyDecision(queue, audit, item)
	}

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
	return s.saveAutonomyDecision(queue, audit, item)
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

func firstLaunchReadyAutonomySuggestion(suggestions []BrainSuggestion) (BrainSuggestion, bool) {
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
		return suggestion, true
	}
	return BrainSuggestion{}, false
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
		items = append(items, item)
	}
	sortAutonomyAudit(items)
	return s.saveBrainJSON(autonomyAuditFilename, items)
}
