package brain

import (
	"testing"
)

func TestRemovePrefix(t *testing.T) {
	tests := []struct {
		name     string
		s        string
		prefix   string
		expected string
	}{
		{"existing prefix", "hello world", "hello ", "world"},
		{"non-existing prefix", "hello world", "hi", "hello world"},
		{"exact match", "hello", "hello", ""},
		{"empty string", "", "a", ""},
		{"empty prefix", "abc", "", "abc"},
		{"prefix longer than string", "a", "abc", "a"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := removePrefix(tt.s, tt.prefix)
			if result != tt.expected {
				t.Errorf("removePrefix(%q, %q) = %q; want %q", tt.s, tt.prefix, result, tt.expected)
			}
		})
	}
}

func TestRemoveSuffix(t *testing.T) {
	tests := []struct {
		name     string
		s        string
		suffix   string
		expected string
	}{
		{"existing suffix", "hello world", " world", "hello"},
		{"non-existing suffix", "hello world", "hi", "hello world"},
		{"exact match", "hello", "hello", ""},
		{"empty string", "", "a", ""},
		{"empty suffix", "abc", "", "abc"},
		{"suffix longer than string", "a", "abc", "a"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := removeSuffix(tt.s, tt.suffix)
			if result != tt.expected {
				t.Errorf("removeSuffix(%q, %q) = %q; want %q", tt.s, tt.suffix, result, tt.expected)
			}
		})
	}
}

func TestCleanMarkdownJSON(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected string
	}{
		{
			name:     "wrapped with json",
			content:  "```json\n{\"key\": \"val\"}\n```",
			expected: "{\"key\": \"val\"}",
		},
		{
			name:     "wrapped without language",
			content:  "```\n{\"key\": \"val\"}\n```",
			expected: "{\"key\": \"val\"}",
		},
		{
			name:     "not wrapped",
			content:  "{\"key\": \"val\"}",
			expected: "{\"key\": \"val\"}",
		},
		{
			name:     "multiline inside",
			content:  "```json\n{\n  \"key\": \"val\"\n}\n```",
			expected: "{\n  \"key\": \"val\"\n}",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := cleanMarkdownJSON(tt.content)
			if result != tt.expected {
				t.Errorf("cleanMarkdownJSON(%q) = %q; want %q", tt.content, result, tt.expected)
			}
		})
	}
}

func TestExtractJSONObject(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		expected    string
		expectError bool
	}{
		{
			name:        "clean json",
			content:     "{\"a\": 1}",
			expected:    "{\"a\": 1}",
			expectError: false,
		},
		{
			name:        "surrounding text",
			content:     "Here is the JSON: {\"a\": 1} hope it helps!",
			expected:    "{\"a\": 1}",
			expectError: false,
		},
		{
			name:        "nested braces",
			content:     "Text {\"outer\": {\"inner\": 1}} more text",
			expected:    "{\"outer\": {\"inner\": 1}}",
			expectError: false,
		},
		{
			name:        "broken braces",
			content:     "Text {\"a\": 1 more text",
			expected:    "",
			expectError: true,
		},
		{
			name:        "no braces",
			content:     "just some text",
			expected:    "",
			expectError: true,
		},
		{
			name:        "multiple top level (picks first)",
			content:     "First {\"a\": 1} second {\"b\": 2}",
			expected:    "{\"a\": 1}",
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := extractJSONObject(tt.content)
			if (err != nil) != tt.expectError {
				t.Errorf("extractJSONObject(%q) error = %v; expectError %v", tt.content, err, tt.expectError)
				return
			}
			if result != tt.expected {
				t.Errorf("extractJSONObject(%q) = %q; want %q", tt.content, result, tt.expected)
			}
		})
	}
}
