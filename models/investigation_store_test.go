package models

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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
