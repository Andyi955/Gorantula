package legs

import (
	"reflect"
	"testing"
)

func TestExtractTopURLs(t *testing.T) {
	tests := []struct {
		name     string
		res      *SearchResponse
		limit    int
		expected []string
	}{
		{
			name: "limit 2, results 3",
			res: &SearchResponse{
				Web: struct {
					Results []struct {
						URL string `json:"url"`
					} `json:"results"`
				}{
					Results: []struct {
						URL string `json:"url"`
					}{
						{URL: "https://a.com"},
						{URL: "https://b.com"},
						{URL: "https://c.com"},
					},
				},
			},
			limit:    2,
			expected: []string{"https://a.com", "https://b.com"},
		},
		{
			name: "limit 5, results 2",
			res: &SearchResponse{
				Web: struct {
					Results []struct {
						URL string `json:"url"`
					} `json:"results"`
				}{
					Results: []struct {
						URL string `json:"url"`
					}{
						{URL: "https://a.com"},
						{URL: "https://b.com"},
					},
				},
			},
			limit:    5,
			expected: []string{"https://a.com", "https://b.com"},
		},
		{
			name:     "empty results",
			res:      &SearchResponse{},
			limit:    2,
			expected: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ExtractTopURLs(tt.res, tt.limit)
			if !reflect.DeepEqual(result, tt.expected) {
				t.Errorf("ExtractTopURLs() = %v; want %v", result, tt.expected)
			}
		})
	}
}

func TestTruncateContent(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		limit    int
		expected string
	}{
		{"exact limit", "abc", 3, "abc"},
		{"below limit", "abc", 5, "abc"},
		{"above limit", "abcdef", 3, "abc"},
		{"multibyte runes", "蜘蛛人", 2, "蜘蛛"},
		{"empty string", "", 5, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := TruncateContent(tt.content, tt.limit)
			if result != tt.expected {
				t.Errorf("TruncateContent() = %q; want %q", result, tt.expected)
			}
		})
	}
}
