package research

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMeasureWordCoverage(t *testing.T) {
	hyp := wordSet("Metformin extends lifespan and reduces inflammation")
	cases := []struct {
		name string
		text string
		want float64
	}{
		{"all words present", "Metformin extends lifespan and reduces inflammation in mice.", 1.0},
		{"partial", "Metformin reduces inflammation.", 0.5},
		{"none", "Coffee improves alertness.", 0.0},
		{"empty hyp words", "", 0.0}, // wordSet("") -> empty -> coverage 0
		{"no overlap", "zzz qqq xyz", 0.0},
	}
	for _, tc := range cases {
		got := measureWordCoverage(hyp, tc.text)
		if got != tc.want {
			t.Errorf("%s: measureWordCoverage = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestMeasureWordCoverageEmptyHyp(t *testing.T) {
	// A hypothesis with no content words must never divide by zero.
	if got := measureWordCoverage(map[string]struct{}{}, "anything"); got != 0 {
		t.Errorf("measureWordCoverage(empty) = %v, want 0", got)
	}
}

func TestCleanHypothesisTerms(t *testing.T) {
	// Stops the verdict label ("Contradiction"), connectors, and duplicate words;
	// keeps the substantive content words.
	got := cleanHypothesisTerms("Contradiction: Metformin and Metformin reduce inflammation")
	want := []string{"metformin", "reduce", "inflammation"}
	if len(got) != len(want) {
		t.Fatalf("cleanHypothesisTerms length = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("cleanHypothesisTerms[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestNoveltyQueryIncludesEntitiesAndTerms(t *testing.T) {
	got := noveltyQuery("Metformin reduces inflammation", []string{"[PRODUCT:Metformin]"})
	for _, want := range []string{"Metformin", "reduces", "inflammation"} {
		if !containsSubstr(got, want) {
			t.Errorf("noveltyQuery %q missing %q", got, want)
		}
	}
}

func TestNoveltyQueryNoEntities(t *testing.T) {
	// No entity tags but a substantive hypothesis: fall back to the cleaned terms
	// rather than an empty query.
	got := strings.TrimSpace(noveltyQuery("metformin only", nil))
	if got != "metformin only" {
		t.Errorf("noveltyQuery(no entities) = %q, want clean content words", got)
	}
}

func nearMatchServer(t *testing.T, works []openAlexWork) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := openAlexResponse{Meta: struct {
			Count int `json:"count"`
		}{Count: len(works)}, Results: works}
		_ = json.NewEncoder(w).Encode(body)
	}))
}

func TestCheckNoveltyClaimSpecific(t *testing.T) {
	// Three works. Two share >50% of the hypothesis's content words (a
	// duplicated claim), one is irrelevant. So nearMatches = 2 -> low novelty.
	srv := nearMatchServer(t, []openAlexWork{
		{Title: "Metformin reduces inflammation in older adults", AbstractInvertedIndex: map[string][]int{
			"metformin": {0}, "reduces": {1}, "inflammation": {2}, "older": {3}, "adults": {4},
		}},
		{Title: "Metformin and inflammation: a trial", AbstractInvertedIndex: map[string][]int{
			"metformin": {0}, "inflammation": {2},
		}},
		{Title: "Coffee and alertness", AbstractInvertedIndex: map[string][]int{
			"coffee": {0}, "alertness": {1},
		}},
	})
	defer srv.Close()
	c := &OpenAlexNoveltyChecker{baseURL: srv.URL, client: srv.Client()}

	score, nearest, err := c.CheckNovelty(context.Background(), "Metformin reduces inflammation", nil)
	if err != nil {
		t.Fatalf("CheckNovelty error: %v", err)
	}
	if score != noveltyScoreFromCount(2) {
		t.Errorf("score = %v, want %v (2 near matches)", score, noveltyScoreFromCount(2))
	}
	if nearest != "Metformin reduces inflammation in older adults" {
		t.Errorf("nearest = %q, want first near-match title", nearest)
	}
}

func TestCheckNoveltyNoNearMatches(t *testing.T) {
	srv := nearMatchServer(t, []openAlexWork{
		{Title: "Coffee and alertness", AbstractInvertedIndex: map[string][]int{
			"coffee": {0}, "alertness": {1},
		}},
	})
	defer srv.Close()
	c := &OpenAlexNoveltyChecker{baseURL: srv.URL, client: srv.Client()}

	score, nearest, err := c.CheckNovelty(context.Background(), "Metformin reduces inflammation", nil)
	if err != nil {
		t.Fatalf("CheckNovelty error: %v", err)
	}
	if score != noveltyScoreFromCount(0) {
		t.Errorf("score = %v, want %v (0 near matches = novel)", score, noveltyScoreFromCount(0))
	}
	if nearest == "" {
		t.Errorf("nearest should fall back to the first result title")
	}
}

func containsSubstr(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
