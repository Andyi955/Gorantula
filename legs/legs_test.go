package legs

import (
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/PuerkitoBio/goquery"
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

func TestExtractCandidateImageURLs(t *testing.T) {
	markup := `
		<html>
			<head>
				<meta property="og:image" content="/images/hero.jpg" />
				<meta name="twitter:image" content="https://cdn.example.com/social-card.png" />
			</head>
			<body>
				<article>
					<img src="/images/hero.jpg" />
					<img src="https://cdn.example.com/logo.png" />
					<img data-src="/media/evidence-map.webp" />
				</article>
			</body>
		</html>
	`
	document, err := goquery.NewDocumentFromReader(strings.NewReader(markup))
	if err != nil {
		t.Fatalf("failed to build document: %v", err)
	}

	results := extractCandidateImageURLs(document, "https://example.com/story")
	expectedSet := map[string]bool{
		"https://example.com/images/hero.jpg":         false,
		"https://cdn.example.com/social-card.png":     false,
		"https://example.com/media/evidence-map.webp": false,
	}

	if len(results) != len(expectedSet) {
		t.Fatalf("extractCandidateImageURLs() returned %d results; want %d", len(results), len(expectedSet))
	}

	for _, result := range results {
		if _, ok := expectedSet[result]; !ok {
			t.Fatalf("unexpected candidate image url %q", result)
		}
		expectedSet[result] = true
	}

	for candidate, seen := range expectedSet {
		if !seen {
			t.Fatalf("expected candidate %q to be present", candidate)
		}
	}
}

func TestIsLikelyEvidenceImageURL(t *testing.T) {
	if isLikelyEvidenceImageURL("https://example.com/assets/logo.png") {
		t.Fatalf("logo image should be filtered out")
	}

	if !isLikelyEvidenceImageURL("https://example.com/images/evidence-board.jpg") {
		t.Fatalf("article image should be accepted")
	}
}

func TestLegSourceCountDefaultsAndClamps(t *testing.T) {
	original := os.Getenv("GORANTULA_LEG_SOURCES")
	defer os.Setenv("GORANTULA_LEG_SOURCES", original)

	os.Unsetenv("GORANTULA_LEG_SOURCES")
	if got := legSourceCount(); got != 4 {
		t.Fatalf("expected default leg source count 4, got %d", got)
	}

	os.Setenv("GORANTULA_LEG_SOURCES", "6")
	if got := legSourceCount(); got != 6 {
		t.Fatalf("expected env override 6, got %d", got)
	}

	os.Setenv("GORANTULA_LEG_SOURCES", "99")
	if got := legSourceCount(); got != 8 {
		t.Fatalf("expected clamp to 8, got %d", got)
	}

	os.Setenv("GORANTULA_LEG_SOURCES", "not-a-number")
	if got := legSourceCount(); got != 4 {
		t.Fatalf("expected fallback to 4 for garbage input, got %d", got)
	}
}

func TestExtractLegParagraphsPrefersSemanticContainers(t *testing.T) {
	long := func(text string) string {
		return text + strings.Repeat(" filler words to pass the quality threshold.", 2)
	}
	markup := `<html><body>
		<nav><p>` + long("Boilerplate navigation paragraph that should never be included.") + `</p></nav>
		<article>
			<p>` + long("First real article paragraph about the investigation subject.") + `</p>
			<p>` + long("Second real article paragraph with more detail.") + `</p>
			<p>` + long("First real article paragraph about the investigation subject.") + `</p>
		</article>
	</body></html>`

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(markup))
	if err != nil {
		t.Fatalf("failed to build document: %v", err)
	}

	texts := extractLegParagraphs(doc)
	if len(texts) != 2 {
		t.Fatalf("expected 2 deduplicated container paragraphs, got %d: %v", len(texts), texts)
	}
	for _, text := range texts {
		if strings.Contains(text, "Boilerplate navigation") {
			t.Fatalf("boilerplate paragraph leaked into container extraction: %q", text)
		}
	}
}

func TestExtractLegParagraphsFallsBackToWholeDocument(t *testing.T) {
	long := func(text string) string {
		return text + strings.Repeat(" filler words to pass the quality threshold.", 2)
	}
	markup := `<html><body>
		<div>
			<p>` + long("Paragraph one without any semantic container present.") + `</p>
			<p>` + long("Paragraph two also living directly in the body.") + `</p>
		</div>
	</body></html>`

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(markup))
	if err != nil {
		t.Fatalf("failed to build document: %v", err)
	}

	texts := extractLegParagraphs(doc)
	if len(texts) != 2 {
		t.Fatalf("expected 2 fallback paragraphs, got %d: %v", len(texts), texts)
	}
}
