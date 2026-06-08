package brain

import (
	"context"
	"reflect"
	"sync/atomic"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func setNodeSummaryResponse(target interface{}, title, summary string) {
	value := reflect.ValueOf(target)
	if value.Kind() != reflect.Ptr || value.IsNil() {
		return
	}
	element := value.Elem()
	if element.Kind() != reflect.Struct {
		return
	}
	titleField := element.FieldByName("Title")
	if titleField.IsValid() && titleField.CanSet() {
		titleField.SetString(title)
	}
	summaryField := element.FieldByName("Summary")
	if summaryField.IsValid() && summaryField.CanSet() {
		summaryField.SetString(summary)
	}
}

func TestSummarizeNodeReusesPersistentContentHashCache(t *testing.T) {
	cache := NewAnalysisCache(t.TempDir())
	content := "OpenAI released a safety report about new model evaluations."
	var calls int32
	provider := &MockProvider{
		NameFunc: func() string { return "mock-summary" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			atomic.AddInt32(&calls, 1)
			setNodeSummaryResponse(target, "OpenAI Safety Report", "[ORG:OpenAI] released a safety report about new model evaluations.")
			return nil
		},
	}

	brain := &Brain{
		ModelRouter:   map[string]ModelProvider{"mock-summary": provider},
		AnalysisCache: cache,
	}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock-summary")

	title, summary, err := brain.summarizeNode(context.Background(), content)
	if err != nil {
		t.Fatalf("first summarizeNode failed: %v", err)
	}
	if title != "OpenAI Safety Report" || summary == "" {
		t.Fatalf("unexpected first summary: title=%q summary=%q", title, summary)
	}

	secondProvider := &MockProvider{
		NameFunc: func() string { return "mock-summary" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			atomic.AddInt32(&calls, 1)
			setNodeSummaryResponse(target, "Should Not Be Used", "Should not be used.")
			return nil
		},
	}
	secondBrain := &Brain{
		ModelRouter:   map[string]ModelProvider{"mock-summary": secondProvider},
		AnalysisCache: cache,
	}

	cachedTitle, cachedSummary, err := secondBrain.summarizeNode(context.Background(), content)
	if err != nil {
		t.Fatalf("cached summarizeNode failed: %v", err)
	}
	if cachedTitle != title || cachedSummary != summary {
		t.Fatalf("expected cached summary to match first result, got title=%q summary=%q", cachedTitle, cachedSummary)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("expected provider to be called once across both summaries, got %d", got)
	}
}

func TestSummarizeNodeDoesNotReuseAcrossProviderIdentity(t *testing.T) {
	cache := NewAnalysisCache(t.TempDir())
	content := "DeepSeek announced a new model using domestic AI chips."
	var firstCalls int32
	firstProvider := &MockProvider{
		NameFunc: func() string { return "mock-provider-a" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			atomic.AddInt32(&firstCalls, 1)
			setNodeSummaryResponse(target, "Provider A", "[ORG:DeepSeek] announced a new model.")
			return nil
		},
	}
	firstBrain := &Brain{
		ModelRouter:   map[string]ModelProvider{"mock-provider-a": firstProvider},
		AnalysisCache: cache,
	}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock-provider-a")
	if _, _, err := firstBrain.summarizeNode(context.Background(), content); err != nil {
		t.Fatalf("first summarizeNode failed: %v", err)
	}

	var secondCalls int32
	secondProvider := &MockProvider{
		NameFunc: func() string { return "mock-provider-b" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			atomic.AddInt32(&secondCalls, 1)
			setNodeSummaryResponse(target, "Provider B", "[ORG:DeepSeek] announced a chip-linked model.")
			return nil
		},
	}
	secondBrain := &Brain{
		ModelRouter:   map[string]ModelProvider{"mock-provider-b": secondProvider},
		AnalysisCache: cache,
	}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock-provider-b")

	title, _, err := secondBrain.summarizeNode(context.Background(), content)
	if err != nil {
		t.Fatalf("second summarizeNode failed: %v", err)
	}
	if title != "Provider B" {
		t.Fatalf("expected provider-specific cache miss, got title %q", title)
	}
	if atomic.LoadInt32(&firstCalls) != 1 || atomic.LoadInt32(&secondCalls) != 1 {
		t.Fatalf("expected both providers to be called once, first=%d second=%d", firstCalls, secondCalls)
	}
}

func TestReviewScrapedImageCandidateReusesHashCacheForSameImageAndContext(t *testing.T) {
	cache := NewAnalysisCache(t.TempDir())
	var calls int32
	provider := &MockProvider{
		NameFunc: func() string { return "mock-image-review" },
		ReviewImageJSONFunc: func(ctx context.Context, prompt, mimeType string, imageData []byte, target interface{}) error {
			atomic.AddInt32(&calls, 1)
			review := target.(*models.ImageReviewResult)
			*review = models.ImageReviewResult{
				Keep:    true,
				Reason:  "Direct visual evidence.",
				Caption: "Evidence image",
			}
			return nil
		},
	}
	brain := &Brain{AnalysisCache: cache}
	candidate := downloadedRemoteNodeImage{
		fileName:  "evidence.png",
		sourceURL: "https://cdn.example.com/evidence.png",
		mimeType:  "image/png",
		payload:   []byte("same-image-bytes"),
	}

	first, err := brain.reviewScrapedImageCandidate(context.Background(), provider, "https://example.com/article", "Evidence", "Summary", "Full text", candidate)
	if err != nil {
		t.Fatalf("first image review failed: %v", err)
	}
	second, err := brain.reviewScrapedImageCandidate(context.Background(), provider, "https://example.com/article", "Evidence", "Summary", "Full text", candidate)
	if err != nil {
		t.Fatalf("second image review failed: %v", err)
	}

	if !first.Keep || second.Caption != "Evidence image" {
		t.Fatalf("unexpected cached reviews: first=%#v second=%#v", first, second)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("expected image provider to be called once, got %d", got)
	}
}

func TestReviewScrapedImageCandidateDoesNotReuseAcrossReviewContext(t *testing.T) {
	cache := NewAnalysisCache(t.TempDir())
	var calls int32
	provider := &MockProvider{
		NameFunc: func() string { return "mock-image-review" },
		ReviewImageJSONFunc: func(ctx context.Context, prompt, mimeType string, imageData []byte, target interface{}) error {
			call := atomic.AddInt32(&calls, 1)
			review := target.(*models.ImageReviewResult)
			*review = models.ImageReviewResult{
				Keep:    true,
				Reason:  "Context-specific evidence.",
				Caption: "Evidence image",
			}
			if call == 2 {
				review.Caption = "Different context"
			}
			return nil
		},
	}
	brain := &Brain{AnalysisCache: cache}
	candidate := downloadedRemoteNodeImage{
		fileName:  "evidence.png",
		sourceURL: "https://cdn.example.com/evidence.png",
		mimeType:  "image/png",
		payload:   []byte("same-image-bytes"),
	}

	if _, err := brain.reviewScrapedImageCandidate(context.Background(), provider, "https://example.com/article", "Evidence", "First summary", "Full text", candidate); err != nil {
		t.Fatalf("first image review failed: %v", err)
	}
	second, err := brain.reviewScrapedImageCandidate(context.Background(), provider, "https://example.com/article", "Evidence", "Second summary", "Full text", candidate)
	if err != nil {
		t.Fatalf("second image review failed: %v", err)
	}

	if second.Caption != "Different context" {
		t.Fatalf("expected context-specific cache miss, got %#v", second)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("expected image provider to be called for each review context, got %d", got)
	}
}
