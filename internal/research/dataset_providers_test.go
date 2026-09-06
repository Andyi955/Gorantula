package research

import (
	"context"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

const zenodoFixture = `{
  "hits": {
    "total": 2,
    "hits": [
      {
        "id": 1,
        "metadata": {"title": "Metformin lifespan meta-analysis", "description": "Recorded survival measurements across treatment groups."},
        "files": [
          {"key": "README.md", "size": 724, "links": {"self": "https://zenodo.org/records/1/files/README.md/content"}},
          {"key": "analysis_data.csv", "size": 350000, "links": {"self": "https://zenodo.org/records/1/files/analysis_data.csv/content"}}
        ]
      },
      {
        "id": 2,
        "metadata": {"title": "Only a PDF", "description": "No tabular data."},
        "files": [{"key": "paper.pdf", "size": 99, "links": {"self": "https://zenodo.org/records/2/files/paper.pdf/content"}}]
      }
    ]
  }
}`

func TestSearchOpenDataFiltersToCSV(t *testing.T) {
	original := openDataFetch
	defer func() { openDataFetch = original }()
	openDataFetch = func(_ context.Context, _ string, _ int64) ([]byte, string, error) {
		return []byte(zenodoFixture), "", nil
	}
	got, err := searchOpenData(context.Background(), "metformin lifespan")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 CSV-bearing candidate, got %d (%+v)", len(got), got)
	}
	d := got[0]
	if d.Name != "Metformin lifespan meta-analysis" || d.Provider != "Zenodo" || d.File != "analysis_data.csv" || d.Size != 350000 {
		t.Fatalf("parsed candidate = %+v", d)
	}
	if d.DownloadURL != "https://zenodo.org/records/1/files/analysis_data.csv/content" {
		t.Fatalf("download url = %q", d.DownloadURL)
	}
}
func TestSearchOpenDataEmpty(t *testing.T) {
	original := openDataFetch
	defer func() { openDataFetch = original }()
	openDataFetch = func(_ context.Context, _ string, _ int64) ([]byte, string, error) {
		return []byte(`{"hits":{"total":0,"hits":[]}}`), "", nil
	}
	if got, err := searchOpenData(context.Background(), "no such topic"); err != nil || len(got) != 0 {
		t.Fatalf("want empty result, err=%v got=%+v", err, got)
	}
}
func TestSearchOpenDataQueryRequired(t *testing.T) {
	if _, err := searchOpenData(context.Background(), "   "); err == nil {
		t.Fatal("expected query-required error")
	}
}

func TestDatasetSearchToolReturnsLinksAndSummary(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	original := openDataFetch
	defer func() { openDataFetch = original }()
	openDataFetch = func(_ context.Context, _ string, _ int64) ([]byte, string, error) {
		return []byte(zenodoFixture), "", nil
	}
	s.datasetFetch = func(_ context.Context, u string) ([]byte, string, error) {
		return []byte("group,value\ncontrol,10\ncontrol,12\ntreated,15\ntreated,17\n"), u, nil
	}
	run := models.VerificationRun{ID: strings.Repeat("e", 32)}
	out := s.executeDatasetCall(context.Background(), &run, models.DatasetCall{Tool: "dataset-search", Query: "metformin lifespan", Rationale: "Find data to verify against."})
	if out.Error != "" {
		t.Fatalf("dataset-search error: %s", out.Error)
	}
	if len(out.Links) != 1 || out.Links[0] != "https://zenodo.org/records/1/files/analysis_data.csv/content" {
		t.Fatalf("links = %+v", out.Links)
	}
	if !strings.Contains(out.Summary, "Metformin lifespan meta-analysis") || !strings.Contains(out.Summary, "Zenodo") {
		t.Fatalf("summary = %q", out.Summary)
	}
	// Persist the search so its links become import candidates, then import one.
	run.DatasetActions = append(run.DatasetActions, out)
	importOut := s.executeDatasetCall(context.Background(), &run, models.DatasetCall{Tool: "dataset-import", URL: out.Links[0]})
	if importOut.Error != "" || importOut.DatasetID == "" {
		t.Fatalf("import from search link should register a dataset: err=%s out=%+v", importOut.Error, importOut)
	}
	if run.Dataset.ID == "" {
		t.Fatalf("run dataset not selected: %+v", run.Dataset)
	}
}
