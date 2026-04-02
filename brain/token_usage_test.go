package brain

import (
	"context"
	"testing"
)

func TestRecordProviderTokenUsageUsesReportedCounts(t *testing.T) {
	brain := &Brain{}
	ctx := withTokenUsageTracking(context.Background(), "scope-reported", "persona_test")

	brain.recordProviderTokenUsage(ctx, "gemini", "GenerateJSON", "prompt", "completion", &llmTokenUsage{
		PromptTokens:     18,
		CompletionTokens: 7,
		TotalTokens:      25,
	})

	summary := brain.summarizeTokenUsageScope("scope-reported")
	if summary.CallCount != 1 {
		t.Fatalf("expected 1 tracked call, got %d", summary.CallCount)
	}
	if summary.ReportedCallCount != 1 || summary.EstimatedCallCount != 0 {
		t.Fatalf("expected only reported calls, got %#v", summary)
	}
	if summary.PromptTokens != 18 || summary.CompletionTokens != 7 || summary.TotalTokens != 25 {
		t.Fatalf("unexpected token totals: %#v", summary)
	}
}

func TestRecordProviderTokenUsageEstimatesWhenProviderUsageMissing(t *testing.T) {
	brain := &Brain{}
	ctx := withTokenUsageTracking(context.Background(), "scope-estimated", "persona_test")

	brain.recordProviderTokenUsage(ctx, "openai", "GenerateContent", "This is a prompt that should be estimated.", "Short response.", nil)

	summary := brain.summarizeTokenUsageScope("scope-estimated")
	if summary.CallCount != 1 {
		t.Fatalf("expected 1 tracked call, got %d", summary.CallCount)
	}
	if summary.EstimatedCallCount != 1 || summary.ReportedCallCount != 0 {
		t.Fatalf("expected only estimated usage, got %#v", summary)
	}
	if summary.PromptTokens == 0 || summary.CompletionTokens == 0 || summary.TotalTokens == 0 {
		t.Fatalf("expected estimated token counts to be non-zero, got %#v", summary)
	}
	if summary.TotalTokens != summary.PromptTokens+summary.CompletionTokens {
		t.Fatalf("expected total tokens to match prompt+completion, got %#v", summary)
	}
}
