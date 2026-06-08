package brain

import (
	"fmt"
	"strings"

	"github.com/Andyi955/Gorantula/models"
)

const (
	relationshipEvidenceExcerptLength = 360
	discoveryEvidenceExcerptLength    = 420
	discoveryReviewExcerptLength      = 700
)

func formatCompactEvidenceNode(node models.MemoryNode, excerptLength int) string {
	normalizedTitle := normalizePersonaPromptWhitespace(node.Title)
	normalizedSummary := normalizePersonaPromptWhitespace(node.Summary)
	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("[NodeID: %s]\nTitle: %s\nSummary: %s\n", node.ID, normalizedTitle, normalizedSummary))
	if excerpt := buildCompactEvidenceExcerpt(normalizedSummary, node.FullText, excerptLength); excerpt != "" {
		builder.WriteString(fmt.Sprintf("Evidence Excerpt: %s\n", excerpt))
	}
	builder.WriteString("\n")
	return builder.String()
}

func buildCompactEvidenceExcerpt(summary string, fullText string, limit int) string {
	if limit <= 0 {
		limit = relationshipEvidenceExcerptLength
	}

	normalizedFullText := normalizePersonaPromptWhitespace(fullText)
	if normalizedFullText == "" {
		return ""
	}

	normalizedSummary := normalizePersonaPromptWhitespace(summary)
	detailsOnly := normalizedFullText
	if normalizedSummary != "" {
		switch {
		case strings.EqualFold(normalizedFullText, normalizedSummary):
			return ""
		case strings.HasPrefix(normalizedFullText, normalizedSummary):
			detailsOnly = strings.TrimSpace(normalizedFullText[len(normalizedSummary):])
			detailsOnly = strings.TrimLeft(detailsOnly, " .,:;|-")
		case strings.Contains(strings.ToLower(normalizedSummary), strings.ToLower(normalizedFullText)):
			return ""
		}
	}

	detailsRunes := []rune(normalizePersonaPromptWhitespace(detailsOnly))
	if len(detailsRunes) <= limit {
		return string(detailsRunes)
	}
	return strings.TrimSpace(string(detailsRunes[:limit])) + "..."
}
