package research

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Andyi955/Gorantula/models"
)

// Opt-in public-source integration check; ordinary tests are deterministic and offline.
func TestDOCXLiveSupplement(t *testing.T) {
	if os.Getenv("GORANTULA_TEST_LIVE_DOCX") != "1" {
		t.Skip("set GORANTULA_TEST_LIVE_DOCX=1 to test the observed public supplement")
	}
	u := "https://pmc.ncbi.nlm.nih.gov/articles/instance/7591485/bin/41598_2020_75471_MOESM1_ESM.docx"
	s := NewService(t.TempDir(), nil)
	run := models.VerificationRun{DatasetActions: []models.DatasetResult{{Links: []string{u}}}}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	out := s.executeDatasetCall(ctx, &run, models.DatasetCall{Tool: "paper-docx", URL: u})
	if out.Error != "" || len(out.Passages) == 0 || len(out.Passages[0].Text) < 100 || len(run.Documents) != 1 {
		t.Fatalf("DOCX retrieval/extraction failed: %+v", out)
	}
	// This source contains figures, not tables: absence must not be reported as a table-reader failure.
	if out.Counts["tablesFound"] != 0 || out.Counts["tablesWithheld"] != 0 || out.Counts["embeddedFigures"] != 5 || len(out.Tables) != 0 {
		t.Fatalf("incorrect document classification: %+v", out.Counts)
	}
	foundCaption := false
	for _, passage := range out.Passages[1:] {
		if strings.Contains(passage.Text, "F3,266 = 2.37, p = 0.07") {
			foundCaption = true
		}
	}
	if !foundCaption {
		t.Fatal("figure 5 caption was not retained separately")
	}
	t.Logf("Retained %d bytes; extracted %d text bytes and %d rectangular tables; %d warnings", len(run.Documents[0].Bytes), len(out.Passages[0].Text), len(out.Tables), len(out.Warnings))
	for _, table := range out.Tables {
		t.Logf("Table %d: %d rows; first row: %v", table.Index, len(table.Rows), table.Rows[0])
	}
}
