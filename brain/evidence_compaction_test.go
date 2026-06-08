package brain

import (
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func TestFormatCompactEvidenceNodeKeepsIdentityAndBoundsFullText(t *testing.T) {
	fullText := "Summary sentence. " + strings.Repeat("Detailed evidence sentence with dates and entities. ", 40)
	formatted := formatCompactEvidenceNode(models.MemoryNode{
		ID:       "node-1",
		Title:    "Compact Node",
		Summary:  "Summary sentence.",
		FullText: fullText,
	}, 120)

	if !strings.Contains(formatted, "[NodeID: node-1]") || !strings.Contains(formatted, "Title: Compact Node") {
		t.Fatalf("compact evidence lost node identity: %s", formatted)
	}
	if !strings.Contains(formatted, "Summary: Summary sentence.") {
		t.Fatalf("compact evidence lost summary: %s", formatted)
	}
	if len(formatted) >= len(fullText) {
		t.Fatalf("compact evidence did not reduce prompt size: formatted=%d full=%d", len(formatted), len(fullText))
	}
	if !strings.Contains(formatted, "Evidence Excerpt:") {
		t.Fatalf("compact evidence should include a bounded excerpt: %s", formatted)
	}
}

func TestNodeSummaryConcurrencyDefaultAndClamp(t *testing.T) {
	if got := nodeSummaryConcurrency(); got != 8 {
		t.Fatalf("default node summary concurrency = %d, want 8", got)
	}

	t.Setenv("GORANTULA_NODE_SUMMARY_CONCURRENCY", "99")
	if got := nodeSummaryConcurrency(); got != 12 {
		t.Fatalf("node summary concurrency should clamp to 12, got %d", got)
	}
}
