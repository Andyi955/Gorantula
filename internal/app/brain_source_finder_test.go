package app

import (
	"context"
	"errors"
	"testing"

	"github.com/Andyi955/Gorantula/internal/brainmemory"
	"github.com/Andyi955/Gorantula/models"
)

type fakeBrainSourceSignalRunner struct {
	signals []models.NerveSignal
	flows   []models.NutrientFlow
	err     error
}

func (f *fakeBrainSourceSignalRunner) RunSignals(_ context.Context, signals []models.NerveSignal) ([]models.NutrientFlow, error) {
	f.signals = append([]models.NerveSignal(nil), signals...)
	return f.flows, f.err
}

func TestBrainSourceEvidenceFinderUsesPromptAsWebQuery(t *testing.T) {
	runner := &fakeBrainSourceSignalRunner{
		flows: []models.NutrientFlow{{
			SourceURL: "https://sources.example.com/acme-grid",
			Content:   "Acme Grid source evidence.",
		}},
	}
	finder := brainSourceEvidenceFinder{runner: runner}

	evidence, err := finder.FindSourceEvidence(context.Background(), brainmemory.SourceEvidenceLookupRequest{
		SearchPrompt: "Find source evidence for Acme Grid power stress.",
	})
	if err != nil {
		t.Fatalf("FindSourceEvidence failed: %v", err)
	}
	if len(runner.signals) != 1 || runner.signals[0].TargetQuery != "Find source evidence for Acme Grid power stress." {
		t.Fatalf("expected source prompt to be dispatched as one web query, got %#v", runner.signals)
	}
	if len(evidence) != 1 || evidence[0].SourceURL != "https://sources.example.com/acme-grid" {
		t.Fatalf("expected valid source URL evidence, got %#v", evidence)
	}
	if evidence[0].EvidenceID != "web-source" {
		t.Fatalf("expected web-source evidence id, got %#v", evidence[0])
	}
}

func TestBrainSourceEvidenceFinderIgnoresInvalidAndErroredNutrients(t *testing.T) {
	runner := &fakeBrainSourceSignalRunner{
		flows: []models.NutrientFlow{
			{SourceURL: "notaurl", Content: "bad"},
			{SourceURL: "https://sources.example.com/failed", Error: errors.New("fetch failed")},
			{SourceURL: "https://sources.example.com/good", Content: "good"},
		},
	}
	finder := brainSourceEvidenceFinder{runner: runner}

	evidence, err := finder.FindSourceEvidence(context.Background(), brainmemory.SourceEvidenceLookupRequest{
		SearchPrompt: "Find source evidence.",
	})
	if err != nil {
		t.Fatalf("FindSourceEvidence failed: %v", err)
	}
	if len(evidence) != 1 || evidence[0].SourceURL != "https://sources.example.com/good" {
		t.Fatalf("expected only valid successful nutrient evidence, got %#v", evidence)
	}
}

func TestBrainSourceEvidenceFinderSkipsEmptyQuery(t *testing.T) {
	runner := &fakeBrainSourceSignalRunner{}
	finder := brainSourceEvidenceFinder{runner: runner}

	evidence, err := finder.FindSourceEvidence(context.Background(), brainmemory.SourceEvidenceLookupRequest{})
	if err != nil {
		t.Fatalf("FindSourceEvidence failed: %v", err)
	}
	if evidence != nil {
		t.Fatalf("expected no evidence for an empty query, got %#v", evidence)
	}
	if len(runner.signals) != 0 {
		t.Fatalf("expected no web query for an empty prompt, got %#v", runner.signals)
	}
}
