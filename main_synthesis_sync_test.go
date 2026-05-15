package main

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"spider-agent/brain"
	"spider-agent/models"
)

func TestMemoryNodesFromPersistedBoard(t *testing.T) {
	raw := json.RawMessage(`{
		"nodes": [
			{
				"id": "node-1",
				"data": {
					"title": "Evidence One",
					"summary": "Summary mentions [ORG:Acme Labs].",
					"fullText": "Full text mentions [ORG:Acme Labs] and [PERSON:Jane Doe].",
					"sourceURL": "https://example.test/story"
				}
			},
			{
				"id": "node-2",
				"data": {
					"summary": "Summary-only node mentions [ORG:Beacon]."
				}
			}
		]
	}`)

	nodes := memoryNodesFromPersistedBoard(raw)
	if len(nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(nodes))
	}
	if nodes[0].Title != "Evidence One" || nodes[0].FullText == "" || nodes[0].SourceURL == "" {
		t.Fatalf("expected persisted node data to be preserved, got %+v", nodes[0])
	}
	if nodes[1].Title != "node-2" || nodes[1].FullText != nodes[1].Summary {
		t.Fatalf("expected fallback title/full text for sparse nodes, got %+v", nodes[1])
	}
}

func TestSyncSynthesisIndexWithActiveVaultsBackfillsBoardEntities(t *testing.T) {
	tempDir := t.TempDir()
	store := models.NewInvestigationStore(tempDir)
	alertChan := make(chan brain.SynthesisAlert, 10)
	engine := brain.NewSynthesisEngine(tempDir, alertChan)

	for _, record := range []models.InvestigationRecord{
		{ID: "inv-old", Topic: "Old Case"},
		{ID: "inv-new", Topic: "New Case"},
	} {
		if err := store.SaveMetadata(record); err != nil {
			t.Fatalf("SaveMetadata(%s) failed: %v", record.ID, err)
		}
	}

	oldBoard := json.RawMessage(`{
		"nodes": [{
			"id": "old-node",
			"data": {
				"title": "Old Acme finding",
				"summary": "[ORG:Acme Labs] appeared in a previous investigation.",
				"fullText": "[ORG:Acme Labs] appeared in a previous investigation with procurement context."
			}
		}]
	}`)
	newBoard := json.RawMessage(`{
		"nodes": [{
			"id": "new-node",
			"data": {
				"title": "New Acme finding",
				"summary": "[ORG:Acme Labs] appears again in a fresh investigation.",
				"fullText": "[ORG:Acme Labs] appears again in a fresh investigation with launch context."
			}
		}]
	}`)

	if err := store.SaveJSON("inv-old", models.InvestigationBoardFilename, oldBoard); err != nil {
		t.Fatalf("SaveJSON old board failed: %v", err)
	}
	if err := store.SaveJSON("inv-new", models.InvestigationBoardFilename, newBoard); err != nil {
		t.Fatalf("SaveJSON new board failed: %v", err)
	}

	syncSynthesisIndexWithActiveVaults(engine, store, map[string]bool{
		"inv-old": true,
		"inv-new": true,
	})

	newNodes := memoryNodesFromPersistedBoard(newBoard)
	engine.AnalyzeOverlap(context.Background(), "inv-new", newNodes, newNodes, nil)

	select {
	case alert := <-alertChan:
		if alert.CurrentVaultID != "inv-new" {
			t.Fatalf("expected alert for inv-new, got %q", alert.CurrentVaultID)
		}
		if alert.Entity != "acme labs" {
			t.Fatalf("expected acme labs overlap, got %q", alert.Entity)
		}
	case <-time.After(250 * time.Millisecond):
		t.Fatal("expected synced historical board to produce an overlap alert")
	}
}

func TestPersonaAnalysisCompletionDetail(t *testing.T) {
	if got := personaAnalysisCompletionDetail(7, 7); got != "Generated 7 persona insight sets" {
		t.Fatalf("full success detail = %q", got)
	}
	if got := personaAnalysisCompletionDetail(5, 7); got != "Partial persona analysis completed (5/7 insight sets)" {
		t.Fatalf("partial success detail = %q", got)
	}
}
