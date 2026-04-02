package brain

import (
	"strings"
	"testing"

	"spider-agent/models"
)

func TestBuildPersonaFullTextExcerptOmitsEmptyOrRedundantText(t *testing.T) {
	if excerpt := buildPersonaFullTextExcerpt("Summary", ""); excerpt != "" {
		t.Fatalf("expected empty full text to omit excerpt, got %q", excerpt)
	}

	if excerpt := buildPersonaFullTextExcerpt("Repeated summary text", "Repeated summary text"); excerpt != "" {
		t.Fatalf("expected redundant full text to omit excerpt, got %q", excerpt)
	}
}

func TestBuildPersonaFullTextExcerptStripsSummaryPrefixAndTruncates(t *testing.T) {
	summary := "Compact summary of the evidence."
	fullText := summary + " " + strings.Repeat("detail ", 60)

	excerpt := buildPersonaFullTextExcerpt(summary, fullText)
	if excerpt == "" {
		t.Fatal("expected excerpt to be present")
	}
	if strings.Contains(excerpt, summary) {
		t.Fatalf("expected excerpt to omit the repeated summary prefix, got %q", excerpt)
	}
	if !strings.HasSuffix(excerpt, "...") {
		t.Fatalf("expected long excerpt to be truncated with ellipsis, got %q", excerpt)
	}
	if len([]rune(excerpt)) > personaFullTextExcerptLength+3 {
		t.Fatalf("expected excerpt to stay within the bounded length, got %d runes", len([]rune(excerpt)))
	}
}

func TestBuildSummaryFirstPersonaFindingsPreservesCoreFields(t *testing.T) {
	findings := buildSummaryFirstPersonaFindings([]models.MemoryNode{
		{
			ID:        "node-1",
			SourceURL: "https://example.com/report",
			Title:     "Example Title",
			Summary:   "Example summary.",
			FullText:  "Example summary. More detail appears here for the persona.",
		},
	})

	for _, expected := range []string{
		"[NodeID: node-1]",
		"Source: https://example.com/report",
		"Title: Example Title",
		"Summary: Example summary.",
		"Full Text Excerpt:",
	} {
		if !strings.Contains(findings, expected) {
			t.Fatalf("expected findings to contain %q, got %q", expected, findings)
		}
	}
	if strings.Contains(findings, "\nFull Text: ") {
		t.Fatalf("expected summary-first findings to avoid raw Full Text blocks, got %q", findings)
	}
}

func TestBuildSummaryFirstPersonaFindingsIncludesExcerptOnlyWhenNeeded(t *testing.T) {
	findings := buildSummaryFirstPersonaFindings([]models.MemoryNode{
		{
			ID:        "node-1",
			SourceURL: "https://example.com/one",
			Title:     "Redundant",
			Summary:   "Repeated summary.",
			FullText:  "Repeated summary.",
		},
		{
			ID:        "node-2",
			SourceURL: "https://example.com/two",
			Title:     "Fresh Detail",
			Summary:   "Compact summary.",
			FullText:  "Compact summary. A fresh detail follows in the original body.",
		},
	})

	if count := strings.Count(findings, "Full Text Excerpt:"); count != 1 {
		t.Fatalf("expected exactly one excerpt marker, got %d in %q", count, findings)
	}
}
