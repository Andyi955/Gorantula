package brain

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"spider-agent/models"
)

// NodeContextPayload represents where an entity was found
type NodeContextPayload struct {
	VaultID       string `json:"vaultId"`
	NodeID        string `json:"nodeId"`
	Title         string `json:"title"`
	Summary       string `json:"summary"`
	FullText      string `json:"fullText"`
	SourceURL     string `json:"sourceURL"`
	EntityType    string `json:"entityType,omitempty"`
	MatchedEntity string `json:"matchedEntity,omitempty"`
}

// SynthesisIndex stores the inverted entity index with NodeContext
type SynthesisIndex struct {
	TotalVaults int                                        `json:"totalVaults"`
	Vaults      map[string]bool                            `json:"vaults"`
	EntityMap   map[string]map[string][]NodeContextPayload `json:"entityMap"`
	NodeArchive map[string]map[string]models.MemoryNode    `json:"nodeArchive"` // VaultID -> NodeID -> Full Node
	Derived     map[string]DerivedVaultRecord              `json:"derived"`
}

type DerivedVaultRecord struct {
	ParentVaultIDs []string `json:"parentVaultIds"`
	CreatedAt      string   `json:"createdAt"`
}

// SynthesisAlert represents the payload sent to the frontend when a connection is found.
type SynthesisAlert struct {
	Type           string               `json:"type"`
	AlertKey       string               `json:"alertKey"`
	Entity         string               `json:"entity"`
	CurrentVaultID string               `json:"currentVaultId"`
	ConnectedCases []string             `json:"connectedCases"`
	Nodes          []NodeContextPayload `json:"nodes"`
	Analysis       string               `json:"analysis"`
	Timestamp      string               `json:"timestamp"`
	Score          float64              `json:"score"`
}

// SynthesisEngine manages the cross-case inverted entity index.
type SynthesisEngine struct {
	mu         sync.RWMutex
	indexPath  string
	Index      SynthesisIndex
	activeChan chan SynthesisAlert
}

// NewSynthesisEngine initializes the engine, loading the index if it exists.
func NewSynthesisEngine(vaultDir string, alertChan chan SynthesisAlert) *SynthesisEngine {
	engine := &SynthesisEngine{
		indexPath: filepath.Join(vaultDir, "entity_index.json"),
		Index: SynthesisIndex{
			Vaults:      make(map[string]bool),
			EntityMap:   make(map[string]map[string][]NodeContextPayload),
			NodeArchive: make(map[string]map[string]models.MemoryNode),
			Derived:     make(map[string]DerivedVaultRecord),
		},
		activeChan: alertChan,
	}
	engine.loadIndex()
	return engine
}

// loadIndex reads the JSON entity index from disk.
func (s *SynthesisEngine) loadIndex() {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.indexPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[SynthesisEngine] Error loading index: %v", err)
		}
		return
	}

	if err := json.Unmarshal(data, &s.Index); err != nil {
		log.Printf("[SynthesisEngine] Index migration format error: %v, starting fresh.", err)
		s.Index = SynthesisIndex{
			Vaults:      make(map[string]bool),
			EntityMap:   make(map[string]map[string][]NodeContextPayload),
			NodeArchive: make(map[string]map[string]models.MemoryNode),
			Derived:     make(map[string]DerivedVaultRecord),
		}
	}
	if s.Index.Vaults == nil {
		s.Index.Vaults = make(map[string]bool)
	}
	if s.Index.EntityMap == nil {
		s.Index.EntityMap = make(map[string]map[string][]NodeContextPayload)
	}
	if s.Index.NodeArchive == nil {
		s.Index.NodeArchive = make(map[string]map[string]models.MemoryNode)
	}
	if s.Index.Derived == nil {
		s.Index.Derived = make(map[string]DerivedVaultRecord)
	}
}

// saveIndex writes the current entity index to disk.
func (s *SynthesisEngine) saveIndex() {
	s.Index.TotalVaults = len(s.Index.Vaults)
	data, err := json.MarshalIndent(s.Index, "", "  ")
	if err != nil {
		log.Printf("[SynthesisEngine] Error marshaling index: %v", err)
		return
	}

	if err := os.MkdirAll(filepath.Dir(s.indexPath), 0755); err != nil {
		log.Printf("[SynthesisEngine] Error creating directory for index: %v", err)
		return
	}

	if err := os.WriteFile(s.indexPath, data, 0644); err != nil {
		log.Printf("[SynthesisEngine] Error saving index: %v", err)
	}
}

// PurgeVault completely removes a vault and its associated entity associations from the inverted index.
func (s *SynthesisEngine) PurgeVault(vaultID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 1. Remove from tracked vaults
	if !s.Index.Vaults[vaultID] {
		return // Vault doesn't exist in the index anyway
	}
	delete(s.Index.Vaults, vaultID)

	// 2. Remove all contexts belonging to this VaultID from the entity index
	for entity, contextsMap := range s.Index.EntityMap {
		delete(contextsMap, vaultID)

		// Cleanup orphaned entity entries completely
		if len(contextsMap) == 0 {
			delete(s.Index.EntityMap, entity)
		}
	}

	// 3. Remove from NodeArchive
	delete(s.Index.NodeArchive, vaultID)
	delete(s.Index.Derived, vaultID)

	// 4. Save index
	s.saveIndexLocked()
}

// PurgeOrphans completely removes any vaults that are not in the provided activeVaults map
func (s *SynthesisEngine) PurgeOrphans(activeVaults map[string]bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var orphans []string
	for vaultID := range s.Index.Vaults {
		if !activeVaults[vaultID] {
			orphans = append(orphans, vaultID)
		}
	}

	for _, vaultID := range orphans {
		delete(s.Index.Vaults, vaultID)
		delete(s.Index.NodeArchive, vaultID)
		delete(s.Index.Derived, vaultID)
		for entity, contextsMap := range s.Index.EntityMap {
			delete(contextsMap, vaultID)
			if len(contextsMap) == 0 {
				delete(s.Index.EntityMap, entity)
			}
		}
	}

	if len(orphans) > 0 {
		s.saveIndexLocked()
	}
}

// IndexVault refreshes a normal vault's archived nodes and entity entries without dispatching alerts.
func (s *SynthesisEngine) IndexVault(vaultID string, nodes []models.MemoryNode) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.indexVaultLocked(vaultID, nil, nodes)
	s.saveIndexLocked()
}

// saveIndexLocked must be called with s.mu already locked.
func (s *SynthesisEngine) saveIndexLocked() {
	s.saveIndex() // It just serializes, fine to reuse
}

func (s *SynthesisEngine) cleanEntity(entity string) string {
	return strings.ToLower(strings.TrimSpace(entity))
}

func levenshtein(s1, s2 string) int {
	lenS1 := len(s1)
	lenS2 := len(s2)

	if lenS1 == 0 {
		return lenS2
	}
	if lenS2 == 0 {
		return lenS1
	}

	row := make([]int, lenS2+1)
	for i := 0; i <= lenS2; i++ {
		row[i] = i
	}

	for i := 1; i <= lenS1; i++ {
		prev := i
		for j := 1; j <= lenS2; j++ {
			current := row[j-1]
			if s1[i-1] != s2[j-1] {
				current++
				if prev+1 < current {
					current = prev + 1
				}
				if row[j]+1 < current {
					current = row[j] + 1
				}
			}
			row[j-1] = prev
			prev = current
		}
		row[lenS2] = prev
	}
	return row[lenS2]
}

// findClosestEntity fuzzy matches strings that are very close (tolerate 1-2 typos)
func (s *SynthesisEngine) findClosestEntity(exact string) string {
	if _, exists := s.Index.EntityMap[exact]; exists {
		return exact
	}

	exactLen := len(exact)
	if exactLen < 4 || containsDigit(exact) {
		return exact // Too small to fuzzy match
	}

	bestMatch := exact
	bestDist := 99

	for existing := range s.Index.EntityMap {
		if math.Abs(float64(len(existing)-exactLen)) > 2 {
			continue // Large length disparages
		}
		dist := levenshtein(exact, existing)
		maxTolerated := 1
		if exactLen > 7 {
			maxTolerated = 2
		}

		if dist <= maxTolerated && dist < bestDist {
			bestMatch = existing
			bestDist = dist
		}
	}
	return bestMatch
}

// computeIDF calculates rarity of the entity
func (s *SynthesisEngine) computeIDF(entity string) float64 {
	total := float64(len(s.Index.Vaults))
	if total == 0 {
		total = 1
	}
	df := float64(len(s.Index.EntityMap[entity]))
	if df == 0 {
		df = 1
	}
	return math.Log10((total + 1.5) / (df + 0.5)) // smooth
}

const (
	maxContextsPerHistoricalVault = 2
	maxContextsPerCurrentVault    = 2
	maxOverlapAlertsPerRun        = 6
	fullTextExcerptLength         = 220
	fullTextFallbackThreshold     = 2
)

type rankedOverlapCandidate struct {
	entity           string
	historicalVaults []string
	nodesList        []NodeContextPayload
	idfScore         float64
	priorityScore    float64
}

func scoreOverlapCandidate(entity string, idfScore float64, nodesList []NodeContextPayload, historicalVaults []string) float64 {
	score := idfScore * 3
	score += float64(len(historicalVaults)) * 1.35
	score += float64(min(len(nodesList), maxContextsPerCurrentVault+maxContextsPerHistoricalVault))

	if strings.Contains(entity, " ") {
		score += 0.75
	}

	entityType := ""
	if len(nodesList) > 0 {
		entityType = strings.ToUpper(strings.TrimSpace(nodesList[0].EntityType))
	}

	switch entityType {
	case "PERSON":
		score += 2.5
	case "ORG":
		score += 2
	case "LOC":
		score += 0.25
	case "DATE":
		score -= 1
	}

	if idfScore < 0.2 {
		score -= 1.5
	}

	return score
}

func buildOverlapBatchDecisions(ctx context.Context, candidates []rankedOverlapCandidate, provider ModelProvider) map[string]OverlapAnalysis {
	if provider == nil || len(candidates) == 0 {
		return nil
	}

	batch := make([]overlapBatchCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		contextBuilder := strings.Builder{}
		for _, nc := range candidate.nodesList {
			contextBuilder.WriteString(fmt.Sprintf("\n[Case: %s | Node: %s | Type: %s] %s\n", nc.VaultID, nc.NodeID, nc.EntityType, formatOverlapContext(candidate.entity, nc)))
		}
		entityType := ""
		if len(candidate.nodesList) > 0 {
			entityType = candidate.nodesList[0].EntityType
		}
		batch = append(batch, overlapBatchCandidate{
			Entity:  candidate.entity,
			Type:    entityType,
			Cases:   len(candidate.historicalVaults) + 1,
			Context: contextBuilder.String(),
		})
	}

	prompt := fmt.Sprintf(`You are an anomaly detection filter analyzing potential overlaps across case files.
Review each candidate independently and decide whether it represents a meaningful cross-investigation overlap or just a generic recurring term.
Be strict: reject broad geopolitical entities, generic country references, and routine dates unless the context shows a concrete shared circumstance.
Return ONLY valid JSON in the format { "decisions": [{ "entity": "name", "meaningful": true/false, "reason": "short reason" }] }.

Candidates:
%s`, mustJSON(batch))

	var response overlapBatchResponse
	if err := provider.GenerateJSON(ctx, prompt, &response); err != nil {
		log.Printf("[SynthesisEngine] Batched LLM overlap eval failed, keeping default alerts. Err: %v", err)
		return nil
	}

	decisions := make(map[string]OverlapAnalysis, len(response.Decisions))
	for _, decision := range response.Decisions {
		entity := strings.ToLower(strings.TrimSpace(decision.Entity))
		if entity == "" {
			continue
		}
		decisions[entity] = OverlapAnalysis{
			Meaningful: decision.Meaningful,
			Reason:     strings.TrimSpace(decision.Reason),
		}
	}

	return decisions
}

func mustJSON(value interface{}) string {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "[]"
	}
	return string(data)
}

var taggedEntityPattern = regexp.MustCompile(`\[(PERSON|ORG|LOC|DATE|TIME):([^\]]+)\]`)
var overlapTokenPattern = regexp.MustCompile(`[a-z0-9]{3,}`)
var overlapEntityTypes = map[string]bool{
	"PERSON": true,
	"ORG":    true,
	"LOC":    true,
	"DATE":   true,
}
var overlapStopwords = map[string]struct{}{
	"about": {}, "after": {}, "also": {}, "been": {}, "being": {}, "between": {}, "case": {}, "cases": {},
	"could": {}, "from": {}, "have": {}, "into": {}, "just": {}, "more": {}, "than": {}, "that": {},
	"their": {}, "there": {}, "these": {}, "they": {}, "this": {}, "through": {}, "using": {}, "with": {},
}

func extractTaggedEntities(nodes []models.MemoryNode) map[string][]NodeContextPayload {
	entityContexts := make(map[string][]NodeContextPayload)

	for _, node := range nodes {
		matches := taggedEntityPattern.FindAllStringSubmatch(strings.Join([]string{node.Title, node.Summary, node.FullText}, "\n"), -1)
		seen := make(map[string]bool)
		for _, match := range matches {
			if len(match) < 3 {
				continue
			}

			entityType := strings.ToUpper(strings.TrimSpace(match[1]))
			if !overlapEntityTypes[entityType] {
				continue
			}

			entity := strings.ToLower(strings.TrimSpace(match[2]))
			if entity == "" {
				continue
			}

			seenKey := entityType + "|" + entity
			if seen[seenKey] {
				continue
			}
			seen[seenKey] = true

			entityContexts[entity] = append(entityContexts[entity], NodeContextPayload{
				VaultID:       "",
				NodeID:        node.ID,
				Title:         node.Title,
				Summary:       node.Summary,
				FullText:      node.FullText,
				SourceURL:     node.SourceURL,
				EntityType:    entityType,
				MatchedEntity: entity,
			})
		}
	}

	return entityContexts
}

func containsDigit(value string) bool {
	for _, r := range value {
		if r >= '0' && r <= '9' {
			return true
		}
	}
	return false
}

func mergeNodeContexts(existing []NodeContextPayload, incoming []NodeContextPayload) []NodeContextPayload {
	if len(existing) == 0 {
		return append([]NodeContextPayload(nil), incoming...)
	}

	merged := append([]NodeContextPayload(nil), existing...)
	seen := make(map[string]bool, len(existing))
	for _, context := range existing {
		seen[nodeContextKey(context)] = true
	}

	for _, context := range incoming {
		key := nodeContextKey(context)
		if seen[key] {
			continue
		}
		seen[key] = true
		merged = append(merged, context)
	}

	sort.SliceStable(merged, func(i, j int) bool {
		if merged[i].VaultID != merged[j].VaultID {
			return merged[i].VaultID < merged[j].VaultID
		}
		return merged[i].NodeID < merged[j].NodeID
	})

	return merged
}

func nodeContextKey(context NodeContextPayload) string {
	return strings.Join([]string{context.VaultID, context.NodeID, context.EntityType, context.MatchedEntity}, "|")
}

func uniqueSortedStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	seen := make(map[string]bool, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		unique = append(unique, value)
	}
	sort.Strings(unique)
	return unique
}

func makeAlertKey(currentVaultID, entity string, connectedCases []string) string {
	return strings.Join([]string{
		currentVaultID,
		strings.ToLower(strings.TrimSpace(entity)),
		strings.Join(uniqueSortedStrings(connectedCases), "|"),
	}, "::")
}

func limitContexts(contexts []NodeContextPayload, limit int) []NodeContextPayload {
	if len(contexts) <= limit {
		return append([]NodeContextPayload(nil), contexts...)
	}
	return append([]NodeContextPayload(nil), contexts[:limit]...)
}

func (s *SynthesisEngine) hydrateContextsLocked(contexts []NodeContextPayload) []NodeContextPayload {
	hydrated := make([]NodeContextPayload, 0, len(contexts))
	for _, context := range contexts {
		next := context
		if archive, ok := s.Index.NodeArchive[context.VaultID]; ok {
			if node, exists := archive[context.NodeID]; exists {
				next.Title = node.Title
				next.Summary = node.Summary
				next.FullText = node.FullText
				next.SourceURL = node.SourceURL
			}
		}
		hydrated = append(hydrated, next)
	}
	return hydrated
}

func buildOverlapTokenSet(entity string, contexts []NodeContextPayload) map[string]struct{} {
	ignoreTokens := make(map[string]struct{})
	for _, token := range tokenizeOverlapText(entity) {
		ignoreTokens[token] = struct{}{}
	}

	tokens := make(map[string]struct{})
	for _, context := range contexts {
		for _, token := range tokenizeOverlapText(strings.Join([]string{context.Title, context.Summary}, " ")) {
			if _, ignore := ignoreTokens[token]; ignore {
				continue
			}
			if _, stopword := overlapStopwords[token]; stopword {
				continue
			}
			tokens[token] = struct{}{}
		}
	}

	if len(tokens) >= 4 {
		return tokens
	}

	for _, context := range contexts {
		if context.FullText == "" {
			continue
		}
		for _, token := range tokenizeOverlapText(extractEntitySnippet(context.FullText, entity, fullTextExcerptLength)) {
			if _, ignore := ignoreTokens[token]; ignore {
				continue
			}
			if _, stopword := overlapStopwords[token]; stopword {
				continue
			}
			tokens[token] = struct{}{}
		}
	}

	return tokens
}

func tokenizeOverlapText(text string) []string {
	raw := overlapTokenPattern.FindAllString(strings.ToLower(text), -1)
	if len(raw) == 0 {
		return nil
	}

	seen := make(map[string]bool, len(raw))
	tokens := make([]string, 0, len(raw))
	for _, token := range raw {
		if seen[token] {
			continue
		}
		seen[token] = true
		tokens = append(tokens, token)
	}
	return tokens
}

func extractEntitySnippet(fullText, entity string, limit int) string {
	normalized := strings.TrimSpace(fullText)
	if normalized == "" {
		return ""
	}
	if len(normalized) <= limit {
		return normalized
	}

	lowerText := strings.ToLower(normalized)
	lowerEntity := strings.ToLower(entity)
	index := strings.Index(lowerText, lowerEntity)
	if index == -1 {
		return normalized[:limit]
	}

	start := index - (limit / 2)
	if start < 0 {
		start = 0
	}
	end := start + limit
	if end > len(normalized) {
		end = len(normalized)
		start = max(0, end-limit)
	}

	snippet := normalized[start:end]
	if start > 0 {
		snippet = "..." + snippet
	}
	if end < len(normalized) {
		snippet += "..."
	}
	return snippet
}

func scoreContextOverlap(entity string, currentTokens map[string]struct{}, context NodeContextPayload) int {
	score := 0
	lowerEntity := strings.ToLower(entity)
	for _, token := range tokenizeOverlapText(strings.Join([]string{context.Title, context.Summary}, " ")) {
		if _, ok := currentTokens[token]; ok {
			score++
		}
	}

	if strings.Contains(strings.ToLower(context.Title), lowerEntity) {
		score++
	}
	if strings.Contains(strings.ToLower(context.Summary), lowerEntity) {
		score += 2
	}
	if score >= fullTextFallbackThreshold || context.FullText == "" {
		return score
	}

	for _, token := range tokenizeOverlapText(extractEntitySnippet(context.FullText, entity, fullTextExcerptLength)) {
		if _, ok := currentTokens[token]; ok {
			score++
		}
	}
	return score
}

func selectHistoricalContexts(entity string, currentContexts []NodeContextPayload, historicalContexts []NodeContextPayload) []NodeContextPayload {
	if len(historicalContexts) <= maxContextsPerHistoricalVault {
		return append([]NodeContextPayload(nil), historicalContexts...)
	}

	currentTokens := buildOverlapTokenSet(entity, currentContexts)
	type scoredContext struct {
		context NodeContextPayload
		score   int
	}

	scored := make([]scoredContext, 0, len(historicalContexts))
	for _, context := range historicalContexts {
		scored = append(scored, scoredContext{
			context: context,
			score:   scoreContextOverlap(entity, currentTokens, context),
		})
	}

	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].context.NodeID < scored[j].context.NodeID
	})

	selected := make([]NodeContextPayload, 0, maxContextsPerHistoricalVault)
	for _, candidate := range scored[:min(maxContextsPerHistoricalVault, len(scored))] {
		selected = append(selected, candidate.context)
	}
	return selected
}

func formatOverlapContext(entity string, context NodeContextPayload) string {
	base := strings.TrimSpace(strings.Join([]string{context.Title, context.Summary}, " | "))
	if base == "" {
		base = context.Summary
	}

	if len(strings.TrimSpace(context.Summary)) >= 90 || context.FullText == "" {
		return base
	}

	snippet := extractEntitySnippet(context.FullText, entity, fullTextExcerptLength)
	if snippet == "" || snippet == context.Summary {
		return base
	}

	if base == "" {
		return snippet
	}

	return base + " | Full text: " + snippet
}

func (s *SynthesisEngine) RegisterDerivedVault(vaultID string, parentIDs []string, nodes []models.MemoryNode) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.indexVaultLocked(vaultID, parentIDs, nodes)
	s.saveIndexLocked()
}

func (s *SynthesisEngine) indexVaultLocked(vaultID string, parentIDs []string, nodes []models.MemoryNode) {
	vaultID = strings.TrimSpace(vaultID)
	if vaultID == "" {
		return
	}

	s.Index.Vaults[vaultID] = true
	if parentIDs != nil {
		s.Index.Derived[vaultID] = DerivedVaultRecord{
			ParentVaultIDs: append([]string(nil), parentIDs...),
			CreatedAt:      time.Now().Format(time.RFC3339),
		}
	} else {
		delete(s.Index.Derived, vaultID)
	}

	for entity, contextsMap := range s.Index.EntityMap {
		delete(contextsMap, vaultID)
		if len(contextsMap) == 0 {
			delete(s.Index.EntityMap, entity)
		}
	}

	s.Index.NodeArchive[vaultID] = make(map[string]models.MemoryNode)
	for _, node := range nodes {
		s.Index.NodeArchive[vaultID][node.ID] = node
	}

	for entity, contexts := range extractTaggedEntities(nodes) {
		if s.Index.EntityMap[entity] == nil {
			s.Index.EntityMap[entity] = make(map[string][]NodeContextPayload)
		}

		withVaultIDs := make([]NodeContextPayload, 0, len(contexts))
		for _, context := range contexts {
			context.VaultID = vaultID
			withVaultIDs = append(withVaultIDs, context)
		}

		s.Index.EntityMap[entity][vaultID] = withVaultIDs
	}
}

type OverlapAnalysis struct {
	Meaningful bool   `json:"meaningful"`
	Reason     string `json:"reason"`
}

type overlapBatchCandidate struct {
	Entity  string `json:"entity"`
	Type    string `json:"type"`
	Cases   int    `json:"cases"`
	Context string `json:"context"`
}

type overlapBatchDecision struct {
	Entity     string `json:"entity"`
	Meaningful bool   `json:"meaningful"`
	Reason     string `json:"reason"`
}

type overlapBatchResponse struct {
	Decisions []overlapBatchDecision `json:"decisions"`
}

// AnalyzeOverlap uses tagged node entities as fast overlap candidates, then verifies them with node context.
func (s *SynthesisEngine) AnalyzeOverlap(ctx context.Context, newVaultID string, candidateNodes []models.MemoryNode, allNodes []models.MemoryNode, br *Brain) {
	if err := ctx.Err(); err != nil {
		return
	}
	startedAt := time.Now()
	candidateEntityMap := extractTaggedEntities(candidateNodes)
	log.Printf("[SynthesisEngine] Starting execution for Vault %s with %d candidate nodes and %d candidate entities", newVaultID, len(candidateNodes), len(candidateEntityMap))

	s.mu.Lock()

	overlapsFound := make(map[string][]string) // Entity -> List of Historical VaultIDs it appears in
	indexChanged := false

	s.Index.Vaults[newVaultID] = true
	if s.Index.NodeArchive[newVaultID] == nil {
		s.Index.NodeArchive[newVaultID] = make(map[string]models.MemoryNode)
	}

	// Store full node data in archive
	for _, n := range allNodes {
		s.Index.NodeArchive[newVaultID][n.ID] = n
	}

	if len(candidateEntityMap) == 0 {
		s.saveIndexLocked()
		s.mu.Unlock()
		log.Printf("[SynthesisEngine] Archived vault %s without tagged overlap entities in %s", newVaultID, time.Since(startedAt))
		return
	}

	currentContexts := make(map[string][]NodeContextPayload)
	historicalContexts := make(map[string]map[string][]NodeContextPayload)
	seenInRun := make(map[string]bool)

	for exactEntity, extractedContexts := range candidateEntityMap {
		if exactEntity == "" {
			continue
		}
		entity := s.findClosestEntity(exactEntity)
		if seenInRun[entity] {
			continue
		}
		seenInRun[entity] = true

		if s.Index.EntityMap[entity] == nil {
			s.Index.EntityMap[entity] = make(map[string][]NodeContextPayload)
		}

		contexts := make([]NodeContextPayload, 0, len(extractedContexts))
		for _, context := range extractedContexts {
			context.VaultID = newVaultID
			context.MatchedEntity = entity
			contexts = append(contexts, context)
		}

		existingHistoricalVaults := make([]string, 0, len(s.Index.EntityMap[entity]))
		for existingCase, indexedContexts := range s.Index.EntityMap[entity] {
			if existingCase != newVaultID {
				existingHistoricalVaults = append(existingHistoricalVaults, existingCase)
				if historicalContexts[entity] == nil {
					historicalContexts[entity] = make(map[string][]NodeContextPayload)
				}
				historicalContexts[entity][existingCase] = s.hydrateContextsLocked(indexedContexts)
			}
		}

		existingCurrent := s.Index.EntityMap[entity][newVaultID]
		mergedCurrent := mergeNodeContexts(existingCurrent, contexts)
		if len(mergedCurrent) != len(existingCurrent) {
			s.Index.EntityMap[entity][newVaultID] = mergedCurrent
			indexChanged = true
		}
		currentContexts[entity] = s.hydrateContextsLocked(mergedCurrent)
		overlapsFound[entity] = uniqueSortedStrings(existingHistoricalVaults)
	}

	if indexChanged {
		s.saveIndexLocked()
	}

	isDerivedCurrentVault := s.Index.Derived[newVaultID].ParentVaultIDs != nil
	s.mu.Unlock() // unlock BEFORE any prompt verification work

	if isDerivedCurrentVault {
		log.Printf("[SynthesisEngine] Skipping overlap alerts for derived vault %s after indexing %d entities", newVaultID, len(currentContexts))
		return
	}

	refinedContexts := make(map[string][]NodeContextPayload)
	refinedOverlaps := make(map[string][]string)
	for entity, vaults := range overlapsFound {
		if err := ctx.Err(); err != nil {
			return
		}
		if len(vaults) == 0 {
			continue
		}

		selectedContexts := make([]NodeContextPayload, 0, len(vaults)*maxContextsPerHistoricalVault+maxContextsPerCurrentVault)
		for _, vaultID := range vaults {
			selectedContexts = append(selectedContexts, selectHistoricalContexts(entity, currentContexts[entity], historicalContexts[entity][vaultID])...)
		}
		selectedContexts = append(selectedContexts, limitContexts(currentContexts[entity], maxContextsPerCurrentVault)...)
		refinedContexts[entity] = selectedContexts
		refinedOverlaps[entity] = vaults
	}

	log.Printf("[SynthesisEngine] Prepared %d verified overlap candidates for vault %s in %s", len(refinedOverlaps), newVaultID, time.Since(startedAt))
	if len(refinedOverlaps) > 0 {
		go s.dispatchSynthesis(ctx, refinedOverlaps, newVaultID, refinedContexts, br)
	}
}

func (s *SynthesisEngine) dispatchSynthesis(ctx context.Context, overlaps map[string][]string, currentVaultID string, overlapContexts map[string][]NodeContextPayload, br *Brain) {
	if err := ctx.Err(); err != nil {
		return
	}
	log.Printf("[SynthesisEngine] Dispatching %d overlaps for current vault %s", len(overlaps), currentVaultID)

	if s.activeChan == nil {
		return
	}

	rankedCandidates := make([]rankedOverlapCandidate, 0, len(overlaps))
	for entity, historicalVaults := range overlaps {
		s.mu.RLock()
		idfScore := s.computeIDF(entity)
		s.mu.RUnlock()

		nodesList := overlapContexts[entity]
		rankedCandidates = append(rankedCandidates, rankedOverlapCandidate{
			entity:           entity,
			historicalVaults: uniqueSortedStrings(historicalVaults),
			nodesList:        nodesList,
			idfScore:         idfScore,
			priorityScore:    scoreOverlapCandidate(entity, idfScore, nodesList, historicalVaults),
		})
	}

	sort.SliceStable(rankedCandidates, func(i, j int) bool {
		if rankedCandidates[i].priorityScore == rankedCandidates[j].priorityScore {
			return rankedCandidates[i].entity < rankedCandidates[j].entity
		}
		return rankedCandidates[i].priorityScore > rankedCandidates[j].priorityScore
	})

	dispatchCount := len(rankedCandidates)
	if dispatchCount > maxOverlapAlertsPerRun {
		dispatchCount = maxOverlapAlertsPerRun
	}
	if dispatchCount < len(rankedCandidates) {
		log.Printf("[SynthesisEngine] Ranked %d overlap candidates for %s and kept top %d for alert verification", len(rankedCandidates), currentVaultID, dispatchCount)
	}

	selectedCandidates := rankedCandidates[:dispatchCount]
	var batchDecisions map[string]OverlapAnalysis
	if br != nil && br.GetSearchProvider() != nil {
		provider := br.GetSearchProvider()
		batchStartedAt := time.Now()
		batchDecisions = buildOverlapBatchDecisions(ctx, selectedCandidates, provider)
		if batchDecisions != nil {
			log.Printf("[SynthesisEngine] Batched overlap verification evaluated %d candidates for %s in %s", len(selectedCandidates), currentVaultID, time.Since(batchStartedAt))
		}
	}

	for _, candidate := range selectedCandidates {
		if err := ctx.Err(); err != nil {
			return
		}
		entity := candidate.entity
		historicalVaults := candidate.historicalVaults
		nodesList := candidate.nodesList
		allCases := append(historicalVaults, currentVaultID)

		analysisText := fmt.Sprintf("Gorantula detected that %q appears in this case, but was also previously investigated in: %s. This connection suggests a potential hidden overlap.", entity, strings.Join(historicalVaults, ", "))

		// Verify likely overlaps with bounded context so common terms do not create noisy alerts.
		if batchDecisions != nil {
			if overlap, ok := batchDecisions[entity]; ok {
				if !overlap.Meaningful {
					log.Printf("[SynthesisEngine] Suppressed buzzword '%s' due to LLM Context Filter. Reason: %s", entity, overlap.Reason)
					continue
				}
				if overlap.Reason != "" {
					analysisText = overlap.Reason
				}
			}
		}

		alert := SynthesisAlert{
			Type:           "synthesis_alert",
			AlertKey:       makeAlertKey(currentVaultID, entity, allCases),
			Entity:         entity,
			CurrentVaultID: currentVaultID,
			ConnectedCases: allCases,
			Nodes:          nodesList,
			Analysis:       analysisText,
			Timestamp:      time.Now().Format("15:04:05"),
			Score:          candidate.idfScore,
		}

		select {
		case s.activeChan <- alert:
			log.Printf("[SynthesisEngine] Alert triggered via WebSocket for: %s", entity)
		default:
			log.Printf("[SynthesisEngine] Warning: Alert channel full, dropping synthesis alert for %s", entity)
		}
	}
}
