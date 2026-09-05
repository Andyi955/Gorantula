package research

import (
	"archive/zip"
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func docxFixture(t *testing.T, body string) []byte {
	t.Helper()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	w, _ := z.Create("word/document.xml")
	w.Write([]byte(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` + body + `</w:body></w:document>`))
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

const simpleDOCXTable = `<w:p><w:r><w:t>Measured moth visits.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>site</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>visits</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>12</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`

func TestDOCXExtractSaveAndValidate(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	u := "https://example.org/supplement.docx"
	data := docxFixture(t, simpleDOCXTable)
	s.datasetFetch = func(context.Context, string) ([]byte, string, error) { return data, u, nil }
	run := models.VerificationRun{PaperSources: []string{u}}
	out := s.executeDatasetCall(context.Background(), &run, models.DatasetCall{Tool: "paper-docx", URL: u})
	if out.Error != "" || len(out.Tables) != 1 || out.Tables[0].Rows[1][1] != "12" || !strings.Contains(out.Passages[0].Text, "Measured moth visits.") {
		t.Fatalf("%+v", out)
	}
	if len(run.Documents) != 1 || run.Documents[0].Digest != digestBytes(data) {
		t.Fatal("missing source snapshot")
	}
	run.DatasetActions = append(run.DatasetActions, out)
	call := availableTableSaves(run.DatasetActions)[0]
	call.Rationale = "Inspect measured visits; fixture provenance known."
	saved := s.executeDatasetCall(context.Background(), &run, call)
	if saved.Error != "" || run.Dataset.CSV != "site,visits\nA,12\nB,8\n" || saved.Counts["rows"] != 2 {
		t.Fatalf("%+v %+v", saved, run.Dataset)
	}
	call.ExtractionID = "wrong"
	if s.executeDatasetCall(context.Background(), &run, call).Error == "" {
		t.Fatal("accepted wrong digest")
	}
	if s.executeDatasetCall(context.Background(), &run, models.DatasetCall{Tool: "paper-docx", URL: "https://unobserved.org/a.docx"}).Error == "" {
		t.Fatal("accepted unobserved URL")
	}
}

func TestDOCXRejectsAmbiguousAndMalformed(t *testing.T) {
	for _, body := range []string{
		strings.Replace(simpleDOCXTable, "<w:tc>", `<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>`, 1),
		strings.Replace(simpleDOCXTable, "<w:tc>", "<w:tc><w:tbl></w:tbl>", 1),
		strings.Replace(simpleDOCXTable, "<w:tc>", "<w:tc><w:ins/>", 1),
	} {
		out, err := extractDOCX(docxFixture(t, body), "fixture")
		if err != nil || len(out.Tables) != 0 || len(out.Warnings) < 2 {
			t.Fatalf("%+v %v", out, err)
		}
	}
	for _, data := range [][]byte{[]byte("not a zip"), []byte("<html><title>Preparing to download</title></html>"), docxFixture(t, "<w:p>"), docxFixture(t, strings.Repeat("x", (8<<20)+1))} {
		if _, err := extractDOCX(data, "fixture"); err == nil {
			t.Fatal("accepted invalid/oversized input")
		}
	}
}

func TestDOCXFiguresAreNotFailedTables(t *testing.T) {
	data := docxFixture(t, `<w:p><w:r><w:drawing/></w:r></w:p><w:p><w:r><w:t>Figure S5: Group differences were not significant (p = 0.07).</w:t></w:r></w:p>`)
	out, err := extractDOCX(data, "fixture")
	if err != nil || out.Counts["embeddedFigures"] != 1 || out.Counts["tablesFound"] != 0 || out.Counts["tablesWithheld"] != 0 || !strings.Contains(out.Summary, "No Word tables found") || len(out.Tables) != 0 {
		t.Fatalf("%+v %v", out, err)
	}
	if len(out.Passages) != 2 || out.Passages[1].Text != "Figure S5: Group differences were not significant (p = 0.07)." {
		t.Fatal("caption missing or changed")
	}
	p := out.Passages[1]
	if out.Passages[0].Text[p.Offset:p.Offset+len(p.Text)] != p.Text {
		t.Fatal("caption source offset changed")
	}
}
