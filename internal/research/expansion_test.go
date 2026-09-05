package research

import (
	"context"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

type stubRetriever struct {
	papers []models.Paper
}

func (s stubRetriever) Retrieve(_ context.Context, _ string, _ int) ([]models.Paper, error) {
	return s.papers, nil
}

func TestReconstructOpenAlexAbstract(t *testing.T) {
	inverted := map[string][]int{"the": {0}, "drug": {1}, "works": {2}, ".": {3}}
	got := reconstructOpenAlexAbstract(inverted)
	if !strings.HasPrefix(got, "the drug works") {
		t.Errorf("reconstructed abstract = %q", got)
	}
	if reconstructOpenAlexAbstract(nil) != "" {
		t.Errorf("empty inverted index should yield empty abstract")
	}
}

func TestExpansionQuery(t *testing.T) {
	claims := []models.Claim{
		{ID: "c1", PaperID: "p1", Entities: []string{"[PRODUCT:Metformin]"}},
	}
	candidate := models.CandidateHypothesis{ID: "cand", Hypothesis: "Metformin improves survival"}
	query := expansionQuery(candidate, claims, "strength")
	if !strings.Contains(strings.ToLower(query), "metformin") {
		t.Errorf("query should include the entity: %q", query)
	}
	if !strings.Contains(strings.ToLower(query), "effect size") {
		t.Errorf("query should include the missing quantity: %q", query)
	}
}

func TestUnknownChecklistIDs(t *testing.T) {
	candidate := &models.CandidateHypothesis{Checklist: []models.ChecklistItem{
		{ID: "strength", Answer: "unknown"},
		{ID: "specificity", Answer: "yes"},
		{ID: "gradient", Answer: "unknown"},
	}}
	ids := unknownChecklistIDs(candidate)
	if len(ids) != 2 || ids[0] != "strength" || ids[1] != "gradient" {
		t.Errorf("unknown ids = %v", ids)
	}
}

func TestExpandCandidateBelowMinSources(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	svc.SetEvidenceRetriever(stubRetriever{papers: []models.Paper{{ID: "p1", Title: "Single source", Abstract: "a"}}})

	candidate := &models.CandidateHypothesis{
		ID:        "cand-low",
		State:     models.CandidateStateReviewed,
		Checklist: []models.ChecklistItem{{ID: "strength", Answer: "unknown"}},
	}
	svc.expandCandidateEvidence(context.Background(), candidate, nil, nil)

	if candidate.Expansion != nil {
		t.Errorf("a single niche source must not trigger expansion (anti-confirmation-bias)")
	}
}

func TestExpandCandidateRecordsExpansion(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	svc.SetEvidenceRetriever(stubRetriever{papers: []models.Paper{
		{ID: "p1", Title: "Source A", Abstract: "a"},
		{ID: "p2", Title: "Source B", Abstract: "b"},
	}})

	candidate := &models.CandidateHypothesis{
		ID:        "cand-ok",
		State:     models.CandidateStateReviewed,
		Checklist: []models.ChecklistItem{{ID: "strength", Answer: "unknown"}},
	}
	svc.expandCandidateEvidence(context.Background(), candidate, nil, nil)

	if candidate.Expansion == nil {
		t.Fatalf("expansion should be recorded when >=2 sources are found")
	}
	if candidate.Expansion.Round != 1 || len(candidate.Expansion.Retrieved) != 2 {
		t.Errorf("expansion = %+v", candidate.Expansion)
	}
}
