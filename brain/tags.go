package brain

import (
	"strings"
	"unicode"
)

const relationshipTagMaxLength = 32

// SanitizeTag enforces length limits, casing, and character restrictions
// for AI generated relationship tags.
func SanitizeTag(rawTag string) string {
	tag := strings.TrimSpace(rawTag)

	// Fallback for empty strings
	if tag == "" {
		return "RELATED"
	}

	// uppercase everything
	tag = strings.ToUpper(tag)

	// strip non-alphanumeric (keep underscores)
	var sb strings.Builder
	for _, r := range tag {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || r == '_' {
			sb.WriteRune(r)
		} else if r == ' ' || r == '-' {
			// convert spaces and hyphens to underscores for tag consistency
			sb.WriteRune('_')
		}
	}
	tag = sb.String()

	// Handle case where stripping everything left us with nothing
	if tag == "" {
		return "RELATED"
	}

	// truncate to a bounded length so labels stay readable without losing
	// the subject of content-specific forensic tags.
	if len(tag) > relationshipTagMaxLength {
		tag = tag[:relationshipTagMaxLength]
	}

	return tag
}
