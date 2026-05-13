package models

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPipelineProfileCapturesMeasuredBottlenecksAndSavesCompactJSON(t *testing.T) {
	now := time.Date(2026, 5, 13, 12, 0, 0, 0, time.UTC)
	tracker := NewPipelineProgressTrackerWithClock(
		"run-profile-1",
		"inv-profile-1",
		"web",
		[]PipelineProgressStep{
			{ID: "start", Label: "Starting crawl"},
			{ID: "gather_evidence", Label: "Gathering evidence"},
			{ID: "complete", Label: "Pipeline complete"},
		},
		func() time.Time { return now },
	)

	tracker.Start("start", "accepted")
	now = now.Add(250 * time.Millisecond)
	tracker.Complete("start", "ready")
	tracker.RecordSpan(PipelineProfileSpan{
		ID:         "node_summary",
		StepID:     "gather_evidence",
		Label:      "Node summary",
		StartedAt:  time.Date(2026, 5, 13, 12, 0, 1, 0, time.UTC).Format(time.RFC3339Nano),
		DurationMs: 8200,
		Detail:     "summarized 8 nodes",
	})
	tracker.RecordCounter("nodesCreated", 8)
	tracker.RecordTokenUsage(PipelineProfileTokenUsage{
		Operation:         "node_summary",
		Provider:          "gemini",
		CallCount:         8,
		ReportedCallCount: 8,
		PromptTokens:      4800,
		CompletionTokens:  1200,
		TotalTokens:       6000,
	})
	now = now.Add(9 * time.Second)
	tracker.Complete("gather_evidence", "raw secret evidence must not appear")
	now = now.Add(50 * time.Millisecond)
	tracker.Complete("complete", "done")

	profile := tracker.Profile()
	if profile.RunID != "run-profile-1" || profile.VaultID != "inv-profile-1" || profile.Status != PipelineStatusComplete {
		t.Fatalf("unexpected profile identity/status: %#v", profile)
	}
	if profile.Counters["nodesCreated"] != 8 {
		t.Fatalf("nodesCreated counter = %d, want 8", profile.Counters["nodesCreated"])
	}
	if len(profile.Bottlenecks) == 0 || profile.Bottlenecks[0].ID != "node_summary" {
		t.Fatalf("expected node_summary to be top bottleneck, got %#v", profile.Bottlenecks)
	}

	rawProfile, err := json.Marshal(profile)
	if err != nil {
		t.Fatalf("failed to marshal profile: %v", err)
	}
	if strings.Contains(string(rawProfile), "raw secret evidence") {
		t.Fatalf("profile leaked raw evidence detail: %s", rawProfile)
	}

	store := NewPipelineProfileStore(filepath.Join(t.TempDir(), "pipeline_runs"), 10)
	if err := store.Save(profile); err != nil {
		t.Fatalf("failed to save profile: %v", err)
	}
	loaded, err := store.Load("run-profile-1")
	if err != nil {
		t.Fatalf("failed to load profile: %v", err)
	}
	if loaded.Bottlenecks[0].ID != "node_summary" || loaded.TokenUsage[0].Operation != "node_summary" {
		t.Fatalf("loaded profile lost measured data: %#v", loaded)
	}
}

func TestPipelineProfileStoreListsNewestProfilesAndPrunesRetention(t *testing.T) {
	store := NewPipelineProfileStore(filepath.Join(t.TempDir(), "pipeline_runs"), 2)
	for index := 0; index < 4; index++ {
		profile := PipelinePerformanceProfile{
			RunID:          "run-retention-" + string(rune('a'+index)),
			VaultID:        "inv-retention",
			Mode:           "web",
			Status:         PipelineStatusComplete,
			StartedAt:      time.Date(2026, 5, 13, 12, index, 0, 0, time.UTC).Format(time.RFC3339Nano),
			CompletedAt:    time.Date(2026, 5, 13, 12, index, 1, 0, time.UTC).Format(time.RFC3339Nano),
			TotalElapsedMs: int64(index + 1),
		}
		if err := store.Save(profile); err != nil {
			t.Fatalf("save profile %d: %v", index, err)
		}
	}

	profiles, err := store.List(10)
	if err != nil {
		t.Fatalf("list profiles: %v", err)
	}
	if len(profiles) != 2 {
		t.Fatalf("profile count = %d, want retained 2", len(profiles))
	}
	if profiles[0].RunID != "run-retention-d" || profiles[1].RunID != "run-retention-c" {
		t.Fatalf("profiles not newest first after pruning: %#v", profiles)
	}
}

func TestPipelineProfileStoreOverwritesPartialRunAndGroupsTokens(t *testing.T) {
	now := time.Date(2026, 5, 13, 13, 0, 0, 0, time.UTC)
	tracker := NewPipelineProgressTrackerWithClock(
		"run-partial-1",
		"inv-partial-1",
		"web",
		[]PipelineProgressStep{
			{ID: "start", Label: "Starting crawl"},
			{ID: "complete", Label: "Pipeline complete"},
		},
		func() time.Time { return now },
	)
	tracker.Start("start", "accepted")
	tracker.RecordTokenUsage(
		PipelineProfileTokenUsage{Operation: "persona_analysis", Provider: "gemini", CallCount: 1, TotalTokens: 1000},
		PipelineProfileTokenUsage{Operation: "persona_analysis", Provider: "gemini", CallCount: 2, TotalTokens: 2400},
		PipelineProfileTokenUsage{Operation: "persona_analysis", Provider: "openai", CallCount: 1, TotalTokens: 800},
	)

	store := NewPipelineProfileStore(filepath.Join(t.TempDir(), "pipeline_runs"), 10)
	if err := store.Save(tracker.Profile()); err != nil {
		t.Fatalf("save partial profile: %v", err)
	}

	now = now.Add(4 * time.Second)
	tracker.Complete("start", "ready")
	tracker.Complete("complete", "done")
	if err := store.Save(tracker.Profile()); err != nil {
		t.Fatalf("save completed profile: %v", err)
	}

	loaded, err := store.Load("run-partial-1")
	if err != nil {
		t.Fatalf("load completed profile: %v", err)
	}
	if loaded.Status != PipelineStatusComplete {
		t.Fatalf("expected completed overwrite, got status %q", loaded.Status)
	}
	if len(loaded.TokenUsage) != 2 {
		t.Fatalf("expected token usage grouped by operation/provider, got %#v", loaded.TokenUsage)
	}
	if loaded.TokenUsage[0].Operation != "persona_analysis" || loaded.TokenUsage[0].Provider != "gemini" || loaded.TokenUsage[0].TotalTokens != 3400 || loaded.TokenUsage[0].CallCount != 3 {
		t.Fatalf("unexpected grouped token usage: %#v", loaded.TokenUsage[0])
	}
}
