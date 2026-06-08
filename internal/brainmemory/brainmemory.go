package brainmemory

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/Andyi955/Gorantula/models"
)

const (
	GatewayEntityDate      = "entity-date"
	GatewaySourceDomain    = "source-domain"
	GatewayRelationshipTag = "relationship-tag"

	brainDirectoryName  = "brain"
	signalsFilename     = "signals.json"
	linksFilename       = "links.json"
	clustersFilename    = "clusters.json"
	suggestionsFilename = "suggestions.json"

	promotionTypeManual = "manual"
	promotionTypeAuto   = "auto"

	autoPromotionScoreThreshold      = 0.85
	repeatedPromotionScoreThreshold  = 0.75
	repeatedPromotionActivationCount = 3

	SuggestionKindClusterReview     = "cluster-review"
	SuggestionKindSourceReview      = "source-review"
	SuggestionKindRelationshipMotif = "relationship-motif"
	SuggestionKindMemoryLinkCompare = "memory-link-compare"
	SuggestionKindGapReview         = "gap-review"

	SuggestionStatusActive    = "active"
	SuggestionStatusDismissed = "dismissed"
	SuggestionStatusReviewed  = "reviewed"
)

var (
	ErrSignalNotFound     = errors.New("brain signal not found")
	ErrLinkNotFound       = errors.New("brain memory link not found")
	ErrClusterNotFound    = errors.New("brain memory cluster not found")
	ErrSuggestionNotFound = errors.New("brain suggestion not found")

	taggedEntityPattern = regexp.MustCompile(`\[(PERSON|ORG|LOC|DATE):([^\]]+)]`)
	spacePattern        = regexp.MustCompile(`\s+`)
)

type SignalReason struct {
	Gateway        string   `json:"gateway"`
	Value          string   `json:"value"`
	Label          string   `json:"label"`
	Detail         string   `json:"detail"`
	CurrentNodeIDs []string `json:"currentNodeIds"`
	TargetNodeIDs  []string `json:"targetNodeIds"`
}

type BrainSignal struct {
	ID                    string         `json:"id"`
	InvestigationID       string         `json:"investigationId"`
	InvestigationTitle    string         `json:"investigationTitle"`
	TargetInvestigationID string         `json:"targetInvestigationId"`
	TargetTitle           string         `json:"targetTitle"`
	Score                 float64        `json:"score"`
	Gateways              []string       `json:"gateways"`
	Reasons               []SignalReason `json:"reasons"`
	SuggestedAction       string         `json:"suggestedAction"`
	CreatedAt             string         `json:"createdAt"`
	UpdatedAt             string         `json:"updatedAt"`
	Dismissed             bool           `json:"dismissed"`
	Linked                bool           `json:"linked"`
	LinkID                string         `json:"linkId,omitempty"`
	ActivationCount       int            `json:"activationCount,omitempty"`
	LastFiredAt           string         `json:"lastFiredAt,omitempty"`
}

func (s BrainSignal) HasGateway(gateway string) bool {
	for _, candidate := range s.Gateways {
		if candidate == gateway {
			return true
		}
	}
	return false
}

func (s BrainSignal) ReasonTexts() []string {
	reasons := make([]string, 0, len(s.Reasons))
	for _, reason := range s.Reasons {
		if strings.TrimSpace(reason.Detail) != "" {
			reasons = append(reasons, reason.Detail)
		}
	}
	return reasons
}

type MemoryLink struct {
	ID                  string         `json:"id"`
	SignalID            string         `json:"signalId"`
	FromInvestigationID string         `json:"fromInvestigationId"`
	FromTitle           string         `json:"fromTitle"`
	ToInvestigationID   string         `json:"toInvestigationId"`
	ToTitle             string         `json:"toTitle"`
	Score               float64        `json:"score"`
	Gateways            []string       `json:"gateways"`
	Reasons             []SignalReason `json:"reasons"`
	SuggestedAction     string         `json:"suggestedAction"`
	CreatedAt           string         `json:"createdAt"`
	UpdatedAt           string         `json:"updatedAt"`
	LastFiredAt         string         `json:"lastFiredAt"`
	ActivationCount     int            `json:"activationCount"`
	PromotionType       string         `json:"promotionType"`
}

type MemoryClusterMember struct {
	InvestigationID string `json:"investigationId"`
	Title           string `json:"title"`
	Role            string `json:"role"`
}

type MemoryCluster struct {
	ID                     string                `json:"id"`
	Label                  string                `json:"label"`
	Summary                string                `json:"summary"`
	Score                  float64               `json:"score"`
	Status                 string                `json:"status"`
	DominantGateway        string                `json:"dominantGateway"`
	GatewayCounts          map[string]int        `json:"gatewayCounts"`
	MemberInvestigationIDs []string              `json:"memberInvestigationIds"`
	Members                []MemoryClusterMember `json:"members"`
	SignalIDs              []string              `json:"signalIds"`
	MemoryLinkIDs          []string              `json:"memoryLinkIds"`
	ReasonSamples          []SignalReason        `json:"reasonSamples"`
	Pinned                 bool                  `json:"pinned"`
	Hidden                 bool                  `json:"hidden"`
	CreatedAt              string                `json:"createdAt"`
	UpdatedAt              string                `json:"updatedAt"`
	LastActivatedAt        string                `json:"lastActivatedAt"`
}

type BrainSuggestion struct {
	ID                     string   `json:"id"`
	InvestigationID        string   `json:"investigationId"`
	Kind                   string   `json:"kind"`
	Status                 string   `json:"status"`
	Title                  string   `json:"title"`
	Summary                string   `json:"summary"`
	SuggestedAction        string   `json:"suggestedAction"`
	Score                  float64  `json:"score"`
	Priority               string   `json:"priority"`
	Reason                 string   `json:"reason"`
	RelatedSignalIDs       []string `json:"relatedSignalIds"`
	RelatedMemoryLinkIDs   []string `json:"relatedMemoryLinkIds"`
	RelatedClusterIDs      []string `json:"relatedClusterIds"`
	TargetInvestigationIDs []string `json:"targetInvestigationIds"`
	CreatedAt              string   `json:"createdAt"`
	UpdatedAt              string   `json:"updatedAt"`
	DismissedAt            string   `json:"dismissedAt,omitempty"`
	ReviewedAt             string   `json:"reviewedAt,omitempty"`
}

type Service struct {
	vaultRoot string
	store     *models.InvestigationStore
}

func NewService(vaultRoot string) *Service {
	root := strings.TrimSpace(vaultRoot)
	if root == "" {
		root = "abdomen_vault"
	}
	return &Service{
		vaultRoot: root,
		store:     models.NewInvestigationStore(root),
	}
}

type signalEvidence struct {
	Label   string
	Kind    string
	NodeIDs []string
}

type memoryProfile struct {
	ID               string
	Title            string
	Entities         map[string]signalEvidence
	SourceDomains    map[string]signalEvidence
	RelationshipTags map[string]signalEvidence
}

type persistedBoard struct {
	Nodes []persistedBoardNode `json:"nodes"`
	Edges []persistedBoardEdge `json:"edges"`
}

type persistedBoardNode struct {
	ID   string                 `json:"id"`
	Data persistedBoardNodeData `json:"data"`
}

type persistedBoardNodeData struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Summary    string   `json:"summary"`
	FullText   string   `json:"fullText"`
	SourceURL  string   `json:"sourceURL"`
	SourceURLs []string `json:"sourceURLs"`
}

type persistedBoardEdge struct {
	ID     string                 `json:"id"`
	Source string                 `json:"source"`
	Target string                 `json:"target"`
	Label  string                 `json:"label"`
	Data   persistedBoardEdgeData `json:"data"`
}

type persistedBoardEdgeData struct {
	Tag          string `json:"tag"`
	DisplayLabel string `json:"displayLabel"`
	Label        string `json:"label"`
}

type clusterEvidence struct {
	InvestigationID string
	Title           string
	Label           string
	Kind            string
	NodeIDs         []string
}

type clusterSeed struct {
	Gateway string
	Value   string
	Label   string
	Kind    string
	Members map[string]clusterEvidence
}

func (s *Service) GenerateSignals(investigationID string) ([]BrainSignal, error) {
	investigationID = strings.TrimSpace(investigationID)
	if !models.ValidInvestigationID(investigationID) {
		return nil, models.ErrInvalidInvestigationID
	}

	records, err := s.store.List()
	if err != nil {
		return nil, err
	}

	recordByID := make(map[string]models.InvestigationRecord, len(records))
	for _, record := range records {
		recordByID[record.ID] = record
	}
	currentRecord, ok := recordByID[investigationID]
	if !ok {
		return nil, models.ErrInvestigationNotFound
	}

	currentProfile, err := s.buildProfile(currentRecord)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	existingSignals, err := s.loadSignals()
	if err != nil {
		return nil, err
	}
	links, err := s.loadLinks()
	if err != nil {
		return nil, err
	}
	linksChanged := false
	nextSignals := make(map[string]BrainSignal, len(existingSignals)+len(records))
	for id, signal := range existingSignals {
		if signal.InvestigationID != investigationID || signal.Dismissed || signal.Linked {
			nextSignals[id] = signal
		}
	}

	activeSignals := make([]BrainSignal, 0)
	for _, record := range records {
		if record.ID == investigationID {
			continue
		}
		targetProfile, err := s.buildProfile(record)
		if err != nil {
			continue
		}
		signal, ok := buildSignal(currentProfile, targetProfile, now)
		if !ok {
			continue
		}
		if existing, exists := existingSignals[signal.ID]; exists {
			signal.CreatedAt = existing.CreatedAt
			signal.Dismissed = existing.Dismissed
			signal.Linked = existing.Linked
			signal.LinkID = existing.LinkID
			signal.ActivationCount = existing.ActivationCount
			signal.LastFiredAt = existing.LastFiredAt
			if signal.CreatedAt == "" {
				signal.CreatedAt = now
			}
		}
		if signal.Dismissed {
			nextSignals[signal.ID] = signal
			continue
		}
		if signal.ActivationCount < 1 {
			signal.ActivationCount = 1
		} else {
			signal.ActivationCount++
		}
		signal.LastFiredAt = now

		linkID := memoryPairLinkID(signal.InvestigationID, signal.TargetInvestigationID)
		if existingLink, exists := links[linkID]; exists {
			links[linkID] = reinforceMemoryLink(existingLink, signal, now, true, "")
			linksChanged = true
			signal.Linked = true
			signal.LinkID = linkID
			signal.UpdatedAt = now
			nextSignals[signal.ID] = signal
			continue
		}
		if signal.Linked && signal.LinkID != "" {
			if existingLink, exists := links[signal.LinkID]; exists {
				links[signal.LinkID] = reinforceMemoryLink(existingLink, signal, now, true, "")
				linksChanged = true
				nextSignals[signal.ID] = signal
				continue
			}
		}
		if shouldAutoPromoteSignal(signal) {
			link := newMemoryLink(signal, now, promotionTypeAuto)
			links[link.ID] = link
			linksChanged = true
			signal.Linked = true
			signal.LinkID = link.ID
			signal.UpdatedAt = now
			nextSignals[signal.ID] = signal
			continue
		}
		nextSignals[signal.ID] = signal
		if !signal.Linked {
			activeSignals = append(activeSignals, signal)
		}
	}

	sortSignals(activeSignals)
	if linksChanged {
		if err := s.saveLinks(links); err != nil {
			return nil, err
		}
	}
	if err := s.saveSignals(nextSignals); err != nil {
		return nil, err
	}
	return activeSignals, nil
}

func (s *Service) DismissSignal(signalID string) (BrainSignal, error) {
	signalID = strings.TrimSpace(signalID)
	signals, err := s.loadSignals()
	if err != nil {
		return BrainSignal{}, err
	}
	signal, ok := signals[signalID]
	if !ok {
		return BrainSignal{}, ErrSignalNotFound
	}
	signal.Dismissed = true
	signal.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	signals[signalID] = signal
	if err := s.saveSignals(signals); err != nil {
		return BrainSignal{}, err
	}
	return signal, nil
}

func (s *Service) PromoteSignal(signalID string) (MemoryLink, error) {
	signalID = strings.TrimSpace(signalID)
	signals, err := s.loadSignals()
	if err != nil {
		return MemoryLink{}, err
	}
	signal, ok := signals[signalID]
	if !ok {
		return MemoryLink{}, ErrSignalNotFound
	}

	links, err := s.loadLinks()
	if err != nil {
		return MemoryLink{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	linkID := memoryPairLinkID(signal.InvestigationID, signal.TargetInvestigationID)
	if existing, exists := links[linkID]; exists {
		existing = reinforceMemoryLink(existing, signal, now, false, promotionTypeManual)
		links[linkID] = existing
		signal.Linked = true
		signal.LinkID = existing.ID
		signal.UpdatedAt = now
		signals[signal.ID] = signal
		if err := s.saveLinks(links); err != nil {
			return MemoryLink{}, err
		}
		if err := s.saveSignals(signals); err != nil {
			return MemoryLink{}, err
		}
		return existing, nil
	}

	link := newMemoryLink(signal, now, promotionTypeManual)
	links[link.ID] = link
	signal.Linked = true
	signal.LinkID = link.ID
	if signal.ActivationCount < 1 {
		signal.ActivationCount = 1
	}
	signal.LastFiredAt = now
	signal.UpdatedAt = now
	signals[signal.ID] = signal

	if err := s.saveLinks(links); err != nil {
		return MemoryLink{}, err
	}
	if err := s.saveSignals(signals); err != nil {
		return MemoryLink{}, err
	}
	return link, nil
}

func (s *Service) ForgetLink(linkID string) (MemoryLink, error) {
	linkID = strings.TrimSpace(linkID)
	links, err := s.loadLinks()
	if err != nil {
		return MemoryLink{}, err
	}
	link, ok := links[linkID]
	if !ok {
		return MemoryLink{}, ErrLinkNotFound
	}
	delete(links, linkID)

	signals, err := s.loadSignals()
	if err != nil {
		return MemoryLink{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	for signalID, signal := range signals {
		isLinkedSignal := signal.LinkID == link.ID
		isPairSignal := memoryPairLinkID(signal.InvestigationID, signal.TargetInvestigationID) == link.ID
		if !isLinkedSignal && !isPairSignal {
			continue
		}
		signal.Linked = false
		signal.LinkID = ""
		signal.Dismissed = true
		signal.UpdatedAt = now
		signals[signalID] = signal
	}

	if err := s.saveLinks(links); err != nil {
		return MemoryLink{}, err
	}
	if err := s.saveSignals(signals); err != nil {
		return MemoryLink{}, err
	}
	return link, nil
}

func (s *Service) LinksForInvestigation(investigationID string) ([]MemoryLink, error) {
	investigationID = strings.TrimSpace(investigationID)
	if !models.ValidInvestigationID(investigationID) {
		return nil, models.ErrInvalidInvestigationID
	}
	links, err := s.loadLinks()
	if err != nil {
		return nil, err
	}
	result := make([]MemoryLink, 0)
	for _, link := range links {
		if link.FromInvestigationID == investigationID || link.ToInvestigationID == investigationID {
			result = append(result, link)
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		return result[i].CreatedAt > result[j].CreatedAt
	})
	return result, nil
}

func (s *Service) ClustersForInvestigation(investigationID string) ([]MemoryCluster, error) {
	investigationID = strings.TrimSpace(investigationID)
	if !models.ValidInvestigationID(investigationID) {
		return nil, models.ErrInvalidInvestigationID
	}

	records, err := s.store.List()
	if err != nil {
		return nil, err
	}
	currentExists := false
	profiles := make([]memoryProfile, 0, len(records))
	for _, record := range records {
		if record.ID == investigationID {
			currentExists = true
		}
		profile, err := s.buildProfile(record)
		if err != nil {
			continue
		}
		profiles = append(profiles, profile)
	}
	if !currentExists {
		return nil, models.ErrInvestigationNotFound
	}

	existingClusters, err := s.loadClusters()
	if err != nil {
		return nil, err
	}
	signals, err := s.loadSignals()
	if err != nil {
		return nil, err
	}
	links, err := s.loadLinks()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	recomputed := buildMemoryClusters(investigationID, profiles, signals, links, existingClusters, now)
	nextClusters := make(map[string]MemoryCluster, len(existingClusters)+len(recomputed))
	for id, cluster := range existingClusters {
		if containsString(cluster.MemberInvestigationIDs, investigationID) {
			continue
		}
		nextClusters[id] = cluster
	}
	for _, cluster := range recomputed {
		nextClusters[cluster.ID] = cluster
	}
	if err := s.saveClusters(nextClusters); err != nil {
		return nil, err
	}
	sortClusters(recomputed)
	return recomputed, nil
}

func (s *Service) ToggleClusterPin(clusterID string) (MemoryCluster, error) {
	clusterID = strings.TrimSpace(clusterID)
	clusters, err := s.loadClusters()
	if err != nil {
		return MemoryCluster{}, err
	}
	cluster, ok := clusters[clusterID]
	if !ok {
		return MemoryCluster{}, ErrClusterNotFound
	}
	cluster.Pinned = !cluster.Pinned
	cluster.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	clusters[clusterID] = cluster
	if err := s.saveClusters(clusters); err != nil {
		return MemoryCluster{}, err
	}
	return cluster, nil
}

func (s *Service) HideCluster(clusterID string) (MemoryCluster, error) {
	return s.setClusterHidden(clusterID, true)
}

func (s *Service) UnhideCluster(clusterID string) (MemoryCluster, error) {
	return s.setClusterHidden(clusterID, false)
}

func (s *Service) setClusterHidden(clusterID string, hidden bool) (MemoryCluster, error) {
	clusterID = strings.TrimSpace(clusterID)
	clusters, err := s.loadClusters()
	if err != nil {
		return MemoryCluster{}, err
	}
	cluster, ok := clusters[clusterID]
	if !ok {
		return MemoryCluster{}, ErrClusterNotFound
	}
	cluster.Hidden = hidden
	cluster.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	clusters[clusterID] = cluster
	if err := s.saveClusters(clusters); err != nil {
		return MemoryCluster{}, err
	}
	return cluster, nil
}

func (s *Service) SuggestionsForInvestigation(investigationID string) ([]BrainSuggestion, error) {
	investigationID = strings.TrimSpace(investigationID)
	if !models.ValidInvestigationID(investigationID) {
		return nil, models.ErrInvalidInvestigationID
	}
	if _, err := s.store.LoadMetadata(investigationID); err != nil {
		return nil, err
	}

	signals, err := s.loadSignals()
	if err != nil {
		return nil, err
	}
	links, err := s.loadLinks()
	if err != nil {
		return nil, err
	}
	clusters, err := s.loadClusters()
	if err != nil {
		return nil, err
	}
	existing, err := s.loadSuggestions()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	recomputed := buildBrainSuggestions(investigationID, signals, links, clusters, existing, now)
	nextSuggestions := make(map[string]BrainSuggestion, len(existing)+len(recomputed))
	for id, suggestion := range existing {
		suggestion = normalizeSuggestionCollections(suggestion)
		if suggestion.InvestigationID != investigationID {
			nextSuggestions[id] = suggestion
			continue
		}
		if suggestion.Status == SuggestionStatusDismissed {
			nextSuggestions[id] = suggestion
		}
	}

	visible := make([]BrainSuggestion, 0, len(recomputed))
	for _, suggestion := range recomputed {
		suggestion = normalizeSuggestionCollections(suggestion)
		nextSuggestions[suggestion.ID] = suggestion
		if suggestion.Status != SuggestionStatusDismissed {
			visible = append(visible, suggestion)
		}
	}
	if err := s.saveSuggestions(nextSuggestions); err != nil {
		return nil, err
	}
	sortSuggestions(visible)
	return visible, nil
}

func (s *Service) DismissSuggestion(suggestionID string) (BrainSuggestion, error) {
	return s.setSuggestionStatus(suggestionID, SuggestionStatusDismissed)
}

func (s *Service) MarkSuggestionReviewed(suggestionID string) (BrainSuggestion, error) {
	return s.setSuggestionStatus(suggestionID, SuggestionStatusReviewed)
}

func (s *Service) setSuggestionStatus(suggestionID string, status string) (BrainSuggestion, error) {
	suggestionID = strings.TrimSpace(suggestionID)
	suggestions, err := s.loadSuggestions()
	if err != nil {
		return BrainSuggestion{}, err
	}
	suggestion, ok := suggestions[suggestionID]
	if !ok {
		return BrainSuggestion{}, ErrSuggestionNotFound
	}
	now := time.Now().UTC().Format(time.RFC3339)
	suggestion.Status = status
	suggestion.UpdatedAt = now
	switch status {
	case SuggestionStatusDismissed:
		suggestion.DismissedAt = now
	case SuggestionStatusReviewed:
		suggestion.ReviewedAt = now
	}
	suggestion = normalizeSuggestionCollections(suggestion)
	suggestions[suggestionID] = suggestion
	if err := s.saveSuggestions(suggestions); err != nil {
		return BrainSuggestion{}, err
	}
	return suggestion, nil
}

func buildBrainSuggestions(
	investigationID string,
	signals map[string]BrainSignal,
	links map[string]MemoryLink,
	clusters map[string]MemoryCluster,
	existing map[string]BrainSuggestion,
	timestamp string,
) []BrainSuggestion {
	activeSignals := activeSignalsForInvestigation(signals, investigationID)
	activeLinks := linksForInvestigationMap(links, investigationID)
	visibleClusters := clustersForInvestigationMap(clusters, investigationID)

	suggestions := make([]BrainSuggestion, 0)
	suggestions = append(suggestions, clusterReviewSuggestions(investigationID, visibleClusters, existing, timestamp)...)
	suggestions = append(suggestions, sourceReviewSuggestions(investigationID, activeSignals, existing, timestamp)...)
	suggestions = append(suggestions, relationshipMotifSuggestions(investigationID, activeSignals, visibleClusters, existing, timestamp)...)
	suggestions = append(suggestions, memoryLinkCompareSuggestions(investigationID, activeLinks, existing, timestamp)...)
	if gapSuggestion, ok := gapReviewSuggestion(investigationID, activeSignals, existing, timestamp); ok {
		suggestions = append(suggestions, gapSuggestion)
	}
	sortSuggestions(suggestions)
	return suggestions
}

func clusterReviewSuggestions(
	investigationID string,
	clusters []MemoryCluster,
	existing map[string]BrainSuggestion,
	timestamp string,
) []BrainSuggestion {
	suggestions := make([]BrainSuggestion, 0)
	for _, cluster := range clusters {
		if cluster.Hidden || cluster.Score < 0.75 {
			continue
		}
		targetIDs := clusterTargetInvestigationIDs(cluster, investigationID)
		if len(targetIDs) == 0 {
			continue
		}
		score := clusterSuggestionScore(cluster)
		suggestion := BrainSuggestion{
			ID:                     deterministicID("brain-suggestion", investigationID, SuggestionKindClusterReview, cluster.ID),
			InvestigationID:        investigationID,
			Kind:                   SuggestionKindClusterReview,
			Status:                 SuggestionStatusActive,
			Title:                  clusterSuggestionTitle(cluster),
			Summary:                cluster.Summary,
			SuggestedAction:        "Inspect recurring memory cluster",
			Score:                  score,
			Priority:               suggestionPriority(score),
			Reason:                 fmt.Sprintf("%s is an %s cluster with %d related investigations.", cluster.Label, cluster.Status, len(cluster.MemberInvestigationIDs)),
			RelatedClusterIDs:      []string{cluster.ID},
			RelatedSignalIDs:       cleanStringSet(cluster.SignalIDs),
			RelatedMemoryLinkIDs:   cleanStringSet(cluster.MemoryLinkIDs),
			TargetInvestigationIDs: targetIDs,
			CreatedAt:              timestamp,
			UpdatedAt:              timestamp,
		}
		suggestions = append(suggestions, mergeSuggestionState(suggestion, existing, timestamp))
	}
	return suggestions
}

func clusterSuggestionTitle(cluster MemoryCluster) string {
	label := strings.TrimSpace(cluster.Label)
	if label == "" {
		label = "active"
	}
	switch {
	case clusterIsDateOnlyRecall(cluster):
		return fmt.Sprintf("Review %s timeline cluster", label)
	case cluster.DominantGateway == GatewaySourceDomain:
		return fmt.Sprintf("Compare %s source cluster", label)
	case cluster.DominantGateway == GatewayRelationshipTag:
		return fmt.Sprintf("Inspect %s relationship cluster", label)
	default:
		return fmt.Sprintf("Review %s memory cluster", label)
	}
}

func clusterSuggestionScore(cluster MemoryCluster) float64 {
	score := cluster.Score
	if clusterIsDateOnlyRecall(cluster) {
		score -= 0.30
	}
	memberCount := len(cluster.MemberInvestigationIDs)
	if memberCount >= 25 {
		score -= 0.24
	} else if memberCount >= 15 {
		score -= 0.18
	}
	if score < 0.35 {
		return 0.35
	}
	return score
}

func clusterIsDateOnlyRecall(cluster MemoryCluster) bool {
	if cluster.DominantGateway != GatewayEntityDate {
		return false
	}
	for _, reason := range cluster.ReasonSamples {
		if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(reason.Value)), "DATE|") {
			return true
		}
	}
	return looksLikeYearOrISODate(cluster.Label)
}

func looksLikeYearOrISODate(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) == 4 {
		for _, ch := range value {
			if ch < '0' || ch > '9' {
				return false
			}
		}
		return true
	}
	if len(value) >= 7 {
		prefix := value
		if len(prefix) > 10 {
			prefix = prefix[:10]
		}
		for index, ch := range prefix {
			if index == 4 || index == 7 {
				if ch != '-' {
					return false
				}
				continue
			}
			if ch < '0' || ch > '9' {
				return false
			}
		}
		return len(prefix) == 7 || len(prefix) == 10
	}
	return false
}

func sourceReviewSuggestions(
	investigationID string,
	signals []BrainSignal,
	existing map[string]BrainSuggestion,
	timestamp string,
) []BrainSuggestion {
	type sourceGroup struct {
		domain    string
		score     float64
		signalIDs []string
		targetIDs []string
	}
	groups := make(map[string]sourceGroup)
	for _, signal := range signals {
		for _, reason := range signal.Reasons {
			if reason.Gateway != GatewaySourceDomain {
				continue
			}
			group := groups[reason.Value]
			group.domain = reason.Label
			if group.domain == "" {
				group.domain = reason.Value
			}
			if signal.Score > group.score {
				group.score = signal.Score
			}
			group.signalIDs = append(group.signalIDs, signal.ID)
			group.targetIDs = append(group.targetIDs, signal.TargetInvestigationID)
			groups[reason.Value] = group
		}
	}
	suggestions := make([]BrainSuggestion, 0, len(groups))
	for value, group := range groups {
		suggestion := BrainSuggestion{
			ID:                     deterministicID("brain-suggestion", investigationID, SuggestionKindSourceReview, value),
			InvestigationID:        investigationID,
			Kind:                   SuggestionKindSourceReview,
			Status:                 SuggestionStatusActive,
			Title:                  "Compare repeated source domain",
			Summary:                fmt.Sprintf("Source domain %q appears in active Brain firings.", group.domain),
			SuggestedAction:        "Compare source domain",
			Score:                  maxFloat(group.score, 0.44),
			Priority:               suggestionPriority(maxFloat(group.score, 0.44)),
			Reason:                 fmt.Sprintf("%s appears across %d active signal(s).", group.domain, len(cleanStringSet(group.signalIDs))),
			RelatedSignalIDs:       cleanStringSet(group.signalIDs),
			TargetInvestigationIDs: cleanStringSet(group.targetIDs),
			CreatedAt:              timestamp,
			UpdatedAt:              timestamp,
		}
		suggestions = append(suggestions, mergeSuggestionState(suggestion, existing, timestamp))
	}
	return suggestions
}

func relationshipMotifSuggestions(
	investigationID string,
	signals []BrainSignal,
	clusters []MemoryCluster,
	existing map[string]BrainSuggestion,
	timestamp string,
) []BrainSuggestion {
	suggestionsByValue := make(map[string]BrainSuggestion)
	for _, cluster := range clusters {
		if cluster.Hidden || cluster.DominantGateway != GatewayRelationshipTag {
			continue
		}
		targetIDs := clusterTargetInvestigationIDs(cluster, investigationID)
		if len(targetIDs) == 0 {
			continue
		}
		suggestion := BrainSuggestion{
			ID:                     deterministicID("brain-suggestion", investigationID, SuggestionKindRelationshipMotif, cluster.ID),
			InvestigationID:        investigationID,
			Kind:                   SuggestionKindRelationshipMotif,
			Status:                 SuggestionStatusActive,
			Title:                  "Inspect repeated relationship motif",
			Summary:                cluster.Summary,
			SuggestedAction:        "Inspect repeated relationship pattern",
			Score:                  maxFloat(cluster.Score, 0.58),
			Priority:               suggestionPriority(maxFloat(cluster.Score, 0.58)),
			Reason:                 fmt.Sprintf("Relationship pattern %q recurs across %d investigations.", cluster.Label, len(cluster.MemberInvestigationIDs)),
			RelatedClusterIDs:      []string{cluster.ID},
			RelatedSignalIDs:       cleanStringSet(cluster.SignalIDs),
			RelatedMemoryLinkIDs:   cleanStringSet(cluster.MemoryLinkIDs),
			TargetInvestigationIDs: targetIDs,
			CreatedAt:              timestamp,
			UpdatedAt:              timestamp,
		}
		suggestionsByValue[cluster.ID] = mergeSuggestionState(suggestion, existing, timestamp)
	}
	for _, signal := range signals {
		for _, reason := range signal.Reasons {
			if reason.Gateway != GatewayRelationshipTag {
				continue
			}
			key := reason.Value
			suggestion, ok := suggestionsByValue[key]
			if !ok {
				suggestion = BrainSuggestion{
					ID:              deterministicID("brain-suggestion", investigationID, SuggestionKindRelationshipMotif, key),
					InvestigationID: investigationID,
					Kind:            SuggestionKindRelationshipMotif,
					Status:          SuggestionStatusActive,
					Title:           "Inspect repeated relationship motif",
					Summary:         fmt.Sprintf("Relationship pattern %q appears in active Brain firings.", reason.Label),
					SuggestedAction: "Inspect repeated relationship pattern",
					Score:           maxFloat(signal.Score, 0.58),
					Priority:        suggestionPriority(maxFloat(signal.Score, 0.58)),
					Reason:          reason.Detail,
					CreatedAt:       timestamp,
					UpdatedAt:       timestamp,
				}
			}
			suggestion.RelatedSignalIDs = cleanStringSet(append(suggestion.RelatedSignalIDs, signal.ID))
			suggestion.TargetInvestigationIDs = cleanStringSet(append(suggestion.TargetInvestigationIDs, signal.TargetInvestigationID))
			suggestionsByValue[key] = mergeSuggestionState(suggestion, existing, timestamp)
		}
	}
	suggestions := make([]BrainSuggestion, 0, len(suggestionsByValue))
	for _, suggestion := range suggestionsByValue {
		suggestions = append(suggestions, suggestion)
	}
	return suggestions
}

func memoryLinkCompareSuggestions(
	investigationID string,
	links []MemoryLink,
	existing map[string]BrainSuggestion,
	timestamp string,
) []BrainSuggestion {
	suggestions := make([]BrainSuggestion, 0, len(links))
	for _, link := range links {
		targetID := link.ToInvestigationID
		targetTitle := link.ToTitle
		if link.ToInvestigationID == investigationID {
			targetID = link.FromInvestigationID
			targetTitle = link.FromTitle
		}
		if targetID == "" || targetID == investigationID {
			continue
		}
		suggestion := BrainSuggestion{
			ID:                     deterministicID("brain-suggestion", investigationID, SuggestionKindMemoryLinkCompare, link.ID),
			InvestigationID:        investigationID,
			Kind:                   SuggestionKindMemoryLinkCompare,
			Status:                 SuggestionStatusActive,
			Title:                  "Compare durable memory link",
			Summary:                fmt.Sprintf("%s has a durable memory link to %s.", link.FromTitle, link.ToTitle),
			SuggestedAction:        "Compare linked memory",
			Score:                  maxFloat(link.Score, 0.50),
			Priority:               suggestionPriority(maxFloat(link.Score, 0.50)),
			Reason:                 fmt.Sprintf("Linked memory %q has fired %d time(s).", targetTitle, link.ActivationCount),
			RelatedMemoryLinkIDs:   []string{link.ID},
			RelatedSignalIDs:       cleanStringSet([]string{link.SignalID}),
			TargetInvestigationIDs: []string{targetID},
			CreatedAt:              timestamp,
			UpdatedAt:              timestamp,
		}
		suggestions = append(suggestions, mergeSuggestionState(suggestion, existing, timestamp))
	}
	return suggestions
}

func gapReviewSuggestion(
	investigationID string,
	signals []BrainSignal,
	existing map[string]BrainSuggestion,
	timestamp string,
) (BrainSuggestion, bool) {
	if len(signals) == 0 {
		return BrainSuggestion{}, false
	}
	sortSignals(signals)
	top := signals[0]
	signalIDs := make([]string, 0, minInt(3, len(signals)))
	targetIDs := make([]string, 0, minInt(3, len(signals)))
	for _, signal := range signals {
		signalIDs = append(signalIDs, signal.ID)
		targetIDs = append(targetIDs, signal.TargetInvestigationID)
		if len(signalIDs) == 3 {
			break
		}
	}
	suggestion := BrainSuggestion{
		ID:                     deterministicID("brain-suggestion", investigationID, SuggestionKindGapReview, strings.Join(cleanStringSet(signalIDs), ",")),
		InvestigationID:        investigationID,
		Kind:                   SuggestionKindGapReview,
		Status:                 SuggestionStatusActive,
		Title:                  "Decide whether this firing becomes memory",
		Summary:                fmt.Sprintf("%d active signal(s) have not become durable memory links yet.", len(signals)),
		SuggestedAction:        "Review before promoting memory",
		Score:                  maxFloat(top.Score, 0.42),
		Priority:               suggestionPriority(maxFloat(top.Score, 0.42)),
		Reason:                 "Active firings are present without a user decision on whether they should become durable memory.",
		RelatedSignalIDs:       cleanStringSet(signalIDs),
		TargetInvestigationIDs: cleanStringSet(targetIDs),
		CreatedAt:              timestamp,
		UpdatedAt:              timestamp,
	}
	return mergeSuggestionState(suggestion, existing, timestamp), true
}

func buildMemoryClusters(
	currentInvestigationID string,
	profiles []memoryProfile,
	signals map[string]BrainSignal,
	links map[string]MemoryLink,
	existing map[string]MemoryCluster,
	timestamp string,
) []MemoryCluster {
	seeds := collectClusterSeeds(profiles)
	clusters := make([]MemoryCluster, 0, len(seeds))
	for _, seed := range seeds {
		currentEvidence, hasCurrent := seed.Members[currentInvestigationID]
		if !hasCurrent || len(seed.Members) < 2 {
			continue
		}

		memberIDs := make([]string, 0, len(seed.Members))
		members := make([]MemoryClusterMember, 0, len(seed.Members))
		for investigationID, evidence := range seed.Members {
			memberIDs = append(memberIDs, investigationID)
			role := "memory"
			if investigationID == currentInvestigationID {
				role = "current"
			}
			members = append(members, MemoryClusterMember{
				InvestigationID: investigationID,
				Title:           evidence.Title,
				Role:            role,
			})
		}
		sort.Strings(memberIDs)
		sort.SliceStable(members, func(i, j int) bool {
			if members[i].Role == members[j].Role {
				return members[i].Title < members[j].Title
			}
			return members[i].Role == "current"
		})

		reasons := clusterReasonSamples(seed, currentEvidence, currentInvestigationID)
		signalIDs := matchingClusterSignalIDs(signals, seed.Gateway, seed.Value, currentInvestigationID, seed.Members)
		linkIDs := matchingClusterLinkIDs(links, seed.Gateway, seed.Value, seed.Members)
		score := scoreCluster(seed.Gateway, len(seed.Members), len(signalIDs), len(linkIDs))
		cluster := MemoryCluster{
			ID:                     deterministicID("brain-cluster", seed.Gateway, seed.Value),
			Label:                  seed.Label,
			Summary:                clusterSummary(seed, len(seed.Members), len(signalIDs), len(linkIDs)),
			Score:                  score,
			Status:                 clusterStatus(score),
			DominantGateway:        seed.Gateway,
			GatewayCounts:          map[string]int{seed.Gateway: len(seed.Members)},
			MemberInvestigationIDs: memberIDs,
			Members:                members,
			SignalIDs:              signalIDs,
			MemoryLinkIDs:          linkIDs,
			ReasonSamples:          reasons,
			CreatedAt:              timestamp,
			UpdatedAt:              timestamp,
			LastActivatedAt:        timestamp,
		}
		if previous, ok := existing[cluster.ID]; ok {
			cluster.CreatedAt = previous.CreatedAt
			if cluster.CreatedAt == "" {
				cluster.CreatedAt = timestamp
			}
			cluster.Pinned = previous.Pinned
			cluster.Hidden = previous.Hidden
		}
		clusters = append(clusters, cluster)
	}
	sortClusters(clusters)
	return clusters
}

func collectClusterSeeds(profiles []memoryProfile) map[string]clusterSeed {
	seeds := make(map[string]clusterSeed)
	for _, profile := range profiles {
		for value, evidence := range profile.Entities {
			addClusterEvidence(seeds, GatewayEntityDate, value, profile, evidence)
		}
		for value, evidence := range profile.SourceDomains {
			addClusterEvidence(seeds, GatewaySourceDomain, value, profile, evidence)
		}
		for value, evidence := range profile.RelationshipTags {
			addClusterEvidence(seeds, GatewayRelationshipTag, value, profile, evidence)
		}
	}
	return seeds
}

func addClusterEvidence(seeds map[string]clusterSeed, gateway string, value string, profile memoryProfile, evidence signalEvidence) {
	value = strings.TrimSpace(value)
	if value == "" {
		return
	}
	key := gateway + "\x00" + value
	seed, ok := seeds[key]
	if !ok {
		seed = clusterSeed{
			Gateway: gateway,
			Value:   value,
			Label:   evidence.Label,
			Kind:    evidence.Kind,
			Members: make(map[string]clusterEvidence),
		}
	}
	if seed.Label == "" {
		seed.Label = evidence.Label
	}
	if seed.Kind == "" {
		seed.Kind = evidence.Kind
	}
	seed.Members[profile.ID] = clusterEvidence{
		InvestigationID: profile.ID,
		Title:           profile.Title,
		Label:           evidence.Label,
		Kind:            evidence.Kind,
		NodeIDs:         evidence.NodeIDs,
	}
	seeds[key] = seed
}

func clusterReasonSamples(seed clusterSeed, current clusterEvidence, currentInvestigationID string) []SignalReason {
	reasons := make([]SignalReason, 0, len(seed.Members)-1)
	targetIDs := make([]string, 0, len(seed.Members))
	for investigationID := range seed.Members {
		if investigationID != currentInvestigationID {
			targetIDs = append(targetIDs, investigationID)
		}
	}
	sort.Strings(targetIDs)
	for _, investigationID := range targetIDs {
		target := seed.Members[investigationID]
		reasons = append(reasons, SignalReason{
			Gateway:        seed.Gateway,
			Value:          seed.Value,
			Label:          seed.Label,
			Detail:         clusterReasonDetail(seed, target.Title),
			CurrentNodeIDs: cleanStringSet(current.NodeIDs),
			TargetNodeIDs:  cleanStringSet(target.NodeIDs),
		})
		if len(reasons) == 3 {
			break
		}
	}
	return reasons
}

func clusterReasonDetail(seed clusterSeed, targetTitle string) string {
	switch seed.Gateway {
	case GatewayEntityDate:
		kind := strings.TrimSpace(seed.Kind)
		if kind == "" {
			kind = "tag"
		}
		return fmt.Sprintf("Shared %s %q appears in %s.", kind, seed.Label, targetTitle)
	case GatewaySourceDomain:
		return fmt.Sprintf("Source domain %q recurs in %s.", seed.Label, targetTitle)
	case GatewayRelationshipTag:
		return fmt.Sprintf("Relationship pattern %q recurs in %s.", seed.Label, targetTitle)
	default:
		return fmt.Sprintf("Memory evidence %q recurs in %s.", seed.Label, targetTitle)
	}
}

func matchingClusterSignalIDs(
	signals map[string]BrainSignal,
	gateway string,
	value string,
	currentInvestigationID string,
	members map[string]clusterEvidence,
) []string {
	ids := make([]string, 0)
	for _, signal := range signals {
		if signal.Dismissed {
			continue
		}
		if signal.InvestigationID != currentInvestigationID && signal.TargetInvestigationID != currentInvestigationID {
			continue
		}
		if _, ok := members[signal.InvestigationID]; !ok {
			continue
		}
		if _, ok := members[signal.TargetInvestigationID]; !ok {
			continue
		}
		if reasonsContainGatewayValue(signal.Reasons, gateway, value) {
			ids = append(ids, signal.ID)
		}
	}
	return cleanStringSet(ids)
}

func matchingClusterLinkIDs(links map[string]MemoryLink, gateway string, value string, members map[string]clusterEvidence) []string {
	ids := make([]string, 0)
	for _, link := range links {
		if _, ok := members[link.FromInvestigationID]; !ok {
			continue
		}
		if _, ok := members[link.ToInvestigationID]; !ok {
			continue
		}
		if reasonsContainGatewayValue(link.Reasons, gateway, value) {
			ids = append(ids, link.ID)
		}
	}
	return cleanStringSet(ids)
}

func reasonsContainGatewayValue(reasons []SignalReason, gateway string, value string) bool {
	for _, reason := range reasons {
		if reason.Gateway == gateway && reason.Value == value {
			return true
		}
	}
	return false
}

func scoreCluster(gateway string, memberCount int, signalCount int, linkCount int) float64 {
	score := 0.0
	switch gateway {
	case GatewayEntityDate:
		score = 0.58
	case GatewayRelationshipTag:
		score = 0.52
	case GatewaySourceDomain:
		score = 0.45
	default:
		score = 0.40
	}
	if memberCount > 2 {
		score += minFloat(0.24, float64(memberCount-2)*0.08)
	}
	score += minFloat(0.12, float64(signalCount)*0.04)
	score += minFloat(0.16, float64(linkCount)*0.08)
	if score > 0.98 {
		return 0.98
	}
	return score
}

func clusterStatus(score float64) string {
	if score >= 0.75 {
		return "active"
	}
	if score >= 0.50 {
		return "warm"
	}
	return "dormant"
}

func clusterSummary(seed clusterSeed, memberCount int, signalCount int, linkCount int) string {
	return fmt.Sprintf(
		"%s links %d investigations through %s recall with %d active signals and %d durable memory links.",
		seed.Label,
		memberCount,
		formatGatewayName(seed.Gateway),
		signalCount,
		linkCount,
	)
}

func formatGatewayName(gateway string) string {
	switch gateway {
	case GatewayEntityDate:
		return "entity/date"
	case GatewaySourceDomain:
		return "source-domain"
	case GatewayRelationshipTag:
		return "relationship-pattern"
	default:
		return "memory"
	}
}

func sortClusters(clusters []MemoryCluster) {
	sort.SliceStable(clusters, func(i, j int) bool {
		if clusters[i].Pinned != clusters[j].Pinned {
			return clusters[i].Pinned
		}
		if clusters[i].Hidden != clusters[j].Hidden {
			return !clusters[i].Hidden
		}
		if clusters[i].Score == clusters[j].Score {
			return clusters[i].Label < clusters[j].Label
		}
		return clusters[i].Score > clusters[j].Score
	})
}

func activeSignalsForInvestigation(signals map[string]BrainSignal, investigationID string) []BrainSignal {
	result := make([]BrainSignal, 0)
	for _, signal := range signals {
		if signal.Dismissed || signal.Linked {
			continue
		}
		if signal.InvestigationID != investigationID {
			continue
		}
		result = append(result, signal)
	}
	sortSignals(result)
	return result
}

func linksForInvestigationMap(links map[string]MemoryLink, investigationID string) []MemoryLink {
	result := make([]MemoryLink, 0)
	for _, link := range links {
		if link.FromInvestigationID == investigationID || link.ToInvestigationID == investigationID {
			result = append(result, link)
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Score == result[j].Score {
			return result[i].CreatedAt > result[j].CreatedAt
		}
		return result[i].Score > result[j].Score
	})
	return result
}

func clustersForInvestigationMap(clusters map[string]MemoryCluster, investigationID string) []MemoryCluster {
	result := make([]MemoryCluster, 0)
	for _, cluster := range clusters {
		if containsString(cluster.MemberInvestigationIDs, investigationID) {
			result = append(result, cluster)
		}
	}
	sortClusters(result)
	return result
}

func clusterTargetInvestigationIDs(cluster MemoryCluster, investigationID string) []string {
	targetIDs := make([]string, 0, len(cluster.MemberInvestigationIDs))
	for _, memberID := range cluster.MemberInvestigationIDs {
		if memberID != investigationID {
			targetIDs = append(targetIDs, memberID)
		}
	}
	return cleanStringSet(targetIDs)
}

func mergeSuggestionState(suggestion BrainSuggestion, existing map[string]BrainSuggestion, timestamp string) BrainSuggestion {
	previous, ok := existing[suggestion.ID]
	if !ok {
		if suggestion.Status == "" {
			suggestion.Status = SuggestionStatusActive
		}
		return normalizeSuggestionCollections(suggestion)
	}
	suggestion.CreatedAt = previous.CreatedAt
	if suggestion.CreatedAt == "" {
		suggestion.CreatedAt = timestamp
	}
	suggestion.Status = previous.Status
	if suggestion.Status == "" {
		suggestion.Status = SuggestionStatusActive
	}
	suggestion.DismissedAt = previous.DismissedAt
	suggestion.ReviewedAt = previous.ReviewedAt
	if suggestion.Status == SuggestionStatusDismissed && suggestion.DismissedAt == "" {
		suggestion.DismissedAt = timestamp
	}
	if suggestion.Status == SuggestionStatusReviewed && suggestion.ReviewedAt == "" {
		suggestion.ReviewedAt = timestamp
	}
	return normalizeSuggestionCollections(suggestion)
}

func normalizeSuggestionCollections(suggestion BrainSuggestion) BrainSuggestion {
	suggestion.RelatedSignalIDs = cleanStringSet(suggestion.RelatedSignalIDs)
	suggestion.RelatedMemoryLinkIDs = cleanStringSet(suggestion.RelatedMemoryLinkIDs)
	suggestion.RelatedClusterIDs = cleanStringSet(suggestion.RelatedClusterIDs)
	suggestion.TargetInvestigationIDs = cleanStringSet(suggestion.TargetInvestigationIDs)
	return suggestion
}

func suggestionPriority(score float64) string {
	if score >= 0.78 {
		return "high"
	}
	if score >= 0.55 {
		return "medium"
	}
	return "low"
}

func sortSuggestions(suggestions []BrainSuggestion) {
	statusRank := func(status string) int {
		switch status {
		case SuggestionStatusActive:
			return 0
		case SuggestionStatusReviewed:
			return 1
		default:
			return 2
		}
	}
	priorityRank := func(priority string) int {
		switch priority {
		case "high":
			return 0
		case "medium":
			return 1
		default:
			return 2
		}
	}
	sort.SliceStable(suggestions, func(i, j int) bool {
		if statusRank(suggestions[i].Status) != statusRank(suggestions[j].Status) {
			return statusRank(suggestions[i].Status) < statusRank(suggestions[j].Status)
		}
		if priorityRank(suggestions[i].Priority) != priorityRank(suggestions[j].Priority) {
			return priorityRank(suggestions[i].Priority) < priorityRank(suggestions[j].Priority)
		}
		if suggestions[i].Score == suggestions[j].Score {
			return suggestions[i].Title < suggestions[j].Title
		}
		return suggestions[i].Score > suggestions[j].Score
	})
}

func HandleAPI(w http.ResponseWriter, r *http.Request, service *Service) {
	if service == nil {
		service = NewService("abdomen_vault")
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET,PUT,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	path := strings.Trim(r.URL.Path, "/")
	if path == "api/brain/signals" {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		investigationID := r.URL.Query().Get("investigationId")
		signals, err := service.GenerateSignals(investigationID)
		writeAPIResult(w, signals, err)
		return
	}
	if path == "api/brain/links" {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		links, err := service.LinksForInvestigation(r.URL.Query().Get("investigationId"))
		writeAPIResult(w, links, err)
		return
	}
	if path == "api/brain/clusters" {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		clusters, err := service.ClustersForInvestigation(r.URL.Query().Get("investigationId"))
		writeAPIResult(w, clusters, err)
		return
	}
	if path == "api/brain/suggestions" {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		suggestions, err := service.SuggestionsForInvestigation(r.URL.Query().Get("investigationId"))
		writeAPIResult(w, suggestions, err)
		return
	}

	parts := strings.Split(path, "/")
	if len(parts) == 5 && parts[0] == "api" && parts[1] == "brain" && parts[2] == "suggestions" {
		if r.Method != http.MethodPut {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		switch parts[4] {
		case "dismiss":
			suggestion, err := service.DismissSuggestion(parts[3])
			writeAPIResult(w, suggestion, err)
		case "review":
			suggestion, err := service.MarkSuggestionReviewed(parts[3])
			writeAPIResult(w, suggestion, err)
		default:
			http.NotFound(w, r)
		}
		return
	}
	if len(parts) == 5 && parts[0] == "api" && parts[1] == "brain" && parts[2] == "clusters" {
		if r.Method != http.MethodPut {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		switch parts[4] {
		case "pin":
			cluster, err := service.ToggleClusterPin(parts[3])
			writeAPIResult(w, cluster, err)
		case "hide":
			cluster, err := service.HideCluster(parts[3])
			writeAPIResult(w, cluster, err)
		case "unhide":
			cluster, err := service.UnhideCluster(parts[3])
			writeAPIResult(w, cluster, err)
		default:
			http.NotFound(w, r)
		}
		return
	}
	if len(parts) == 5 && parts[0] == "api" && parts[1] == "brain" && parts[2] == "links" {
		if r.Method != http.MethodPut {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		switch parts[4] {
		case "forget":
			link, err := service.ForgetLink(parts[3])
			writeAPIResult(w, link, err)
		default:
			http.NotFound(w, r)
		}
		return
	}
	if len(parts) == 5 && parts[0] == "api" && parts[1] == "brain" && parts[2] == "signals" {
		if r.Method != http.MethodPut {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		switch parts[4] {
		case "dismiss":
			signal, err := service.DismissSignal(parts[3])
			writeAPIResult(w, signal, err)
		case "link":
			link, err := service.PromoteSignal(parts[3])
			writeAPIResult(w, link, err)
		default:
			http.NotFound(w, r)
		}
		return
	}

	http.NotFound(w, r)
}

func writeAPIResult(w http.ResponseWriter, payload interface{}, err error) {
	if err != nil {
		switch {
		case errors.Is(err, models.ErrInvalidInvestigationID):
			http.Error(w, "invalid investigation id", http.StatusBadRequest)
		case errors.Is(err, models.ErrInvestigationNotFound):
			http.Error(w, "investigation not found", http.StatusNotFound)
		case errors.Is(err, ErrSignalNotFound):
			http.Error(w, "signal not found", http.StatusNotFound)
		case errors.Is(err, ErrLinkNotFound):
			http.Error(w, "memory link not found", http.StatusNotFound)
		case errors.Is(err, ErrClusterNotFound):
			http.Error(w, "memory cluster not found", http.StatusNotFound)
		case errors.Is(err, ErrSuggestionNotFound):
			http.Error(w, "brain suggestion not found", http.StatusNotFound)
		default:
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (s *Service) buildProfile(record models.InvestigationRecord) (memoryProfile, error) {
	profile := memoryProfile{
		ID:               record.ID,
		Title:            displayTitle(record),
		Entities:         make(map[string]signalEvidence),
		SourceDomains:    make(map[string]signalEvidence),
		RelationshipTags: make(map[string]signalEvidence),
	}

	rawBoard, err := s.store.LoadJSON(record.ID, models.InvestigationBoardFilename)
	if err != nil {
		if errors.Is(err, models.ErrInvestigationNotFound) {
			return profile, nil
		}
		return profile, err
	}

	var board persistedBoard
	if err := json.Unmarshal(rawBoard, &board); err != nil {
		return profile, err
	}

	for _, node := range board.Nodes {
		nodeID := strings.TrimSpace(node.ID)
		if nodeID == "" {
			nodeID = strings.TrimSpace(node.Data.ID)
		}
		if nodeID == "" {
			continue
		}
		searchableText := strings.Join([]string{
			node.Data.Title,
			node.Data.Summary,
			node.Data.FullText,
		}, "\n")
		for _, entity := range extractTaggedEntityEvidence(searchableText, nodeID) {
			profile.Entities[entity.Value] = mergeEvidence(profile.Entities[entity.Value], entity.Evidence)
		}
		for _, sourceURL := range append([]string{node.Data.SourceURL}, node.Data.SourceURLs...) {
			if domain := sourceDomain(sourceURL); domain != "" {
				profile.SourceDomains[domain] = mergeEvidence(profile.SourceDomains[domain], signalEvidence{
					Label:   domain,
					Kind:    GatewaySourceDomain,
					NodeIDs: []string{nodeID},
				})
			}
		}
	}

	for _, edge := range board.Edges {
		tag := relationshipTag(edge.Data.Tag)
		if tag == "" {
			tag = relationshipTag(edge.Data.DisplayLabel)
		}
		if tag == "" {
			tag = relationshipTag(edge.Data.Label)
		}
		if tag == "" {
			tag = relationshipTag(edge.Label)
		}
		if tag == "" {
			continue
		}
		nodeIDs := cleanStringSet([]string{edge.Source, edge.Target})
		profile.RelationshipTags[tag] = mergeEvidence(profile.RelationshipTags[tag], signalEvidence{
			Label:   tag,
			Kind:    GatewayRelationshipTag,
			NodeIDs: nodeIDs,
		})
	}

	rawRelationships, err := s.store.LoadJSON(record.ID, models.InvestigationRelationshipsFilename)
	if err == nil {
		var relationships models.RelationshipResult
		if json.Unmarshal(rawRelationships, &relationships) == nil {
			for _, connection := range relationships.Connections {
				tag := relationshipTag(connection.Tag)
				if tag == "" {
					continue
				}
				nodeIDs := cleanStringSet(append([]string{connection.Source, connection.Target}, connection.EvidenceNodeIDs...))
				profile.RelationshipTags[tag] = mergeEvidence(profile.RelationshipTags[tag], signalEvidence{
					Label:   tag,
					Kind:    GatewayRelationshipTag,
					NodeIDs: nodeIDs,
				})
			}
		}
	}

	return profile, nil
}

type extractedEvidence struct {
	Value    string
	Evidence signalEvidence
}

func extractTaggedEntityEvidence(text string, nodeID string) []extractedEvidence {
	matches := taggedEntityPattern.FindAllStringSubmatch(text, -1)
	result := make([]extractedEvidence, 0, len(matches))
	seen := make(map[string]struct{})
	for _, match := range matches {
		if len(match) != 3 {
			continue
		}
		entityType := strings.ToUpper(strings.TrimSpace(match[1]))
		label := normalizeDisplayText(match[2])
		value := normalizeKey(label)
		if value == "" {
			continue
		}
		key := entityType + "|" + value
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, extractedEvidence{
			Value: key,
			Evidence: signalEvidence{
				Label:   label,
				Kind:    entityType,
				NodeIDs: []string{nodeID},
			},
		})
	}
	return result
}

func buildSignal(current memoryProfile, target memoryProfile, timestamp string) (BrainSignal, bool) {
	reasons := make([]SignalReason, 0)
	reasons = append(reasons, matchingEntityReasons(current, target)...)
	reasons = append(reasons, matchingSourceReasons(current, target)...)
	reasons = append(reasons, matchingRelationshipReasons(current, target)...)
	if len(reasons) == 0 {
		return BrainSignal{}, false
	}

	sort.SliceStable(reasons, func(i, j int) bool {
		if reasons[i].Gateway == reasons[j].Gateway {
			return reasons[i].Value < reasons[j].Value
		}
		return gatewayRank(reasons[i].Gateway) < gatewayRank(reasons[j].Gateway)
	})

	gateways := uniqueGateways(reasons)
	score := scoreReasons(reasons)
	signal := BrainSignal{
		InvestigationID:       current.ID,
		InvestigationTitle:    current.Title,
		TargetInvestigationID: target.ID,
		TargetTitle:           target.Title,
		Score:                 score,
		Gateways:              gateways,
		Reasons:               reasons,
		SuggestedAction:       suggestedAction(gateways),
		CreatedAt:             timestamp,
		UpdatedAt:             timestamp,
	}
	signal.ID = deterministicID("brain-signal", signal.InvestigationID, signal.TargetInvestigationID, reasonSignature(reasons))
	return signal, true
}

func shouldAutoPromoteSignal(signal BrainSignal) bool {
	if signal.Dismissed || signal.Linked || len(signal.Gateways) < 2 {
		return false
	}
	if !hasMeaningfulAutoPromotionEvidence(signal) {
		return false
	}
	if signal.Score >= autoPromotionScoreThreshold {
		return true
	}
	return signal.ActivationCount >= repeatedPromotionActivationCount && signal.Score >= repeatedPromotionScoreThreshold
}

func hasMeaningfulAutoPromotionEvidence(signal BrainSignal) bool {
	for _, reason := range signal.Reasons {
		switch reason.Gateway {
		case GatewayRelationshipTag:
			return true
		case GatewayEntityDate:
			if !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(reason.Value)), "DATE|") {
				return true
			}
		}
	}
	return false
}

func newMemoryLink(signal BrainSignal, timestamp string, promotionType string) MemoryLink {
	activationCount := signal.ActivationCount
	if activationCount < 1 {
		activationCount = 1
	}
	if strings.TrimSpace(promotionType) == "" {
		promotionType = promotionTypeManual
	}
	return MemoryLink{
		ID:                  memoryPairLinkID(signal.InvestigationID, signal.TargetInvestigationID),
		SignalID:            signal.ID,
		FromInvestigationID: signal.InvestigationID,
		FromTitle:           signal.InvestigationTitle,
		ToInvestigationID:   signal.TargetInvestigationID,
		ToTitle:             signal.TargetTitle,
		Score:               signal.Score,
		Gateways:            uniqueSortedGateways(signal.Gateways),
		Reasons:             uniqueSignalReasons(signal.Reasons),
		SuggestedAction:     suggestedMemoryLinkAction(promotionType),
		CreatedAt:           timestamp,
		UpdatedAt:           timestamp,
		LastFiredAt:         timestamp,
		ActivationCount:     activationCount,
		PromotionType:       promotionType,
	}
}

func reinforceMemoryLink(link MemoryLink, signal BrainSignal, timestamp string, incrementActivation bool, promotionType string) MemoryLink {
	if strings.TrimSpace(link.ID) == "" {
		link.ID = memoryPairLinkID(signal.InvestigationID, signal.TargetInvestigationID)
	}
	if strings.TrimSpace(link.SignalID) == "" {
		link.SignalID = signal.ID
	}
	if strings.TrimSpace(link.FromInvestigationID) == "" {
		link.FromInvestigationID = signal.InvestigationID
		link.FromTitle = signal.InvestigationTitle
	}
	if strings.TrimSpace(link.ToInvestigationID) == "" {
		link.ToInvestigationID = signal.TargetInvestigationID
		link.ToTitle = signal.TargetTitle
	}
	if strings.TrimSpace(link.CreatedAt) == "" {
		link.CreatedAt = timestamp
	}
	if signal.Score > link.Score {
		link.Score = signal.Score
	}
	link.Gateways = uniqueSortedGateways(append(link.Gateways, signal.Gateways...))
	link.Reasons = uniqueSignalReasons(append(link.Reasons, signal.Reasons...))
	link.UpdatedAt = timestamp
	link.LastFiredAt = timestamp
	if link.ActivationCount < 1 {
		link.ActivationCount = 1
	}
	if incrementActivation {
		link.ActivationCount++
	}
	link.PromotionType = mergedPromotionType(link.PromotionType, promotionType)
	link.SuggestedAction = suggestedMemoryLinkAction(link.PromotionType)
	return link
}

func suggestedMemoryLinkAction(promotionType string) string {
	if promotionType == promotionTypeAuto {
		return "Auto-promoted memory link"
	}
	return "Promoted memory link"
}

func mergedPromotionType(existing string, incoming string) string {
	existing = strings.TrimSpace(existing)
	incoming = strings.TrimSpace(incoming)
	if existing == promotionTypeManual || incoming == promotionTypeManual {
		return promotionTypeManual
	}
	if existing == promotionTypeAuto || incoming == promotionTypeAuto {
		return promotionTypeAuto
	}
	return promotionTypeManual
}

func memoryPairLinkID(leftID string, rightID string) string {
	ids := []string{strings.TrimSpace(leftID), strings.TrimSpace(rightID)}
	sort.Strings(ids)
	return deterministicID("brain-link", ids[0], ids[1])
}

func uniqueSortedGateways(gateways []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(gateways))
	for _, gateway := range gateways {
		gateway = strings.TrimSpace(gateway)
		if gateway == "" || seen[gateway] {
			continue
		}
		seen[gateway] = true
		result = append(result, gateway)
	}
	sort.SliceStable(result, func(i, j int) bool {
		if gatewayRank(result[i]) == gatewayRank(result[j]) {
			return result[i] < result[j]
		}
		return gatewayRank(result[i]) < gatewayRank(result[j])
	})
	return result
}

func uniqueSignalReasons(reasons []SignalReason) []SignalReason {
	seen := make(map[string]bool)
	result := make([]SignalReason, 0, len(reasons))
	for _, reason := range reasons {
		key := signalReasonKey(reason)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, reason)
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Gateway == result[j].Gateway {
			return result[i].Value < result[j].Value
		}
		return gatewayRank(result[i].Gateway) < gatewayRank(result[j].Gateway)
	})
	return result
}

func signalReasonKey(reason SignalReason) string {
	return strings.Join([]string{
		reason.Gateway,
		reason.Value,
		reason.Detail,
		strings.Join(cleanStringSet(reason.CurrentNodeIDs), ","),
		strings.Join(cleanStringSet(reason.TargetNodeIDs), ","),
	}, ":")
}

func matchingEntityReasons(current memoryProfile, target memoryProfile) []SignalReason {
	reasons := make([]SignalReason, 0)
	for value, currentEvidence := range current.Entities {
		targetEvidence, ok := target.Entities[value]
		if !ok {
			continue
		}
		entityType := currentEvidence.Kind
		reasons = append(reasons, SignalReason{
			Gateway:        GatewayEntityDate,
			Value:          value,
			Label:          currentEvidence.Label,
			Detail:         fmt.Sprintf("Shared %s %q appears in both investigations.", entityType, currentEvidence.Label),
			CurrentNodeIDs: cleanStringSet(currentEvidence.NodeIDs),
			TargetNodeIDs:  cleanStringSet(targetEvidence.NodeIDs),
		})
	}
	return limitReasons(reasons, 4)
}

func matchingSourceReasons(current memoryProfile, target memoryProfile) []SignalReason {
	reasons := make([]SignalReason, 0)
	for domain, currentEvidence := range current.SourceDomains {
		targetEvidence, ok := target.SourceDomains[domain]
		if !ok {
			continue
		}
		reasons = append(reasons, SignalReason{
			Gateway:        GatewaySourceDomain,
			Value:          domain,
			Label:          domain,
			Detail:         fmt.Sprintf("Source domain %q appears in both investigations.", domain),
			CurrentNodeIDs: cleanStringSet(currentEvidence.NodeIDs),
			TargetNodeIDs:  cleanStringSet(targetEvidence.NodeIDs),
		})
	}
	return limitReasons(reasons, 3)
}

func matchingRelationshipReasons(current memoryProfile, target memoryProfile) []SignalReason {
	reasons := make([]SignalReason, 0)
	for tag, currentEvidence := range current.RelationshipTags {
		targetEvidence, ok := target.RelationshipTags[tag]
		if !ok {
			continue
		}
		reasons = append(reasons, SignalReason{
			Gateway:        GatewayRelationshipTag,
			Value:          tag,
			Label:          tag,
			Detail:         fmt.Sprintf("Relationship pattern %q appears in both investigations.", tag),
			CurrentNodeIDs: cleanStringSet(currentEvidence.NodeIDs),
			TargetNodeIDs:  cleanStringSet(targetEvidence.NodeIDs),
		})
	}
	return limitReasons(reasons, 3)
}

func scoreReasons(reasons []SignalReason) float64 {
	score := 0.0
	seen := make(map[string]bool)
	for _, reason := range reasons {
		if !seen[reason.Gateway] {
			switch reason.Gateway {
			case GatewayEntityDate:
				score += 0.42
			case GatewaySourceDomain:
				score += 0.24
			case GatewayRelationshipTag:
				score += 0.30
			}
			seen[reason.Gateway] = true
		} else {
			score += 0.04
		}
	}
	if score > 0.98 {
		return 0.98
	}
	return score
}

func suggestedAction(gateways []string) string {
	for _, gateway := range gateways {
		switch gateway {
		case GatewayRelationshipTag:
			return "Inspect repeated relationship pattern"
		case GatewaySourceDomain:
			return "Compare source domain"
		case GatewayEntityDate:
			return "Review older case"
		}
	}
	return "Promote memory link"
}

func uniqueGateways(reasons []SignalReason) []string {
	seen := make(map[string]bool)
	gateways := make([]string, 0, 3)
	for _, reason := range reasons {
		if seen[reason.Gateway] {
			continue
		}
		seen[reason.Gateway] = true
		gateways = append(gateways, reason.Gateway)
	}
	sort.SliceStable(gateways, func(i, j int) bool {
		return gatewayRank(gateways[i]) < gatewayRank(gateways[j])
	})
	return gateways
}

func gatewayRank(gateway string) int {
	switch gateway {
	case GatewayEntityDate:
		return 0
	case GatewaySourceDomain:
		return 1
	case GatewayRelationshipTag:
		return 2
	default:
		return 9
	}
}

func limitReasons(reasons []SignalReason, limit int) []SignalReason {
	sort.SliceStable(reasons, func(i, j int) bool {
		return reasons[i].Value < reasons[j].Value
	})
	if len(reasons) <= limit {
		return reasons
	}
	return reasons[:limit]
}

func reasonSignature(reasons []SignalReason) string {
	parts := make([]string, 0, len(reasons))
	for _, reason := range reasons {
		parts = append(parts, strings.Join([]string{
			reason.Gateway,
			reason.Value,
			strings.Join(cleanStringSet(reason.CurrentNodeIDs), ","),
			strings.Join(cleanStringSet(reason.TargetNodeIDs), ","),
		}, ":"))
	}
	sort.Strings(parts)
	return strings.Join(parts, "|")
}

func sortSignals(signals []BrainSignal) {
	sort.SliceStable(signals, func(i, j int) bool {
		if signals[i].Score == signals[j].Score {
			return signals[i].TargetTitle < signals[j].TargetTitle
		}
		return signals[i].Score > signals[j].Score
	})
}

func mergeEvidence(existing signalEvidence, incoming signalEvidence) signalEvidence {
	if existing.Label == "" {
		existing.Label = incoming.Label
	}
	if existing.Kind == "" {
		existing.Kind = incoming.Kind
	}
	existing.NodeIDs = cleanStringSet(append(existing.NodeIDs, incoming.NodeIDs...))
	return existing
}

func displayTitle(record models.InvestigationRecord) string {
	if strings.TrimSpace(record.DisplayTopic) != "" {
		return strings.TrimSpace(record.DisplayTopic)
	}
	if strings.TrimSpace(record.Topic) != "" {
		return strings.TrimSpace(record.Topic)
	}
	return record.ID
}

func normalizeDisplayText(value string) string {
	return spacePattern.ReplaceAllString(strings.TrimSpace(value), " ")
}

func normalizeKey(value string) string {
	return strings.ToLower(normalizeDisplayText(value))
}

func sourceDomain(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Hostname() == "" {
		return ""
	}
	host := strings.ToLower(parsed.Hostname())
	return strings.TrimPrefix(host, "www.")
}

func relationshipTag(value string) string {
	tag := strings.ToUpper(strings.TrimSpace(value))
	tag = strings.ReplaceAll(tag, " ", "_")
	tag = strings.ReplaceAll(tag, "-", "_")
	return tag
}

func cleanStringSet(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		cleaned = append(cleaned, value)
	}
	sort.Strings(cleaned)
	return cleaned
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func minFloat(left float64, right float64) float64 {
	if left < right {
		return left
	}
	return right
}

func maxFloat(left float64, right float64) float64 {
	if left > right {
		return left
	}
	return right
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func deterministicID(prefix string, parts ...string) string {
	hash := sha1.Sum([]byte(strings.Join(parts, "|")))
	return prefix + "-" + hex.EncodeToString(hash[:])[:16]
}

func (s *Service) brainDir() string {
	return filepath.Join(s.vaultRoot, brainDirectoryName)
}

func (s *Service) loadSignals() (map[string]BrainSignal, error) {
	signals := []BrainSignal{}
	if err := s.loadBrainJSON(signalsFilename, &signals); err != nil {
		return nil, err
	}
	byID := make(map[string]BrainSignal, len(signals))
	for _, signal := range signals {
		if strings.TrimSpace(signal.ID) != "" {
			byID[signal.ID] = signal
		}
	}
	return byID, nil
}

func (s *Service) saveSignals(signals map[string]BrainSignal) error {
	list := make([]BrainSignal, 0, len(signals))
	for _, signal := range signals {
		list = append(list, signal)
	}
	sortSignals(list)
	return s.saveBrainJSON(signalsFilename, list)
}

func (s *Service) loadLinks() (map[string]MemoryLink, error) {
	links := []MemoryLink{}
	if err := s.loadBrainJSON(linksFilename, &links); err != nil {
		return nil, err
	}
	byID := make(map[string]MemoryLink, len(links))
	for _, link := range links {
		if strings.TrimSpace(link.ID) != "" {
			byID[link.ID] = link
		}
	}
	return byID, nil
}

func (s *Service) saveLinks(links map[string]MemoryLink) error {
	list := make([]MemoryLink, 0, len(links))
	for _, link := range links {
		list = append(list, link)
	}
	sort.SliceStable(list, func(i, j int) bool {
		return list[i].CreatedAt > list[j].CreatedAt
	})
	return s.saveBrainJSON(linksFilename, list)
}

func (s *Service) loadClusters() (map[string]MemoryCluster, error) {
	clusters := []MemoryCluster{}
	if err := s.loadBrainJSON(clustersFilename, &clusters); err != nil {
		return nil, err
	}
	byID := make(map[string]MemoryCluster, len(clusters))
	for _, cluster := range clusters {
		if strings.TrimSpace(cluster.ID) != "" {
			byID[cluster.ID] = cluster
		}
	}
	return byID, nil
}

func (s *Service) saveClusters(clusters map[string]MemoryCluster) error {
	list := make([]MemoryCluster, 0, len(clusters))
	for _, cluster := range clusters {
		list = append(list, cluster)
	}
	sortClusters(list)
	return s.saveBrainJSON(clustersFilename, list)
}

func (s *Service) loadSuggestions() (map[string]BrainSuggestion, error) {
	suggestions := []BrainSuggestion{}
	if err := s.loadBrainJSON(suggestionsFilename, &suggestions); err != nil {
		return nil, err
	}
	byID := make(map[string]BrainSuggestion, len(suggestions))
	for _, suggestion := range suggestions {
		if strings.TrimSpace(suggestion.ID) != "" {
			byID[suggestion.ID] = normalizeSuggestionCollections(suggestion)
		}
	}
	return byID, nil
}

func (s *Service) saveSuggestions(suggestions map[string]BrainSuggestion) error {
	list := make([]BrainSuggestion, 0, len(suggestions))
	for _, suggestion := range suggestions {
		list = append(list, normalizeSuggestionCollections(suggestion))
	}
	sortSuggestions(list)
	return s.saveBrainJSON(suggestionsFilename, list)
}

func (s *Service) loadBrainJSON(filename string, target interface{}) error {
	path := filepath.Join(s.brainDir(), filename)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, target)
}

func (s *Service) saveBrainJSON(filename string, payload interface{}) error {
	if err := os.MkdirAll(s.brainDir(), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.brainDir(), filename), data, 0644)
}
