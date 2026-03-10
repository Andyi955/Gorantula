package brain

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// SynthesisEngine manages the cross-case inverted entity index.
type SynthesisEngine struct {
	mu         sync.RWMutex
	indexPath  string
	EntityMap  map[string]map[string]bool // Entity -> map[VaultID]true
	activeChan chan SynthesisAlert
}

// SynthesisAlert represents the payload sent to the frontend when a connection is found.
type SynthesisAlert struct {
	Type           string   `json:"type"`
	Entity         string   `json:"entity"`
	ConnectedCases []string `json:"connectedCases"`
	Analysis       string   `json:"analysis"`
	Timestamp      string   `json:"timestamp"`
}

// NewSynthesisEngine initializes the engine, loading the index if it exists.
func NewSynthesisEngine(vaultDir string, alertChan chan SynthesisAlert) *SynthesisEngine {
	engine := &SynthesisEngine{
		indexPath:  filepath.Join(vaultDir, "entity_index.json"),
		EntityMap:  make(map[string]map[string]bool),
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

	if err := json.Unmarshal(data, &s.EntityMap); err != nil {
		log.Printf("[SynthesisEngine] Error parsing index: %v", err)
	}
}

// saveIndex writes the current entity index to disk.
func (s *SynthesisEngine) saveIndex() {
	data, err := json.MarshalIndent(s.EntityMap, "", "  ")
	if err != nil {
		log.Printf("[SynthesisEngine] Error marshaling index: %v", err)
		return
	}

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(s.indexPath), 0755); err != nil {
		log.Printf("[SynthesisEngine] Error creating directory for index: %v", err)
		return
	}

	if err := os.WriteFile(s.indexPath, data, 0644); err != nil {
		log.Printf("[SynthesisEngine] Error saving index: %v", err)
	}
}

// cleanEntity normalizes an entity name to improve matching (lowercase, trim).
func (s *SynthesisEngine) cleanEntity(entity string) string {
	return strings.ToLower(strings.TrimSpace(entity))
}

// AnalyzeOverlap checks newly extracted entities for cross-case overlap and triggers LLM analysis if found.
// Call this independently in a goroutine so it doesn't block the main flow.
func (s *SynthesisEngine) AnalyzeOverlap(newEntities []string, newVaultID string) {
	log.Printf("[SynthesisEngine] Starting execution for Vault: %s. Processing %d possible entities", newVaultID, len(newEntities))
	s.mu.Lock()
	defer s.mu.Unlock()

	overlapsFound := make(map[string][]string) // Entity -> List of VaultIDs it appears in
	indexChanged := false
	seenInRun := make(map[string]bool)

	for _, rawEntity := range newEntities {
		entity := s.cleanEntity(rawEntity)
		if entity == "" || seenInRun[entity] {
			continue
		}
		seenInRun[entity] = true

		if s.EntityMap[entity] == nil {
			s.EntityMap[entity] = make(map[string]bool)
		}

		// Look for overlaps before we add the current case to it
		for existingCase := range s.EntityMap[entity] {
			if existingCase != newVaultID {
				// We found overlap
				overlapsFound[entity] = append(overlapsFound[entity], existingCase)
			}
		}

		// Add the new vault ID
		if !s.EntityMap[entity][newVaultID] {
			s.EntityMap[entity][newVaultID] = true
			indexChanged = true
		}
	}

	if indexChanged {
		s.saveIndex() // Write back updated index
	}

	// For any overlaps found, we dispatch an alert (and hypothetically, trigger LLM connecting logic)
	// We run the actual LLM dispatch in a separate unbounded goroutine to prevent holding the lock
	if len(overlapsFound) > 0 {
		go s.dispatchSynthesis(overlapsFound, newVaultID)
	}
}

// dispatchSynthesis generates the alert payloads. In a full implementation, this calls an LLM to explain the link.
func (s *SynthesisEngine) dispatchSynthesis(overlaps map[string][]string, currentVaultID string) {
	log.Printf("[SynthesisEngine] Dispatching %d overlaps for current vault %s", len(overlaps), currentVaultID)

	if s.activeChan == nil {
		log.Printf("[SynthesisEngine] activeChan is nil! Cannot send alerts.")
		return
	}

	for entity, historicalVaults := range overlaps {
		log.Printf("[SynthesisEngine] Alert: %s found in historical vaults %v", entity, historicalVaults)
		allCases := append(historicalVaults, currentVaultID)

		// Here you would normally dispatch a prompt to Gemini/Minimax checking the context.
		// For now, we simulate the 'Grand Unified Theory' finding.
		analysisText := fmt.Sprintf("Gorantula detected that %q appears in this case, but was also previously investigated in: %s. This connection suggests a potential hidden overlap.", entity, strings.Join(historicalVaults, ", "))

		alert := SynthesisAlert{
			Type:           "synthesis_alert",
			Entity:         entity,
			ConnectedCases: allCases,
			Analysis:       analysisText,
			Timestamp:      time.Now().Format("15:04:05"),
		}

		// Non-blocking send
		select {
		case s.activeChan <- alert:
		default:
			log.Printf("[SynthesisEngine] Warning: Alert channel full, dropping synthesis alert for %s", entity)
		}
	}
}
