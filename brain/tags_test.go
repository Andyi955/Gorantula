package brain

import (
	"testing"
)

func TestSanitizeTag(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Normal tag",
			input:    "FUNDS",
			expected: "FUNDS",
		},
		{
			name:     "Lowercase tag is uppercased",
			input:    "corroborates",
			expected: "CORROBORATES",
		},
		{
			name:     "Spaces converted to underscores",
			input:    "WORKS FOR",
			expected: "WORKS_FOR",
		},
		{
			name:     "Hyphens converted to underscores",
			input:    "CO-FOUNDER",
			expected: "CO_FOUNDER",
		},
		{
			name:     "Strip punctuation",
			input:    "HE SAID... WOW!",
			expected: "HE_SAID_WOW",
		},
		{
			name:     "Empty tags default to RELATED",
			input:    "",
			expected: "RELATED",
		},
		{
			name:     "Whitespace only tags default to RELATED",
			input:    "   \t \n",
			expected: "RELATED",
		},
		{
			name:     "Meaningful forensic tags fit up to 32 chars",
			input:    "QUANTUM_ECOSYSTEM_TEXT_DUPLICATE",
			expected: "QUANTUM_ECOSYSTEM_TEXT_DUPLICATE",
		},
		{
			name:     "Extremely long tags are truncated to 32 chars",
			input:    "THIS_IS_A_VERY_LONG_TAG_THAT_SHOULD_BE_CUT_OFF_HELLO",
			expected: "THIS_IS_A_VERY_LONG_TAG_THAT_SHO",
		},
		{
			name:     "Punctuation only ends up empty and defaults",
			input:    "???!!!",
			expected: "RELATED",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := SanitizeTag(tc.input)
			if result != tc.expected {
				t.Errorf("SanitizeTag(%q) = %q; want %q", tc.input, result, tc.expected)
			}
		})
	}
}
