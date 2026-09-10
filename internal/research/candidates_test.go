package research

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestCandidateQueueExcludesRunScopedAndArchived(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	_ = svc.store.SaveCandidates([]models.CandidateHypothesis{
		{ID: "candidate-signal-1", State: models.CandidateStateReviewed},
		{ID: "candidate-signal-2", State: models.CandidateStateReviewed, Dismissed: true, DismissedAt: "2026-09-08T10:00:00Z"},
		{ID: "topic-run-1", State: models.CandidateStateProposed},
		{ID: "publication-trial", State: models.CandidateStateApproved},
	})

	queue, err := svc.ListCandidateQueue(false)
	if err != nil {
		t.Fatalf("ListCandidateQueue: %v", err)
	}
	ids := candidateIDs(queue)
	if len(ids) != 2 || !containsID(ids, "candidate-signal-1") || !containsID(ids, "publication-trial") {
		t.Fatalf("default queue = %v, want the two non-run candidates", ids)
	}
	if containsID(ids, "topic-run-1") {
		t.Errorf("run-scoped candidate leaked into the queue: %v", ids)
	}
	if containsID(ids, "candidate-signal-2") {
		t.Errorf("archived candidate leaked into the default queue: %v", ids)
	}

	withArchived, err := svc.ListCandidateQueue(true)
	if err != nil {
		t.Fatalf("ListCandidateQueue(includeDismissed): %v", err)
	}
	ids = candidateIDs(withArchived)
	if !containsID(ids, "candidate-signal-2") {
		t.Errorf("archived candidate missing when includeDismissed is set: %v", ids)
	}
	if containsID(ids, "topic-run-1") {
		t.Errorf("run-scoped candidate must stay out even with includeDismissed: %v", ids)
	}

	// A run-scoped candidate stays resolvable by id for its own run.
	all, err := svc.ListCandidates()
	if err != nil {
		t.Fatalf("ListCandidates: %v", err)
	}
	if !containsID(candidateIDs(all), "topic-run-1") {
		t.Errorf("run-scoped candidate must remain persisted: %v", candidateIDs(all))
	}
}

func TestCandidateDismissAndRestore(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	_ = svc.store.SaveCandidates([]models.CandidateHypothesis{{ID: "cand-a", State: models.CandidateStateReviewed}})

	dismissed, found, err := svc.DismissCandidate("cand-a")
	if err != nil || !found {
		t.Fatalf("DismissCandidate: %v found=%v", err, found)
	}
	if !dismissed.Dismissed || dismissed.DismissedAt == "" {
		t.Errorf("dismiss did not set marker/timestamp: %+v", dismissed)
	}

	// Dismissing twice keeps the original timestamp.
	again, _, err := svc.DismissCandidate("cand-a")
	if err != nil {
		t.Fatalf("second DismissCandidate: %v", err)
	}
	if again.DismissedAt != dismissed.DismissedAt {
		t.Errorf("re-dismiss changed the timestamp: %q then %q", dismissed.DismissedAt, again.DismissedAt)
	}

	restored, found, err := svc.RestoreCandidate("cand-a")
	if err != nil || !found {
		t.Fatalf("RestoreCandidate: %v found=%v", err, found)
	}
	if restored.Dismissed || restored.DismissedAt != "" {
		t.Errorf("restore did not clear the archive marker: %+v", restored)
	}

	if _, found, _ := svc.DismissCandidate("not-there"); found {
		t.Errorf("dismissing an unknown candidate should not report found")
	}
	if _, found, _ := svc.RestoreCandidate("not-there"); found {
		t.Errorf("restoring an unknown candidate should not report found")
	}
}

func candidateIDs(candidates []models.CandidateHypothesis) []string {
	ids := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		ids = append(ids, candidate.ID)
	}
	return ids
}

func containsID(ids []string, want string) bool {
	for _, id := range ids {
		if id == want {
			return true
		}
	}
	return false
}

func TestCandidateQueueAPIHidesRunScopedAndArchives(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	_ = svc.store.SaveCandidates([]models.CandidateHypothesis{
		{ID: "candidate-signal-1", State: models.CandidateStateReviewed},
		{ID: "topic-run-1", State: models.CandidateStateProposed},
	})

	call := func(method, path string) *httptest.ResponseRecorder {
		t.Helper()
		var r *http.Request
		if method == http.MethodPost {
			r = httptest.NewRequest(method, path, strings.NewReader("{}"))
			r.Header.Set("Content-Type", "application/json")
		} else {
			r = httptest.NewRequest(method, path, nil)
		}
		w := httptest.NewRecorder()
		HandleAPI(w, r, svc)
		return w
	}
	list := func(path string) []string {
		t.Helper()
		w := call(http.MethodGet, path)
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s: got %d: %s", path, w.Code, w.Body.String())
		}
		var candidates []models.CandidateHypothesis
		if err := json.Unmarshal(w.Body.Bytes(), &candidates); err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		return candidateIDs(candidates)
	}

	if ids := list("/api/research/candidates"); len(ids) != 1 || ids[0] != "candidate-signal-1" {
		t.Fatalf("queue = %v, want only the corpus candidate", ids)
	}

	if w := call(http.MethodPost, "/api/research/candidates/candidate-signal-1/dismiss"); w.Code != http.StatusOK {
		t.Fatalf("dismiss: got %d: %s", w.Code, w.Body.String())
	}
	if ids := list("/api/research/candidates"); len(ids) != 0 {
		t.Fatalf("archived candidate still listed: %v", ids)
	}
	if ids := list("/api/research/candidates?includeDismissed=1"); len(ids) != 1 {
		t.Fatalf("includeDismissed=1 = %v, want the archived candidate", ids)
	}

	if w := call(http.MethodPost, "/api/research/candidates/candidate-signal-1/restore"); w.Code != http.StatusOK {
		t.Fatalf("restore: got %d: %s", w.Code, w.Body.String())
	}
	if ids := list("/api/research/candidates"); len(ids) != 1 {
		t.Fatalf("restored candidate missing: %v", ids)
	}

	if w := call(http.MethodPost, "/api/research/candidates/not-there/dismiss"); w.Code != http.StatusNotFound {
		t.Errorf("dismiss unknown id: got %d, want 404", w.Code)
	}
	if w := call(http.MethodPost, "/api/research/candidates/not-there/restore"); w.Code != http.StatusNotFound {
		t.Errorf("restore unknown id: got %d, want 404", w.Code)
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
