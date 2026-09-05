package research

import (
	"context"
	"os"
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
	t.Logf("Retained %d bytes; extracted %d text bytes and %d rectangular tables; %d warnings", len(run.Documents[0].Bytes), len(out.Passages[0].Text), len(out.Tables), len(out.Warnings))
	for _, table := range out.Tables {
		t.Logf("Table %d: %d rows; first row: %v", table.Index, len(table.Rows), table.Rows[0])
	}
}
