package models

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestInvestigationStoreSaveLoadListAndDelete(t *testing.T) {
	store := NewInvestigationStore(t.TempDir())
	primaryParent := "inv-parent"

	parent := InvestigationRecord{
		ID:           primaryParent,
		Topic:        "Parent Case",
		Kind:         "root",
		DisplayTopic: "Parent Case",
	}
	child := InvestigationRecord{
		ID:              "merge-child",
		Topic:           "Child Case",
		Kind:            "merged-child",
		ParentIDs:       []string{primaryParent},
		MergedFromIDs:   []string{primaryParent},
		PrimaryParentID: &primaryParent,
		DisplayTopic:    "Child Case",
	}

	if err := store.SaveMetadata(parent); err != nil {
		t.Fatalf("SaveMetadata parent failed: %v", err)
	}
	if err := store.SaveMetadata(child); err != nil {
		t.Fatalf("SaveMetadata child failed: %v", err)
	}

	loaded, err := store.LoadMetadata(child.ID)
	if err != nil {
		t.Fatalf("LoadMetadata failed: %v", err)
	}
	if loaded.Kind != "merged-child" || loaded.PrimaryParentID == nil || *loaded.PrimaryParentID != primaryParent {
		t.Fatalf("loaded child metadata mismatch: %#v", loaded)
	}

	records, err := store.List()
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("expected 2 records, got %d", len(records))
	}

	var listedParent InvestigationRecord
	for _, record := range records {
		if record.ID == primaryParent {
			listedParent = record
		}
	}
	if len(listedParent.ChildIDs) != 1 || listedParent.ChildIDs[0] != child.ID {
		t.Fatalf("expected parent child links to be recomputed, got %#v", listedParent.ChildIDs)
	}

	if err := store.Delete(child.ID); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if _, err := store.LoadMetadata(child.ID); !errors.Is(err, ErrInvestigationNotFound) {
		t.Fatalf("expected not found after delete, got %v", err)
	}
}

func TestInvestigationStoreSavesRawJSONPayloads(t *testing.T) {
	store := NewInvestigationStore(t.TempDir())
	payload := json.RawMessage(`{"nodes":[{"id":"node-1"}],"edges":[]}`)

	if err := store.SaveJSON("inv-1", InvestigationBoardFilename, payload); err != nil {
		t.Fatalf("SaveJSON failed: %v", err)
	}

	loaded, err := store.LoadJSON("inv-1", InvestigationBoardFilename)
	if err != nil {
		t.Fatalf("LoadJSON failed: %v", err)
	}
	if string(loaded) != string(payload) {
		t.Fatalf("payload mismatch: %s", loaded)
	}
}

func TestInvestigationStoreSavesRelationshipResults(t *testing.T) {
	store := NewInvestigationStore(t.TempDir())
	payload := json.RawMessage(`{"vaultId":"inv-1","connections":[{"source":"node-a","target":"node-b","tag":"RELATED","reasoning":"Shared evidence"}]}`)

	if err := store.SaveJSON("inv-1", InvestigationRelationshipsFilename, payload); err != nil {
		t.Fatalf("SaveJSON relationships failed: %v", err)
	}

	loaded, err := store.LoadJSON("inv-1", InvestigationRelationshipsFilename)
	if err != nil {
		t.Fatalf("LoadJSON relationships failed: %v", err)
	}
	if string(loaded) != string(payload) {
		t.Fatalf("relationship payload mismatch: %s", loaded)
	}
}

func TestInvestigationStoreRejectsInvalidIDsAndTraversal(t *testing.T) {
	root := t.TempDir()
	store := NewInvestigationStore(root)

	invalidIDs := []string{"", "../escape", "nested/id", `nested\id`, ".hidden"}
	for _, id := range invalidIDs {
		if err := store.SaveJSON(id, InvestigationBoardFilename, json.RawMessage(`{}`)); !errors.Is(err, ErrInvalidInvestigationID) {
			t.Fatalf("expected invalid id error for %q, got %v", id, err)
		}
	}

	if _, err := os.Stat(filepath.Join(root, "..", "escape")); err == nil {
		t.Fatal("unexpected traversal path created")
	}
}

func TestInvestigationStoreSkipsNonInvestigationDirectories(t *testing.T) {
	root := t.TempDir()
	store := NewInvestigationStore(root)

	if err := os.MkdirAll(filepath.Join(root, "pipeline_runs"), 0755); err != nil {
		t.Fatalf("failed to create pipeline_runs: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "relationship_logs"), 0755); err != nil {
		t.Fatalf("failed to create relationship_logs: %v", err)
	}
	if err := store.SaveMetadata(InvestigationRecord{ID: "inv-1", Topic: "Case"}); err != nil {
		t.Fatalf("SaveMetadata failed: %v", err)
	}

	records, err := store.List()
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(records) != 1 || records[0].ID != "inv-1" {
		t.Fatalf("expected only saved investigation, got %#v", records)
	}
}

func TestInvestigationStoreSaveJSONIsAtomic(t *testing.T) {
	root := t.TempDir()
	store := NewInvestigationStore(root)
	if err := store.SaveMetadata(InvestigationRecord{ID: "inv-atomic", Topic: "Atomic"}); err != nil {
		t.Fatalf("SaveMetadata failed: %v", err)
	}

	payload := json.RawMessage(`{"nodes": [], "edges": []}`)
	if err := store.SaveJSON("inv-atomic", InvestigationBoardFilename, payload); err != nil {
		t.Fatalf("SaveJSON failed: %v", err)
	}

	// Concurrent saves and loads: a reader must never observe a partially
	// written file (the transient "contains invalid json" failure mode).
	var waitGroup sync.WaitGroup
	errCh := make(chan error, 200)
	for writer := 0; writer < 4; writer++ {
		waitGroup.Add(1)
		go func(writer int) {
			defer waitGroup.Done()
			for round := 0; round < 25; round++ {
				payload := json.RawMessage(fmt.Sprintf(`{"writer": %d, "round": %d}`, writer, round))
				if err := store.SaveJSON("inv-atomic", InvestigationBoardFilename, payload); err != nil {
					errCh <- fmt.Errorf("save failed: %w", err)
					return
				}
			}
		}(writer)
	}
	for reader := 0; reader < 4; reader++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			for round := 0; round < 100; round++ {
				data, err := store.LoadJSON("inv-atomic", InvestigationBoardFilename)
				if err != nil {
					errCh <- fmt.Errorf("concurrent load observed invalid state: %w", err)
					return
				}
				if !json.Valid(data) {
					errCh <- fmt.Errorf("concurrent load observed invalid json")
					return
				}
			}
		}()
	}
	waitGroup.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatal(err)
	}

	// No temp files may survive a completed save.
	entries, err := os.ReadDir(filepath.Join(root, "inv-atomic"))
	if err != nil {
		t.Fatalf("ReadDir failed: %v", err)
	}
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".tmp-") {
			t.Fatalf("temp file left behind: %s", entry.Name())
		}
	}
}
