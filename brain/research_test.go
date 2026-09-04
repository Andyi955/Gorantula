package brain

import (
	"context"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func TestExtractClaimsGroundsAndTags(t *testing.T) {
	abstract := "OpenAI released GPT-5 and trained it on large datasets. The model achieves 38% accuracy on a benchmark."

	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(_ context.Context, _ string, target interface{}) error {
			resp := target.(*models.ClaimExtractionResponse)
			resp.Claims = []models.Claim{
				{
					Text:       "OpenAI released GPT-5 and trained it on large datasets.",
					Kind:       "finding",
					Entities:   []string{"[ORG:OpenAI]", "[PRODUCT:GPT-5]", "[ORG:OpenAI]"},
					Confidence: 0.9,
				},
				{
					Text:       "The model achieves 38% accuracy on a benchmark.",
					Kind:       "statistic",
					Entities:   []string{"[PERCENT:38%]"},
					Confidence: 0.8,
				},
			}
			return nil
		},
	}

	b := &Brain{ModelRouter: map[string]ModelProvider{"mock": mock}}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	paper := models.Paper{ID: "arx-1", Title: "A paper", Abstract: abstract}
	claims, err := b.ExtractClaims(context.Background(), paper)
	if err != nil {
		t.Fatalf("ExtractClaims error: %v", err)
	}
	if len(claims) != 2 {
		t.Fatalf("want 2 claims, got %d", len(claims))
	}

	first := claims[0]
	if first.PaperID != "arx-1" {
		t.Errorf("PaperID = %q", first.PaperID)
	}
	if first.ID == "" {
		t.Errorf("claim id should be assigned")
	}
	if first.Provenance != "abstract" {
		t.Errorf("Provenance = %q", first.Provenance)
	}
	if len(first.Entities) != 2 {
		t.Errorf("entities should be deduped: got %d", len(first.Entities))
	}
	if first.SourceSnippet == "" || first.SourceOffset < 0 {
		t.Errorf("claim not grounded: snippet=%q offset=%d", first.SourceSnippet, first.SourceOffset)
	}
	if !strings.Contains(first.SourceSnippet, "OpenAI") {
		t.Errorf("snippet does not point at source: %q", first.SourceSnippet)
	}

	second := claims[1]
	if second.SourceSnippet == "" {
		t.Errorf("second claim should be grounded too")
	}
}

func TestGroundClaimTextExactAndFallback(t *testing.T) {
	source := "The model was trained on an enormous dataset of citations. It achieves state-of-the-art results."

	snippet, offset, ok := groundClaimText(source, "trained on an enormous dataset")
	if !ok {
		t.Fatalf("exact grounding failed")
	}
	if offset != strings.Index(source, "trained on an enormous dataset") {
		t.Errorf("offset = %d", offset)
	}
	if !strings.Contains(snippet, "trained on an enormous dataset") {
		t.Errorf("snippet = %q", snippet)
	}

	// Paraphrased claim falls back to a best-overlap sentence.
	paraphrased := "the system reached the best performance"
	_, _, ok = groundClaimText(source, paraphrased)
	if !ok {
		t.Fatalf("fallback grounding failed")
	}
}

func TestGroundClaimTextEmpty(t *testing.T) {
	if _, _, ok := groundClaimText("source", "   "); ok {
		t.Fatalf("empty claim should not ground")
	}
}

func TestSupplementEntityTags(t *testing.T) {
	text := "Treatment with Metformin improved survival by 42% in 2026, costing $2.4B."
	tags := supplementEntityTags(text)
	joined := strings.Join(tags, " ")
	for _, want := range []string{"[PRODUCT:Metformin]", "[PERCENT:42%]", "[DATE:2026]", "[MONEY:$2.4B]"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %s in %v", want, tags)
		}
	}
}

func TestMergeEntityTagsDedupesAndFilters(t *testing.T) {
	merged := mergeEntityTags(
		[]string{"[ORG:OpenAI]", "[PRODUCT:GPT-5]", "[ORG:OpenAI]", "[SAMPLE:junk]"},
		[]string{"[PRODUCT:gpt-5]"},
	)
	if len(merged) != 2 {
		t.Fatalf("expected 2 merged entity tags after dedupe/filter, got %+v", merged)
	}
	joined := strings.Join(merged, " ")
	if !strings.Contains(joined, "[ORG:OpenAI]") || !strings.Contains(joined, "[PRODUCT:GPT-5]") {
		t.Errorf("unexpected merge result: %+v", merged)
	}
}

func TestReviewCandidateChecklist(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(_ context.Context, _ string, target interface{}) error {
			resp := target.(*models.ChecklistReviewResponse)
			resp.Items = []models.ChecklistReviewItem{
				{ID: "precision", Answer: "yes", Reason: "effect size reported", Confidence: 0.9},
				{ID: "novelty", Answer: "unknown", Reason: "not enough evidence in the paper text", Confidence: 0.4},
			}
			return nil
		},
	}
	b := &Brain{ModelRouter: map[string]ModelProvider{"mock": mock}}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	items, err := b.ReviewCandidateChecklist(context.Background(), "Metformin improves survival", []models.Claim{
		{ID: "c1", Text: "Metformin improves survival.", Entities: []string{"[PRODUCT:Metformin]"}, SourceSnippet: "Metformin improves survival."},
	})
	if err != nil {
		t.Fatalf("ReviewCandidateChecklist: %v", err)
	}
	if len(items) != 2 || items[0].ID != "precision" || items[0].Answer != "yes" {
		t.Fatalf("unexpected review items: %+v", items)
	}
	if items[1].Answer != "unknown" {
		t.Errorf("expected unknown for under-evidenced criterion, got %q", items[1].Answer)
	}
}
