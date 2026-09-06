package research

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func TestPaperFullTextEndpointArxiv(t *testing.T) {
	p := models.Paper{ID: "arxiv-2405.00001", SourceURL: "https://arxiv.org/abs/2405.00001"}
	endpoint, ok := paperFullTextEndpoint(p)
	if !ok || endpoint != "https://arxiv.org/html/2405.00001" {
		t.Fatalf("arxiv endpoint = %q, %v", endpoint, ok)
	}
}
func TestPaperFullTextEndpointPMC(t *testing.T) {
	p := models.Paper{ID: "europepmc-MED-123", SourceURL: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9876543/"}
	endpoint, ok := paperFullTextEndpoint(p)
	if !ok || endpoint != "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/PMC9876543/fullTextXML" {
		t.Fatalf("pmc endpoint = %q, %v", endpoint, ok)
	}
}
func TestPaperFullTextEndpointNone(t *testing.T) {
	p := models.Paper{ID: "crossref-10.1/abc", DOI: "10.1/abc", SourceURL: "https://doi.org/10.1/abc"}
	if _, ok := paperFullTextEndpoint(p); ok {
		t.Fatal("crossref paper should have no open full-text endpoint")
	}
}

func TestExtractPMCID(t *testing.T) {
	cases := []struct {
		name  string
		paper models.Paper
		want  string
	}{
		{"from source url", models.Paper{SourceURL: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/"}, "PMC1234567"},
		{"none", models.Paper{SourceURL: "https://doi.org/10.1/x"}, ""},
	}
	for _, tc := range cases {
		got := extractPMCID(tc.paper)
		if got != tc.want {
			t.Errorf("%s: extractPMCID = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestExtractHTMLText(t *testing.T) {
	html := `<!doctype html><html><head><script>var x=1;</script><style>body{color:red}</style></head><body><article><h1>Title</h1><p>Metformin reduced inflammation by 42%.</p><script>alert('x')</script></article></body></html>`
	got := extractHTMLText([]byte(html))
	if !strings.Contains(got, "Metformin reduced inflammation by 42%.") {
		t.Fatalf("html text missing body: %q", got)
	}
	if strings.Contains(got, "alert('x')") || strings.Contains(got, "color:red") {
		t.Fatalf("html text leaked markup: %q", got)
	}
}

func TestExtractXMLBodyText(t *testing.T) {
	xml := `<article xmlns="http://jats.nlm.nih.gov"><front><article-title>Ignored</article-title></front><body><sec><p>Metformin reduced &amp; inflammation in &lt;5&gt; days.</p></sec></body></article>`
	got := extractXMLBodyText([]byte(xml))
	if !strings.Contains(got, "Metformin reduced & inflammation in <5> days.") {
		t.Fatalf("xml body text = %q", got)
	}
	if strings.Contains(got, "Ignored") {
		t.Fatalf("xml body text leaked front matter: %q", got)
	}
}

func TestFetchPaperFullTextUsesEndpointAndExtracts(t *testing.T) {
	original := paperFullTextFetch
	defer func() { paperFullTextFetch = original }()
	var requested string
	paperFullTextFetch = func(_ context.Context, raw string, _ int64) ([]byte, string, error) {
		requested = raw
		return []byte(`<!doctype html><html><body><article><p>Caffeine improved reaction time.</p></article></body></html>`), raw, nil
	}
	p := models.Paper{ID: "arxiv-2405.00001", SourceURL: "https://arxiv.org/abs/2405.00001"}
	text, err := fetchPaperFullText(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if requested != "https://arxiv.org/html/2405.00001" {
		t.Fatalf("requested %q", requested)
	}
	if !strings.Contains(text, "Caffeine improved reaction time.") {
		t.Fatalf("text = %q", text)
	}
}
func TestFetchPaperFullTextNoEndpoint(t *testing.T) {
	p := models.Paper{ID: "crossref-10.1/x", SourceURL: "https://doi.org/10.1/x"}
	if _, err := fetchPaperFullText(context.Background(), p); err == nil {
		t.Fatal("expected error for paper with no open full-text endpoint")
	}
}
func TestFetchPaperFullTextFetchError(t *testing.T) {
	original := paperFullTextFetch
	defer func() { paperFullTextFetch = original }()
	paperFullTextFetch = func(_ context.Context, _ string, _ int64) ([]byte, string, error) {
		return nil, "", errors.New("http 403")
	}
	p := models.Paper{ID: "arxiv-2405.00001", SourceURL: "https://arxiv.org/abs/2405.00001"}
	if _, err := fetchPaperFullText(context.Background(), p); err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("err = %v", err)
	}
}
