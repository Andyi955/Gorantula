package brain

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"spider-agent/models"
)

func taggedNode(id, title, summary string) models.MemoryNode {
	return models.MemoryNode{
		ID:       id,
		Title:    title,
		Summary:  summary,
		FullText: summary,
	}
}

func waitForOverlapDispatch() {
	time.Sleep(50 * time.Millisecond)
}

func drainAlerts(ch chan SynthesisAlert) []SynthesisAlert {
	alerts := make([]SynthesisAlert, 0)
	for {
		select {
		case alert := <-ch:
			alerts = append(alerts, alert)
		default:
			return alerts
		}
	}
}

func TestSynthesisEngine(t *testing.T) {
	tempDir := t.TempDir()

	alertChan := make(chan SynthesisAlert, 10)
	engine := NewSynthesisEngine(tempDir, alertChan)

	tests := []struct {
		name         string
		vaultID      string
		nodes        []models.MemoryNode
		expectAlerts int
	}{
		{
			name:    "First Case (No Overlap)",
			vaultID: "case-2026-03-10",
			nodes: []models.MemoryNode{
				taggedNode("node-1", "Initial", "[PERSON:Elon Musk] expanded [ORG:SpaceX] while [ORG:Tesla] raised fresh capital."),
			},
			expectAlerts: 0,
		},
		{
			name:    "Second Case (Matches Tesla)",
			vaultID: "case-2026-03-11",
			nodes: []models.MemoryNode{
				taggedNode("node-2", "EV rivals", "[ORG:Tesla] was compared against [ORG:Rivian] and [ORG:Lucid]."),
			},
			expectAlerts: 1,
		},
		{
			name:    "Third Case (Matches SpaceX and Rivian)",
			vaultID: "case-2026-03-12",
			nodes: []models.MemoryNode{
				taggedNode("node-3", "Launch chatter", "[ORG:SpaceX] was discussed alongside [ORG:Rivian] and [ORG:Blue Origin]."),
			},
			expectAlerts: 2,
		},
		{
			name:    "Duplicate Entities In Same Case",
			vaultID: "case-2026-03-13",
			nodes: []models.MemoryNode{
				taggedNode("node-4", "Apple repetition", "[ORG:Apple] responded to [ORG:Apple] in a single note."),
			},
			expectAlerts: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			engine.AnalyzeOverlap(context.Background(), tt.vaultID, tt.nodes, tt.nodes, nil)
			waitForOverlapDispatch()

			receivedAlerts := drainAlerts(alertChan)
			if len(receivedAlerts) != tt.expectAlerts {
				t.Fatalf("expected %d alerts, got %d", tt.expectAlerts, len(receivedAlerts))
			}

			for _, alert := range receivedAlerts {
				if alert.CurrentVaultID != tt.vaultID {
					t.Fatalf("expected alert CurrentVaultID %q, got %q", tt.vaultID, alert.CurrentVaultID)
				}
				if alert.AlertKey == "" {
					t.Fatalf("expected alert key to be populated")
				}
			}
		})
	}

	indexPath := filepath.Join(tempDir, "entity_index.json")
	if _, err := os.Stat(indexPath); os.IsNotExist(err) {
		t.Fatalf("expected entity_index.json to be saved, but it does not exist")
	}

	engine2 := NewSynthesisEngine(tempDir, alertChan)
	engine2.mu.RLock()
	defer engine2.mu.RUnlock()
	if len(engine2.Index.EntityMap) == 0 {
		t.Fatalf("failed to reload index file into new engine instance")
	}
}

func TestIncrementalOverlapUsesPendingNodes(t *testing.T) {
	tempDir := t.TempDir()
	alertChan := make(chan SynthesisAlert, 10)
	engine := NewSynthesisEngine(tempDir, alertChan)

	baseNodes := []models.MemoryNode{
		taggedNode("node-a", "Base", "[ORG:ACME] opened a new shell company."),
	}
	engine.AnalyzeOverlap(context.Background(), "vault-a", baseNodes, baseNodes, nil)
	waitForOverlapDispatch()
	drainAlerts(alertChan)

	allNodes := []models.MemoryNode{
		taggedNode("node-b", "Older board node", "[ORG:Beta] stayed inactive."),
		taggedNode("node-c", "Fresh lead", "[ORG:ACME] resurfaced in a procurement memo."),
	}
	pendingNodes := []models.MemoryNode{allNodes[1]}

	engine.AnalyzeOverlap(context.Background(), "vault-b", pendingNodes, allNodes, nil)
	waitForOverlapDispatch()

	alerts := drainAlerts(alertChan)
	if len(alerts) != 1 {
		t.Fatalf("expected 1 overlap alert from incremental nodes, got %d", len(alerts))
	}

	alert := alerts[0]
	if alert.Entity != "acme" {
		t.Fatalf("expected overlap entity acme, got %q", alert.Entity)
	}
	if len(alert.Nodes) == 0 || alert.Nodes[len(alert.Nodes)-1].NodeID != "node-c" {
		t.Fatalf("expected pending node context to be included in the alert")
	}
}

func TestDateOverlapsAllowedAndTimeIgnored(t *testing.T) {
	tempDir := t.TempDir()
	alertChan := make(chan SynthesisAlert, 10)
	engine := NewSynthesisEngine(tempDir, alertChan)

	firstCase := []models.MemoryNode{
		taggedNode("node-1", "Timeline", "Hearing set for [DATE:2026-03-31] at [TIME:09:30 AM]."),
	}
	secondCase := []models.MemoryNode{
		taggedNode("node-2", "Follow-up", "Separate filing also points to [DATE:2026-03-31] at [TIME:09:30 AM]."),
	}

	engine.AnalyzeOverlap(context.Background(), "vault-1", firstCase, firstCase, nil)
	waitForOverlapDispatch()
	drainAlerts(alertChan)

	engine.AnalyzeOverlap(context.Background(), "vault-2", secondCase, secondCase, nil)
	waitForOverlapDispatch()

	alerts := drainAlerts(alertChan)
	if len(alerts) != 1 {
		t.Fatalf("expected only the shared DATE to trigger, got %d alerts", len(alerts))
	}
	if alerts[0].Entity != "2026-03-31" {
		t.Fatalf("expected date overlap alert, got %q", alerts[0].Entity)
	}
}

func TestConcurrentSynthesisOverlaps(t *testing.T) {
	tempDir := t.TempDir()
	alertChan := make(chan SynthesisAlert, 100)
	engine := NewSynthesisEngine(tempDir, alertChan)

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			vaultID := "case-" + strconv.Itoa(id)
			nodes := []models.MemoryNode{
				taggedNode("node", "Concurrent", "[ORG:ConvergencePoint] appeared in the evidence."),
			}
			engine.AnalyzeOverlap(context.Background(), vaultID, nodes, nodes, nil)
		}(i)
	}

	wg.Wait()

	engine.mu.RLock()
	defer engine.mu.RUnlock()
	caseMap := engine.Index.EntityMap["convergencepoint"]
	if len(caseMap) != 50 {
		t.Fatalf("expected exactly 50 distinct overlapping cases for entity 'ConvergencePoint', got %d", len(caseMap))
	}
}

func TestOverlapDispatchLimitsLLMChecksToTopRankedCandidates(t *testing.T) {
	tempDir := t.TempDir()
	alertChan := make(chan SynthesisAlert, 20)
	engine := NewSynthesisEngine(tempDir, alertChan)

	firstCase := []models.MemoryNode{
		taggedNode("base-1", "Overlap seed", "[PERSON:Jane Doe] met [ORG:Alpha Systems] in [LOC:Tehran] on [DATE:2026-03-31]."),
		taggedNode("base-2", "Follow up", "[ORG:Meridian Labs] called [PERSON:Omar Haddad] while [ORG:Redline Capital] tracked [ORG:Beacon Works]."),
		taggedNode("base-3", "Extra context", "[ORG:Northstar Dynamics] coordinated a response."),
	}
	engine.AnalyzeOverlap(context.Background(), "vault-base", firstCase, firstCase, nil)
	waitForOverlapDispatch()
	drainAlerts(alertChan)

	var callsMu sync.Mutex
	llmCalls := 0
	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			callsMu.Lock()
			llmCalls++
			callsMu.Unlock()
			response := target.(*overlapBatchResponse)
			response.Decisions = []overlapBatchDecision{
				{Entity: "jane doe", Meaningful: true, Reason: "Meaningful overlap"},
				{Entity: "omar haddad", Meaningful: true, Reason: "Meaningful overlap"},
				{Entity: "alpha systems", Meaningful: true, Reason: "Meaningful overlap"},
				{Entity: "beacon works", Meaningful: true, Reason: "Meaningful overlap"},
				{Entity: "meridian labs", Meaningful: true, Reason: "Meaningful overlap"},
				{Entity: "northstar dynamics", Meaningful: true, Reason: "Meaningful overlap"},
			}
			return nil
		},
	}
	searchBrain := &Brain{
		ModelRouter: map[string]ModelProvider{
			"mock": mock,
		},
	}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	secondCase := []models.MemoryNode{
		taggedNode("next-1", "Overlap follow up", "[PERSON:Jane Doe] revisited [ORG:Alpha Systems] in [LOC:Tehran] on [DATE:2026-03-31]."),
		taggedNode("next-2", "Investor chatter", "[ORG:Meridian Labs] briefed [PERSON:Omar Haddad] while [ORG:Redline Capital] monitored [ORG:Beacon Works]."),
		taggedNode("next-3", "Operations", "[ORG:Northstar Dynamics] surfaced again."),
	}
	engine.AnalyzeOverlap(context.Background(), "vault-next", secondCase, secondCase, searchBrain)
	waitForOverlapDispatch()

	alerts := drainAlerts(alertChan)
	if len(alerts) != maxOverlapAlertsPerRun {
		t.Fatalf("expected %d ranked alerts, got %d", maxOverlapAlertsPerRun, len(alerts))
	}

	callsMu.Lock()
	defer callsMu.Unlock()
	if llmCalls != 1 {
		t.Fatalf("expected a single batched LLM check, got %d", llmCalls)
	}

	for _, alert := range alerts {
		if alert.Entity == "2026-03-31" {
			t.Fatalf("expected lower-priority DATE overlap to fall below the alert budget")
		}
	}
}

func TestPurgeVault(t *testing.T) {
	tempDir := t.TempDir()
	alertChan := make(chan SynthesisAlert, 10)
	engine := NewSynthesisEngine(tempDir, alertChan)

	nodesA := []models.MemoryNode{
		taggedNode("n1", "Fruit", "[ORG:Apple] partnered with [ORG:Banana]."),
	}
	nodesB := []models.MemoryNode{
		taggedNode("n2", "Fruit", "[ORG:Apple] also mentioned [ORG:Cherry]."),
	}
	engine.AnalyzeOverlap(context.Background(), "vault-1", nodesA, nodesA, nil)
	engine.AnalyzeOverlap(context.Background(), "vault-2", nodesB, nodesB, nil)
	waitForOverlapDispatch()

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
			expectedBananaExists: false,
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
				t.Fatalf("expected %d Vaults, got %d", tt.expectedVaultsCount, len(engine.Index.Vaults))
			}

			if appleRefs, exists := engine.Index.EntityMap["apple"]; exists {
				if len(appleRefs) != tt.expectedAppleRefs {
					t.Fatalf("expected %d refs for Apple, got %d", tt.expectedAppleRefs, len(appleRefs))
				}
			} else if tt.expectedAppleRefs > 0 {
				t.Fatalf("expected Apple to exist with %d refs, but it was deleted entirely", tt.expectedAppleRefs)
			}

			_, bananaExists := engine.Index.EntityMap["banana"]
			if bananaExists != tt.expectedBananaExists {
				t.Fatalf("expected banana existence to be %v, got %v", tt.expectedBananaExists, bananaExists)
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
		taggedNode(nodeID, "Original Title", "[ORG:Entity] appeared in summary text."),
	}

	engine.AnalyzeOverlap(context.Background(), vaultID, nodes, nodes, nil)

	engine.mu.RLock()
	archivedNode, exists := engine.Index.NodeArchive[vaultID][nodeID]
	engine.mu.RUnlock()

	if !exists {
		t.Fatalf("node was not stored in NodeArchive")
	}
	if archivedNode.Title != "Original Title" {
		t.Fatalf("expected title 'Original Title', got '%s'", archivedNode.Title)
	}

	engine.PurgeVault(vaultID)

	engine.mu.RLock()
	_, exists = engine.Index.NodeArchive[vaultID]
	engine.mu.RUnlock()

	if exists {
		t.Fatalf("NodeArchive entry for vault was not purged")
	}
}

func TestRegisterDerivedVault(t *testing.T) {
	tempDir := t.TempDir()
	alertChan := make(chan SynthesisAlert, 10)
	engine := NewSynthesisEngine(tempDir, alertChan)

	nodes := []models.MemoryNode{
		taggedNode("merged-node-1", "Merged Intel", "Linked to [PERSON:Alice] and [ORG:Beta Corp]."),
	}

	engine.RegisterDerivedVault("merge-vault", []string{"vault-a", "vault-b"}, nodes)

	engine.mu.RLock()
	defer engine.mu.RUnlock()

	if !engine.Index.Vaults["merge-vault"] {
		t.Fatalf("expected merge-vault to be tracked as an active vault")
	}
	if _, exists := engine.Index.Derived["merge-vault"]; !exists {
		t.Fatalf("expected merge-vault to be tracked as derived")
	}
	if archive := engine.Index.NodeArchive["merge-vault"]; len(archive) != 1 {
		t.Fatalf("expected merge-vault archive to contain 1 node, got %d", len(archive))
	}
	if contexts := engine.Index.EntityMap["alice"]["merge-vault"]; len(contexts) != 1 {
		t.Fatalf("expected alice to be indexed for merge-vault, got %d contexts", len(contexts))
	}
}

func TestDerivedVaultSkipsOverlapAlerts(t *testing.T) {
	tempDir := t.TempDir()
	alertChan := make(chan SynthesisAlert, 10)
	engine := NewSynthesisEngine(tempDir, alertChan)

	parentNodes := []models.MemoryNode{
		taggedNode("parent-node", "Parent", "[PERSON:Alice] appeared in the parent case."),
	}
	engine.AnalyzeOverlap(context.Background(), "vault-parent", parentNodes, parentNodes, nil)
	waitForOverlapDispatch()
	drainAlerts(alertChan)

	derivedNodes := []models.MemoryNode{
		taggedNode("derived-node", "Derived", "[PERSON:Alice] was copied into the merged canvas."),
	}
	engine.RegisterDerivedVault("merge-vault", []string{"vault-parent"}, derivedNodes)

	engine.AnalyzeOverlap(context.Background(), "merge-vault", derivedNodes, derivedNodes, nil)
	waitForOverlapDispatch()

	alerts := drainAlerts(alertChan)
	if len(alerts) != 0 {
		t.Fatalf("expected derived vault overlap alerts to be suppressed, got %d", len(alerts))
	}
}
