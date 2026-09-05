package research

import (
	"context"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

type stubNovelty struct {
	score   float32
	nearest string
	err     error
}

func (s stubNovelty) CheckNovelty(_ context.Context, _ string, _ []string) (float32, string, error) {
	return s.score, s.nearest, s.err
}

func TestBuildCandidatesFromSignals(t *testing.T) {
	signals := []models.ResearchSignal{
		{
			ID:       "signal-contrast-1",
			Kind:     models.ResearchSignalContradiction,
			Title:    "Contradiction: claim A vs claim B",
			ClaimIDs: []string{"c1", "c2"},
			PaperIDs: []string{"p1", "p2"},
		},
		{
			ID:       "signal-conv-1",
			Kind:     models.ResearchSignalConvergence,
			Title:    "Convergence: claim C vs claim D",
			ClaimIDs: []string{"c3", "c4"},
			PaperIDs: []string{"p3", "p4"},
		},
	}

	candidates := buildCandidates(signals, nil)
	if len(candidates) != 2 {
		t.Fatalf("want 2 candidates, got %d", len(candidates))
	}
	if candidates[0].State != models.CandidateStateProposed {
		t.Errorf("candidate should start proposed, got %q", candidates[0].State)
	}
	if len(candidates[0].ClaimIDs) != 2 || len(candidates[0].PaperIDs) != 2 {
		t.Errorf("candidate claim/paper ids not propagated: %+v", candidates[0])
	}
}

func TestEvaluateChecklistMarksContradictionDisputed(t *testing.T) {
	candidate := models.CandidateHypothesis{
		ID:         "cand-1",
		SignalID:   "sig-1",
		Hypothesis: "Contradiction: Metformin increases survival vs Metformin decreases survival.",
		State:      models.CandidateStateProposed,
	}
	claims := []models.Claim{
		{ID: "c1", Text: "Metformin increases survival.", Entities: []string{"[PRODUCT:Metformin]"}, SourceSnippet: "Metformin increases survival."},
		{ID: "c2", Text: "Metformin decreases survival.", Entities: []string{"[PRODUCT:Metformin]"}, SourceSnippet: "Metformin decreases survival."},
	}

	evaluateChecklist(&candidate, claims)
	// A contradiction is a genuine disagreement, not a refutation: it should be
	// routed to a human ("disputed") and advance to "reviewed".
	if candidate.Verdict != models.CandidateVerdictDisputed {
		t.Errorf("contradiction should be disputed, got %q", candidate.Verdict)
	}
	if candidate.State != models.CandidateStateReviewed {
		t.Errorf("state should become reviewed, got %q", candidate.State)
	}
	if item := findChecklistItem(candidate, "consistency"); item == nil || item.Answer != "unknown" {
		t.Errorf("consistency should be unknown (not refuted) for a contradiction: %+v", item)
	}
	if len(candidate.Checklist) != len(candidateChecklist) {
		t.Errorf("checklist length = %d, want %d", len(candidate.Checklist), len(candidateChecklist))
	}
}

func TestEvaluateChecklistDisputesConvergence(t *testing.T) {
	candidate := models.CandidateHypothesis{
		ID:         "cand-2",
		SignalID:   "sig-2",
		Hypothesis: "Convergence: two independent studies show Metformin improves survival.",
		State:      models.CandidateStateProposed,
	}
	claims := []models.Claim{
		{ID: "c3", Text: "Metformin improves survival in cohort.", Entities: []string{"[PRODUCT:Metformin]"}, SourceSnippet: "Metformin improves survival in cohort."},
		{ID: "c4", Text: "Metformin improves survival in another cohort.", Entities: []string{"[PRODUCT:Metformin]"}, SourceSnippet: "Metformin improves survival in another cohort."},
	}

	evaluateChecklist(&candidate, claims)
	// Convergence has no critical "no", but several criteria are unknown, so
	// the bounded review is "disputed" and the state advances to "reviewed".
	if candidate.Verdict == models.CandidateVerdictRefuted {
		t.Errorf("convergence should not be refuted")
	}
	if candidate.State != models.CandidateStateReviewed {
		t.Errorf("state should become reviewed, got %q", candidate.State)
	}
	if candidate.EvidenceGrade == "" {
		t.Errorf("evidence grade should be set")
	}
}

func TestCandidateApproveAndReject(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	svc.SetNoveltyChecker(stubNovelty{score: 0.9, nearest: "nearest work"})
	_ = svc.store.SaveCandidates([]models.CandidateHypothesis{
		{ID: "cand-a", State: models.CandidateStateReviewed},
		{ID: "cand-b", State: models.CandidateStateReviewed},
	})

	approved, found, err := svc.ApproveCandidate("cand-a", "operator")
	if err != nil {
		t.Fatalf("ApproveCandidate: %v", err)
	}
	if !found {
		t.Fatalf("candidate not found")
	}
	if approved.State != models.CandidateStateApproved || approved.ApprovedBy != "operator" || approved.ApprovedAt == "" {
		t.Errorf("approve did not set state/approver/timestamp: %+v", approved)
	}

	rejected, found, err := svc.RejectCandidate("cand-b", "operator")
	if err != nil {
		t.Fatalf("RejectCandidate: %v", err)
	}
	if !found || rejected.State != models.CandidateStateRejected {
		t.Errorf("reject result: %+v found=%v", rejected, found)
	}

	_, found, err = svc.ApproveCandidate("not-there", "operator")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if found {
		t.Errorf("unknown candidate should not be found")
	}
}

func TestRebuildCandidatesAppliesNovelty(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	svc.SetNoveltyChecker(stubNovelty{score: 0.85, nearest: "A prior review"})

	_ = svc.store.SaveClaims([]models.Claim{
		{ID: "c1", PaperID: "p1", Text: "Metformin increases survival.", Entities: []string{"[PRODUCT:Metformin]"}, SourceSnippet: "Metformin increases survival."},
		{ID: "c2", PaperID: "p2", Text: "Metformin decreases survival.", Entities: []string{"[PRODUCT:Metformin]"}, SourceSnippet: "Metformin decreases survival."},
	})
	_ = svc.store.SaveSignals([]models.ResearchSignal{
		{ID: "sig-1", Kind: models.ResearchSignalContradiction, Title: "Contradiction: Metformin increases survival vs Metformin decreases survival", ClaimIDs: []string{"c1", "c2"}, PaperIDs: []string{"p1", "p2"}},
	})

	candidates, err := svc.rebuildCandidates(context.Background())
	if err != nil {
		t.Fatalf("rebuildCandidates: %v", err)
	}
	if len(candidates) != 1 {
		t.Fatalf("want 1 candidate, got %d", len(candidates))
	}
	if candidates[0].NoveltyScore != 0.85 {
		t.Errorf("novelty score = %v, want 0.85", candidates[0].NoveltyScore)
	}
	if candidates[0].NearestWork != "A prior review" {
		t.Errorf("nearest work = %q", candidates[0].NearestWork)
	}
	// Novelty item should now be "yes" (score >= 0.6) after re-evaluation.
	item := findChecklistItem(candidates[0], "novelty")
	if item == nil || item.Answer != "yes" {
		t.Errorf("novelty checklist item should be 'yes' after scoring: %+v", item)
	}
}

func TestApplyChecklistReviews(t *testing.T) {
	candidate := models.CandidateHypothesis{
		ID:         "cand-r",
		SignalID:   "sig-1",
		Hypothesis: "Contradiction: increase vs decrease",
		State:      models.CandidateStateProposed,
	}
	// A reviewer committee answers; a couple are left out entirely.
	reviews := []models.ChecklistReviewItem{
		{ID: "precision", Answer: "yes", Reason: "effect sizes are quoted", Confidence: 0.9},
		{ID: "consistency", Answer: "unknown", Reason: "the two sources disagree; cannot judge"},
		{ID: "novelty", Answer: "unknown", Reason: "not enough evidence in paper text"},
	}

	applyChecklistReviews(&candidate, reviews, "Weak lead: no reported effect sizes and the two sources conflict.", "Two of three criteria unresolved - current evidence can't be approved yet.")

	if candidate.Rationale != "Weak lead: no reported effect sizes and the two sources conflict." {
		t.Errorf("rationale not applied: %q", candidate.Rationale)
	}
	if candidate.Summary != "Two of three criteria unresolved - current evidence can't be approved yet." {
		t.Errorf("summary not applied: %q", candidate.Summary)
	}

	if len(candidate.Checklist) != len(candidateChecklist) {
		t.Fatalf("checklist length = %d, want %d", len(candidate.Checklist), len(candidateChecklist))
	}
	precision := findChecklistItem(candidate, "precision")
	if precision == nil || precision.Answer != "yes" || precision.Reason != "effect sizes are quoted" {
		t.Errorf("precision review not applied: %+v", precision)
	}
	// A criterion with no review falls back to unknown.
	if item := findChecklistItem(candidate, "temporality"); item == nil || item.Answer != "unknown" {
		t.Errorf("unanswered criterion should be unknown: %+v", item)
	}
	if candidate.Verdict != models.CandidateVerdictDisputed {
		t.Errorf("verdict should be disputed (unknown present), got %q", candidate.Verdict)
	}
}

func TestNoveltyScoreFromCount(t *testing.T) {
	cases := map[int]float32{0: 0.9, 1: 0.7, 3: 0.55, 8: 0.4, 20: 0.25}
	for count, want := range cases {
		if got := noveltyScoreFromCount(count); got != want {
			t.Errorf("noveltyScoreFromCount(%d) = %v, want %v", count, got, want)
		}
	}
}

func findChecklistItem(candidate models.CandidateHypothesis, id string) *models.ChecklistItem {
	for i := range candidate.Checklist {
		if candidate.Checklist[i].ID == id {
			return &candidate.Checklist[i]
		}
	}
	return nil
}
