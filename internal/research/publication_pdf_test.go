package research

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPublicationPDFPreviewAndExportManifest(t *testing.T) {
	s, d := publicationFixture(t)
	w := httptest.NewRecorder()
	HandleAPI(w, httptest.NewRequest(http.MethodGet, "/api/research/publications/"+d.ID+"/pdf", nil), s)
	if w.Code != 200 || w.Header().Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(w.Body.Bytes(), []byte("%PDF-")) {
		t.Fatalf("invalid preview: %d %s", w.Code, w.Body.String())
	}
	after, e := s.GetPublication(d.ID)
	if e != nil || after.Status != "draft" || len(after.Audit) != 0 {
		t.Fatal("preview changed approval")
	}
	d, e = s.PublicationAction(context.Background(), d.ID, d.Revision, "approve", "test operator", "Reviewed fixture", "", nil)
	if e != nil {
		t.Fatal(e)
	}
	d, e = s.PublicationAction(context.Background(), d.ID, d.Revision, "export", "test operator", "Export fixture", "", nil)
	if e != nil {
		t.Fatal(e)
	}
	raw, e := os.ReadFile(filepath.Join(d.ExportPath, "report.pdf"))
	if e != nil {
		t.Fatal(e)
	}
	var manifest struct {
		Files map[string]string `json:"files"`
	}
	m, _ := os.ReadFile(filepath.Join(d.ExportPath, "manifest.json"))
	if e = json.Unmarshal(m, &manifest); e != nil {
		t.Fatal(e)
	}
	if manifest.Files["report.pdf"] != digestBytes(raw) {
		t.Fatal("PDF missing from integrity manifest")
	}
	if !bytes.HasPrefix(raw, []byte("%PDF-")) {
		t.Fatal("export missing PDF")
	}
}
func TestPublicationPDFRejectsCorruptFigure(t *testing.T) {
	_, d := publicationFixture(t)
	d.Figures[0].PNG = []byte("bad")
	if _, e := publicationPDF(d); e == nil {
		t.Fatal("corrupt image silently omitted")
	}
}
