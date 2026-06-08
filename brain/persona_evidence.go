package brain

import (
	"fmt"
	"strings"

	"github.com/Andyi955/Gorantula/models"
)

const personaFullTextExcerptLength = 220

// Persona fan-out is the dominant token cost on full-board runs, so we keep the shared evidence pack compact.
func buildSummaryFirstPersonaFindings(nodes []models.MemoryNode) string {
	var builder strings.Builder
	for _, node := range nodes {
		builder.WriteString(formatSummaryFirstPersonaNode(node))
	}
	return builder.String()
}

func formatSummaryFirstPersonaNode(node models.MemoryNode) string {
	var builder strings.Builder
	normalizedTitle := normalizePersonaPromptWhitespace(node.Title)
	normalizedSummary := normalizePersonaPromptWhitespace(node.Summary)
	builder.WriteString(fmt.Sprintf("[NodeID: %s]\nSource: %s\nTitle: %s\nSummary: %s\n",
		node.ID, node.SourceURL, normalizedTitle, normalizedSummary))
	if excerpt := buildPersonaFullTextExcerpt(normalizedSummary, node.FullText); excerpt != "" {
		builder.WriteString(fmt.Sprintf("Full Text Excerpt: %s\n", excerpt))
	}
	builder.WriteString("\n")
	return builder.String()
}

func buildPersonaFullTextExcerpt(summary string, fullText string) string {
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

	detailsOnly = normalizePersonaPromptWhitespace(detailsOnly)
	if detailsOnly == "" || strings.EqualFold(detailsOnly, normalizedSummary) {
		return ""
	}

	detailsRunes := []rune(detailsOnly)
	if len(detailsRunes) <= personaFullTextExcerptLength {
		return detailsOnly
	}

	return strings.TrimSpace(string(detailsRunes[:personaFullTextExcerptLength])) + "..."
}

func normalizePersonaPromptWhitespace(text string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
}
