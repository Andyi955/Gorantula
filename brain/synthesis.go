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
	"strings"
	"sync"
	"time"

	"spider-agent/models"
)

// NodeContextPayload represents where an entity was found
type NodeContextPayload struct {
	VaultID   string `json:"vaultId"`
	NodeID    string `json:"nodeId"`
	Title     string `json:"title"`
	Summary   string `json:"summary"`
	FullText  string `json:"fullText"`
	SourceURL string `json:"sourceURL"`
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
	if exactLen < 4 {
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

var taggedEntityPattern = regexp.MustCompile(`\[(?:PERSON|ORG|LOC|DATE|TIME):([^\]]+)\]`)

func extractTaggedEntities(nodes []models.MemoryNode) map[string][]NodeContextPayload {
	entityContexts := make(map[string][]NodeContextPayload)

	for _, node := range nodes {
		matches := taggedEntityPattern.FindAllStringSubmatch(strings.Join([]string{node.Title, node.Summary, node.FullText}, "\n"), -1)
		seen := make(map[string]bool)
		for _, match := range matches {
			if len(match) < 2 {
				continue
			}

			entity := strings.ToLower(strings.TrimSpace(match[1]))
			if entity == "" || seen[entity] {
				continue
			}
			seen[entity] = true

			entityContexts[entity] = append(entityContexts[entity], NodeContextPayload{
				VaultID:   "",
				NodeID:    node.ID,
				Title:     node.Title,
				Summary:   node.Summary,
				FullText:  node.FullText,
				SourceURL: node.SourceURL,
			})
		}
	}

	return entityContexts
}

func (s *SynthesisEngine) RegisterDerivedVault(vaultID string, parentIDs []string, nodes []models.MemoryNode) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.Index.Vaults[vaultID] = true
	s.Index.Derived[vaultID] = DerivedVaultRecord{
		ParentVaultIDs: append([]string(nil), parentIDs...),
		CreatedAt:      time.Now().Format(time.RFC3339),
	}

	if s.Index.NodeArchive[vaultID] == nil {
		s.Index.NodeArchive[vaultID] = make(map[string]models.MemoryNode)
	}

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

	s.saveIndexLocked()
}

type OverlapAnalysis struct {
	Meaningful bool   `json:"meaningful"`
	Reason     string `json:"reason"`
}

// AnalyzeOverlap checks newly extracted entities for cross-case overlap and triggers LLM analysis if found.
func (s *SynthesisEngine) AnalyzeOverlap(ctx context.Context, newEntities []string, newVaultID string, nodes []models.MemoryNode, br *Brain) {
	log.Printf("[SynthesisEngine] Starting execution for Vault: %s. Processing %d possible entities", newVaultID, len(newEntities))
	s.mu.Lock()

	overlapsFound := make(map[string][]string) // Entity -> List of Historical VaultIDs it appears in
	indexChanged := false

	s.Index.Vaults[newVaultID] = true
	if s.Index.NodeArchive[newVaultID] == nil {
		s.Index.NodeArchive[newVaultID] = make(map[string]models.MemoryNode)
	}

	// Store full node data in archive
	for _, n := range nodes {
		s.Index.NodeArchive[newVaultID][n.ID] = n
	}

	seenInRun := make(map[string]bool)

	entityToNodes := make(map[string][]NodeContextPayload)

	for _, rawEntity := range newEntities {
		exact := s.cleanEntity(rawEntity)
		if exact == "" {
			continue
		}
		entity := s.findClosestEntity(exact)
		if seenInRun[entity] {
			continue
		}
		seenInRun[entity] = true

		if s.Index.EntityMap[entity] == nil {
			s.Index.EntityMap[entity] = make(map[string][]NodeContextPayload)
		}

		// Map to contexts
		var contexts []NodeContextPayload
		for _, n := range nodes {
			if strings.Contains(strings.ToLower(n.Summary), entity) || strings.Contains(strings.ToLower(n.Title), entity) {
				contexts = append(contexts, NodeContextPayload{
					VaultID:   newVaultID,
					NodeID:    n.ID,
					Title:     n.Title,
					Summary:   n.Summary,
					FullText:  n.FullText,
					SourceURL: n.SourceURL,
				})
			}
		}

		for existingCase := range s.Index.EntityMap[entity] {
			if existingCase != newVaultID {
				overlapsFound[entity] = append(overlapsFound[entity], existingCase)
			}
		}

		if len(contexts) > 0 {
			if len(s.Index.EntityMap[entity][newVaultID]) == 0 {
				s.Index.EntityMap[entity][newVaultID] = contexts
				indexChanged = true
			}
		} else {
			if len(s.Index.EntityMap[entity][newVaultID]) == 0 {
				nodeID := "synthetic-node"
				title := "Synthetic Insight"
				summary := "Detected synthetically inside this case without clear node attribution."
				fullText := ""
				sourceURL := ""

				if len(nodes) > 0 {
					nodeID = nodes[0].ID
					title = nodes[0].Title
					summary = nodes[0].Summary
					fullText = nodes[0].FullText
					sourceURL = nodes[0].SourceURL
				}
				s.Index.EntityMap[entity][newVaultID] = []NodeContextPayload{{
					VaultID:   newVaultID,
					NodeID:    nodeID,
					Title:     title,
					Summary:   summary,
					FullText:  fullText,
					SourceURL: sourceURL,
				}}
				indexChanged = true
			}
		}

		// Keep map up to date for dispatch mapping
		if len(s.Index.EntityMap[entity][newVaultID]) > 0 {
			entityToNodes[entity] = s.Index.EntityMap[entity][newVaultID]
		}
	}

	if indexChanged {
		s.saveIndexLocked()
	}

	overlapContexts := make(map[string][]NodeContextPayload)
	for entity, vaults := range overlapsFound {
		var hNodes []NodeContextPayload
		for _, v := range vaults {
			hNodes = append(hNodes, s.Index.EntityMap[entity][v]...)
		}
		hNodes = append(hNodes, entityToNodes[entity]...)
		overlapContexts[entity] = hNodes
	}

	s.mu.Unlock() // unlock BEFORE calling LLMs block to avoid deadlock on index saves

	if len(overlapsFound) > 0 {
		go s.dispatchSynthesis(ctx, overlapsFound, newVaultID, overlapContexts, br)
	}
}

func (s *SynthesisEngine) dispatchSynthesis(ctx context.Context, overlaps map[string][]string, currentVaultID string, overlapContexts map[string][]NodeContextPayload, br *Brain) {
	log.Printf("[SynthesisEngine] Dispatching %d overlaps for current vault %s", len(overlaps), currentVaultID)

	if s.activeChan == nil {
		return
	}

	for entity, historicalVaults := range overlaps {
		s.mu.RLock()
		idfScore := s.computeIDF(entity)
		s.mu.RUnlock()

		nodesList := overlapContexts[entity]
		allCases := append(historicalVaults, currentVaultID)

		analysisText := fmt.Sprintf("Gorantula detected that %q appears in this case, but was also previously investigated in: %s. This connection suggests a potential hidden overlap.", entity, strings.Join(historicalVaults, ", "))

		// Try to verify Context if we have a brain and the term might be somewhat common or we just want better analysis
		if br != nil && br.GetSearchProvider() != nil {
			provider := br.GetSearchProvider()
			contextBuilder := strings.Builder{}
			for _, nc := range nodesList {
				contextBuilder.WriteString(fmt.Sprintf("\n[Case: %s | Node: %s] %s\n", nc.VaultID, nc.NodeID, nc.Summary))
			}

			prompt := fmt.Sprintf("You are an anomaly detection filter analyzing connections across case files. We found the term '%s' in multiple independent investigations. Here are the summaries of where it was found across these investigations:\n%s\n\nIs there a meaningful thematic or circumstantial overlap between these usages, or is '%s' just being used coincidentally in unrelated contexts? If IDF is low, it might be a generic buzzword. Answer ONLY with a JSON object { \"meaningful\": true/false, \"reason\": \"1-2 sentences explaining the connection or lack thereof\" }", entity, contextBuilder.String(), entity)

			var overlap OverlapAnalysis
			err := provider.GenerateJSON(ctx, prompt, &overlap)
			if err == nil {
				if !overlap.Meaningful {
					log.Printf("[SynthesisEngine] Suppressed buzzword '%s' due to LLM Context Filter. Reason: %s", entity, overlap.Reason)
					continue
				} else {
					analysisText = overlap.Reason
				}
			} else {
				log.Printf("[SynthesisEngine] LLM eval failed for '%s', keeping default alert. Err: %v", entity, err)
			}
		}

		alert := SynthesisAlert{
			Type:           "synthesis_alert",
			Entity:         entity,
			CurrentVaultID: currentVaultID,
			ConnectedCases: allCases,
			Nodes:          nodesList,
			Analysis:       analysisText,
			Timestamp:      time.Now().Format("15:04:05"),
			Score:          idfScore,
		}

		select {
		case s.activeChan <- alert:
			log.Printf("[SynthesisEngine] Alert triggered via WebSocket for: %s", entity)
		default:
			log.Printf("[SynthesisEngine] Warning: Alert channel full, dropping synthesis alert for %s", entity)
		}
	}
}
