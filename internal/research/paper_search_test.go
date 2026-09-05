package research

import (
	"context"
	"fmt"
	"github.com/Andyi955/Gorantula/models"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestLiveArxivSearch(t *testing.T) {
	if os.Getenv("GORANTULA_TEST_LIVE_PAPER_SEARCH") != "1" {
		t.Skip("opt-in live provider test")
	}
	p := &paperAPI{name: "arXiv", endpoint: "https://export.arxiv.org/api/query", client: &http.Client{Timeout: 12 * time.Second}}
	papers, err := p.Retrieve(context.Background(), "quantum entanglement", 3)
	if err != nil || len(papers) == 0 {
		t.Fatalf("arXiv returned no papers: %v", err)
	}
	for _, paper := range papers {
		if paper.Abstract == "" || !strings.Contains(paper.PublicationType, "preprint") {
			t.Fatal("missing evidence/label")
		}
		t.Log(paper.Title, paper.SourceURL)
	}
}

type paperRetrieverFunc func(context.Context, string, int) ([]models.Paper, error)

func (f paperRetrieverFunc) Retrieve(ctx context.Context, q string, n int) ([]models.Paper, error) {
	return f(ctx, q, n)
}

func TestPaperProviderParsers(t *testing.T) {
	for _, tc := range []struct{ name, body, title, kind string }{
		{"Crossref", `{"message":{"items":[{"DOI":"10.1234/a","title":["Soil study"],"abstract":"<jats:p>Soil retains <b>water</b>.</jats:p>","type":"journal-article"},{"DOI":"10.1234/b","title":["No abstract"]}]}}`, "Soil study", "journal-article"},
		{"Europe PMC", `{"resultList":{"result":[{"id":"1","source":"MED","pmcid":"PMC123","doi":"10.1234/a","title":"Soil study","abstractText":"<p>Soil retains water.</p>","pubTypeList":{"pubType":["Journal Article"]}},{"id":"2","title":"Withdrawn","abstractText":"Text","pubTypeList":{"pubType":["Retracted Publication"]}}]}}`, "Soil study", "Journal Article"},
		{"arXiv", `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2401.12345v1</id><title>Soil study</title><summary>Soil retains water.</summary><published>2024-01-01</published></entry></feed>`, "Soil study", "preprint (peer review not established)"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.Contains(r.URL.Query().Get("search_query"), "does") {
					t.Error("question scaffolding leaked into arXiv query")
				}
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			p := &paperAPI{name: tc.name, endpoint: server.URL, client: server.Client()}
			papers, err := p.Retrieve(context.Background(), "Does soil retain water?", 5)
			if err != nil || len(papers) != 1 || papers[0].Title != tc.title || papers[0].Abstract != "Soil retains water." || papers[0].PublicationType != tc.kind {
				t.Fatalf("%+v %v", papers, err)
			}
		})
	}
}

func TestSearchSurvivesQuotaDeduplicatesAndCaches(t *testing.T) {
	m := newMultiPaperSearch(nil)
	failed, good := 0, 0
	m.providers = []namedPaperProvider{
		{"quota", paperRetrieverFunc(func(context.Context, string, int) ([]models.Paper, error) {
			failed++
			return nil, paperAPIError{429, time.Hour}
		})},
		{"working", paperRetrieverFunc(func(context.Context, string, int) ([]models.Paper, error) {
			good++
			return []models.Paper{{ID: "a", Title: "Soil study", DOI: "10.1234/a", Abstract: "Soil water"}, {ID: "b", Title: "Other title same DOI", DOI: "10.1234/a", Abstract: "Soil water"}, {ID: "c", Title: "Title only"}}, nil
		})},
	}
	for i := 0; i < 2; i++ {
		papers, trace, err := m.RetrieveWithTrace(context.Background(), "soil water", 5)
		if err != nil || len(papers) != 1 || len(trace) != 2 || trace[0].Error == "" || trace[1].Cached != (i == 1) {
			t.Fatalf("%+v %+v %v", papers, trace, err)
		}
	}
	if failed != 1 || good != 1 {
		t.Fatalf("quota/caching failed: %d %d", failed, good)
	}
}

func TestSearchFailureAndCancellation(t *testing.T) {
	m := newMultiPaperSearch(nil)
	m.providers = []namedPaperProvider{{"empty", paperRetrieverFunc(func(context.Context, string, int) ([]models.Paper, error) { return nil, nil })}}
	if _, trace, err := m.RetrieveWithTrace(context.Background(), "soil", 5); err == nil || len(trace) != 1 {
		t.Fatal("empty search claimed success")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := m.RetrieveWithTrace(ctx, "soil", 5); err == nil {
		t.Fatal("cancelled search continued")
	}
}

func TestPaperAPIRespectsRetryAfterAndMalformedBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Header().Set("Retry-After", "300"); w.WriteHeader(429) }))
	defer server.Close()
	p := &paperAPI{name: "Crossref", endpoint: server.URL, client: server.Client()}
	_, err := p.Retrieve(context.Background(), "soil", 5)
	e, ok := err.(paperAPIError)
	if !ok || e.retry != 5*time.Minute {
		t.Fatalf("%v", err)
	}
}

func TestCrossrefSkipsRetractionMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"message":{"items":[{"DOI":"10.1234/retracted","title":["Original title"],"abstract":"Reported results.","update-to":[{"type":"retraction"}]},{"DOI":"10.1234/valid","title":["Research about retraction practices"],"abstract":"A legitimate literature study."}]}}`)
	}))
	defer server.Close()
	p := &paperAPI{name: "Crossref", endpoint: server.URL, client: server.Client()}
	papers, err := p.Retrieve(context.Background(), "retraction", 5)
	if err != nil || len(papers) != 1 || papers[0].DOI != "10.1234/valid" {
		t.Fatalf("%+v %v", papers, err)
	}
}

func TestMalformedArxivIsFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `<html>Try later</html>`) }))
	defer server.Close()
	p := &paperAPI{name: "arXiv", endpoint: server.URL, client: server.Client()}
	if _, err := p.Retrieve(context.Background(), "quantum", 5); err == nil {
		t.Fatal("HTML response accepted as an empty feed")
	}
}
