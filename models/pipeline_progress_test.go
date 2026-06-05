package models

import (
	"testing"
	"time"
)

func TestPipelineProgressTrackerBuildsTimedMessages(t *testing.T) {
	current := time.Date(2026, 5, 13, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time { return current }
	tracker := NewPipelineProgressTrackerWithClock(
		"run-123",
		"inv-123",
		"web",
		[]PipelineProgressStep{
			{ID: "start", Label: "Starting crawl"},
			{ID: "plan_queries", Label: "Planning search queries"},
		},
		clock,
	)

	running := tracker.Start("start", "Operator submitted a query")
	payload, ok := running.Payload.(PipelineProgressPayload)
	if !ok {
		t.Fatalf("payload type = %T, want PipelineProgressPayload", running.Payload)
	}
	if running.Type != "PIPELINE_PROGRESS" {
		t.Fatalf("message type = %q, want PIPELINE_PROGRESS", running.Type)
	}
	if payload.RunID != "run-123" || payload.VaultID != "inv-123" || payload.Mode != "web" {
		t.Fatalf("unexpected metadata: %+v", payload)
	}
	if payload.StepID != "start" || payload.StepLabel != "Starting crawl" || payload.Status != "running" {
		t.Fatalf("unexpected running payload: %+v", payload)
	}
	if payload.CompletedSteps != 0 || payload.TotalSteps != 2 {
		t.Fatalf("completed/total = %d/%d, want 0/2", payload.CompletedSteps, payload.TotalSteps)
	}

	current = current.Add(2500 * time.Millisecond)
	completed := tracker.Complete("start", "Socket accepted crawl")
	payload = completed.Payload.(PipelineProgressPayload)

	if payload.Status != "complete" {
		t.Fatalf("status = %q, want complete", payload.Status)
	}
	if payload.CompletedSteps != 1 {
		t.Fatalf("CompletedSteps = %d, want 1", payload.CompletedSteps)
	}
	if payload.DurationMs != 2500 {
		t.Fatalf("DurationMs = %d, want 2500", payload.DurationMs)
	}
	if payload.ElapsedMs != 2500 {
		t.Fatalf("ElapsedMs = %d, want 2500", payload.ElapsedMs)
	}
}

func TestPipelineProgressTrackerReportsErrors(t *testing.T) {
	tracker := NewPipelineProgressTrackerWithClock(
		"run-err",
		"inv-err",
		"web",
		[]PipelineProgressStep{{ID: "relationships", Label: "Relationship synthesis"}},
		func() time.Time { return time.Date(2026, 5, 13, 12, 0, 0, 0, time.UTC) },
	)

	msg := tracker.Error("relationships", "model unavailable")
	payload := msg.Payload.(PipelineProgressPayload)

	if payload.Status != "error" {
		t.Fatalf("status = %q, want error", payload.Status)
	}
	if payload.Error != "model unavailable" {
		t.Fatalf("error = %q, want model unavailable", payload.Error)
	}
	if len(payload.Steps) != 1 || payload.Steps[0].Status != "error" {
		t.Fatalf("unexpected step states: %+v", payload.Steps)
	}
}

func TestLocalPipelineProgressStepsIncludePostIngestionAnalysis(t *testing.T) {
	steps := LocalPipelineProgressSteps()
	stepIDs := make(map[string]bool, len(steps))
	for _, step := range steps {
		stepIDs[step.ID] = true
	}

	for _, required := range []string{
		"persona_analysis",
		"overlap_scan",
		"relationship_synthesis",
		"discovery_review",
	} {
		if !stepIDs[required] {
			t.Fatalf("expected local pipeline steps to include %q, got %#v", required, steps)
		}
	}
}

func TestRabbitHolePipelineProgressStepsIncludeGatekeeper(t *testing.T) {
	steps := RabbitHolePipelineProgressSteps()

	foundGatekeeper := false
	foundComplete := false
	for _, step := range steps {
		if step.ID == "rabbit_gatekeeper" {
			foundGatekeeper = true
			if step.Label != "Rabbit Hole gatekeeper" {
				t.Fatalf("gatekeeper label = %q", step.Label)
			}
		}
		if step.ID == "complete" {
			foundComplete = true
		}
	}

	if !foundGatekeeper {
		t.Fatal("expected Rabbit Hole pipeline steps to include gatekeeper review")
	}
	if !foundComplete {
		t.Fatal("expected Rabbit Hole pipeline steps to retain completion step")
	}
}

func TestPipelineProgressTrackerCancelMarksTerminalProfile(t *testing.T) {
	now := time.Date(2026, 5, 18, 9, 30, 0, 0, time.UTC)
	tracker := NewPipelineProgressTrackerWithClock(
		"run-cancel-profile",
		"inv-cancel-profile",
		"web",
		[]PipelineProgressStep{
			{ID: "start", Label: "Starting crawl"},
			{ID: "gather_evidence", Label: "Gathering evidence"},
			{ID: "complete", Label: "Pipeline complete"},
		},
		func() time.Time { return now },
	)

	tracker.Start("start", "accepted")
	now = now.Add(200 * time.Millisecond)
	tracker.Complete("start", "ready")
	now = now.Add(3 * time.Second)
	tracker.Start("gather_evidence", "Gathering evidence")
	now = now.Add(2 * time.Second)

	message := tracker.Cancel("complete", "Stopped by operator")
	payload, ok := message.Payload.(PipelineProgressPayload)
	if !ok {
		t.Fatalf("unexpected cancel payload type: %#v", message.Payload)
	}
	if payload.Status != PipelineStatusCancelled {
		t.Fatalf("cancel status = %q, want %q", payload.Status, PipelineStatusCancelled)
	}
	if payload.CompletedAt == "" {
		t.Fatal("cancel payload should include a completion timestamp")
	}

	profile := tracker.Profile()
	if profile.Status != PipelineStatusCancelled {
		t.Fatalf("profile status = %q, want %q", profile.Status, PipelineStatusCancelled)
	}
	if profile.CompletedAt == "" {
		t.Fatal("cancelled profile should be terminal")
	}
	if profile.Steps[1].Status != PipelineStatusCancelled {
		t.Fatalf("running step status = %q, want cancelled", profile.Steps[1].Status)
	}
}
