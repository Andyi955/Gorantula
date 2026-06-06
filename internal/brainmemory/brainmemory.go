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

	"spider-agent/models"
)

const (
	GatewayEntityDate      = "entity-date"
	GatewaySourceDomain    = "source-domain"
	GatewayRelationshipTag = "relationship-tag"

	brainDirectoryName = "brain"
	signalsFilename    = "signals.json"
	linksFilename      = "links.json"
)

var (
	ErrSignalNotFound = errors.New("brain signal not found")

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
			if signal.CreatedAt == "" {
				signal.CreatedAt = now
			}
		}
		nextSignals[signal.ID] = signal
		if !signal.Dismissed && !signal.Linked {
			activeSignals = append(activeSignals, signal)
		}
	}

	sortSignals(activeSignals)
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
	linkID := deterministicID("brain-link", signal.InvestigationID, signal.TargetInvestigationID, signal.ID)
	if existing, exists := links[linkID]; exists {
		signal.Linked = true
		signal.LinkID = existing.ID
		signal.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		signals[signal.ID] = signal
		_ = s.saveSignals(signals)
		return existing, nil
	}

	now := time.Now().UTC().Format(time.RFC3339)
	link := MemoryLink{
		ID:                  linkID,
		SignalID:            signal.ID,
		FromInvestigationID: signal.InvestigationID,
		FromTitle:           signal.InvestigationTitle,
		ToInvestigationID:   signal.TargetInvestigationID,
		ToTitle:             signal.TargetTitle,
		Score:               signal.Score,
		Gateways:            append([]string(nil), signal.Gateways...),
		Reasons:             append([]SignalReason(nil), signal.Reasons...),
		SuggestedAction:     "Promoted memory link",
		CreatedAt:           now,
	}
	links[link.ID] = link
	signal.Linked = true
	signal.LinkID = link.ID
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

	parts := strings.Split(path, "/")
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
