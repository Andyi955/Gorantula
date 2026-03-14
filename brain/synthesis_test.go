package brain

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"spider-agent/models"
)

func TestSynthesisEngine(t *testing.T) {
	tempDir := t.TempDir()

	alertChan := make(chan SynthesisAlert, 10)
	engine := NewSynthesisEngine(tempDir, alertChan)

	tests := []struct {
		name         string
		entities     []string
		vaultID      string
		expectAlerts int
	}{
		{
			name:         "First Case (No Overlap)",
			entities:     []string{"Elon Musk", "SpaceX", "Tesla"},
			vaultID:      "case-2026-03-10",
			expectAlerts: 0,
		},
		{
			name:         "Second Case (Matches Tesla)",
			entities:     []string{"TESLA", "Rivian", "Lucid"},
			vaultID:      "case-2026-03-11",
			expectAlerts: 1, // Tesla matches
		},
		{
			name:         "Third Case (Matches SpaceX and Rivian)",
			entities:     []string{"SPACEX", "RIVIAN", "Blue Origin"},
			vaultID:      "case-2026-03-12",
			expectAlerts: 2, // SpaceX and Rivian both match historical cases
		},
		{
			name:         "Duplicate Entities in Same Case",
			entities:     []string{"Apple", "apple", "APPLE"},
			vaultID:      "case-2026-03-13",
			expectAlerts: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			engine.AnalyzeOverlap(context.Background(), tt.entities, tt.vaultID, nil, nil)

			// Allow dispatch goroutines to run
			time.Sleep(50 * time.Millisecond)

			// Drain channel to count alerts
			alertsReceived := 0
			done := false
			for !done {
				select {
				case <-alertChan:
					alertsReceived++
				default:
					done = true
				}
			}

			if alertsReceived != tt.expectAlerts {
				t.Errorf("Expected %d alerts, got %d", tt.expectAlerts, alertsReceived)
			}
		})
	}

	// Ensure the index properly saved state across tests
	indexPath := filepath.Join(tempDir, "entity_index.json")
	if _, err := os.Stat(indexPath); os.IsNotExist(err) {
		t.Errorf("Expected entity_index.json to be saved, but it does not exist")
	}

	// Verify persistence logic works correctly
	engine2 := NewSynthesisEngine(tempDir, alertChan)
	engine2.mu.RLock()
	if len(engine2.Index.EntityMap) == 0 {
		t.Errorf("Failed to reload index file into new engine instance")
	}
	engine2.mu.RUnlock()
}

func TestConcurrentSynthesisOverlaps(t *testing.T) {
	tempDir := t.TempDir()
	alertChan := make(chan SynthesisAlert, 100)
	engine := NewSynthesisEngine(tempDir, alertChan)

	var wg sync.WaitGroup
	// Concurrently add a bunch of cases that reference the same entity to trigger race condition if broken.
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			vaultID := "case-" + string(rune(id))
			engine.AnalyzeOverlap(context.Background(), []string{"ConvergencePoint"}, vaultID, nil, nil)
		}(i)
	}

	wg.Wait()
	// No panics means race condition tests passed.

	engine.mu.RLock()
	defer engine.mu.RUnlock()
	caseMap := engine.Index.EntityMap["convergencepoint"]
	if len(caseMap) != 50 {
		t.Errorf("Expected exactly 50 distinct overlapping cases for entity 'ConvergencePoint', got %d", len(caseMap))
	}
}

func TestPurgeVault(t *testing.T) {
	tempDir := t.TempDir()
	alertChan := make(chan SynthesisAlert, 10)
	engine := NewSynthesisEngine(tempDir, alertChan)

	// Pre-seed some data
	nodes := []models.MemoryNode{{ID: "n1", Summary: "Apple is a fruit"}}
	engine.AnalyzeOverlap(context.Background(), []string{"Apple", "Banana"}, "vault-1", nodes, nil)
	engine.AnalyzeOverlap(context.Background(), []string{"Apple", "Cherry"}, "vault-2", nodes, nil)

	// Ensure propagation
	time.Sleep(50 * time.Millisecond)

	tests := []struct {
		name                 string
		vaultToDelete        string
		expectedVaultsCount  int
		expectedAppleRefs    int
		expectedBananaExists bool
	}{
		{
			name:                 "Purge vault-1",
			vaultToDelete:        "vault-1",
			expectedVaultsCount:  1,
			expectedAppleRefs:    1,
			expectedBananaExists: false, // Banana was only in vault-1
		},
		{
			name:                 "Purge non-existent vault",
			vaultToDelete:        "vault-404",
			expectedVaultsCount:  1,
			expectedAppleRefs:    1,
			expectedBananaExists: false,
		},
		{
			name:                 "Purge vault-2",
			vaultToDelete:        "vault-2",
			expectedVaultsCount:  0,
			expectedAppleRefs:    0,
			expectedBananaExists: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			engine.PurgeVault(tt.vaultToDelete)

			engine.mu.RLock()
			defer engine.mu.RUnlock()

			if len(engine.Index.Vaults) != tt.expectedVaultsCount {
				t.Errorf("Expected %d Vaults, got %d", tt.expectedVaultsCount, len(engine.Index.Vaults))
			}

			if appleRefs, exists := engine.Index.EntityMap["apple"]; exists {
				if len(appleRefs) != tt.expectedAppleRefs {
					t.Errorf("Expected %d refs for Apple, got %d", tt.expectedAppleRefs, len(appleRefs))
				}
			} else if tt.expectedAppleRefs > 0 {
				t.Errorf("Expected Apple to exist with %d refs, but it was deleted entirely", tt.expectedAppleRefs)
			}

			_, bananaExists := engine.Index.EntityMap["banana"]
			if bananaExists != tt.expectedBananaExists {
				t.Errorf("Expected banana existence to be %v, got %v", tt.expectedBananaExists, bananaExists)
			}
		})
	}
}

func TestNodeArchive(t *testing.T) {
	tempDir := t.TempDir()
	alertChan := make(chan SynthesisAlert, 10)
	engine := NewSynthesisEngine(tempDir, alertChan)

	vaultID := "test-vault"
	nodeID := "node-1"
	nodes := []models.MemoryNode{
		{
			ID:      nodeID,
			Title:   "Original Title",
			Summary: "Summary text",
		},
	}

	// 1. Store node in archive via AnalyzeOverlap
	engine.AnalyzeOverlap(context.Background(), []string{"Entity"}, vaultID, nodes, nil)

	engine.mu.RLock()
	archivedNode, exists := engine.Index.NodeArchive[vaultID][nodeID]
	engine.mu.RUnlock()

	if !exists {
		t.Fatalf("Node was not stored in NodeArchive")
	}
	if archivedNode.Title != "Original Title" {
		t.Errorf("Expected title 'Original Title', got '%s'", archivedNode.Title)
	}

	// 2. Verify purge cleans up NodeArchive
	engine.PurgeVault(vaultID)

	engine.mu.RLock()
	_, exists = engine.Index.NodeArchive[vaultID]
	engine.mu.RUnlock()

	if exists {
		t.Errorf("NodeArchive entry for vault was not purged")
	}
}
