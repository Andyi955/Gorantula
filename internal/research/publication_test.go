package research

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func publicationFixture(t *testing.T) (*Service, models.PublicationDraft) {
	t.Helper()
	s, req := verificationFixture(t)
	run, e := s.StartVerification(req)
	if e != nil {
		t.Fatal(e)
	}
	run = awaitVerification(t, s, run.ID)
	paper := models.Paper{ID: "p", Title: "Synthetic fixture", FullText: "Independent synthetic observations for software testing.", License: "test fixture"}
	claim := models.Claim{ID: "claim", PaperID: "p", Text: "Synthetic observations", SourceSnippet: paper.FullText}
	if e = s.store.SavePapers([]models.Paper{paper}); e != nil {
		t.Fatal(e)
	}
	if e = s.store.SaveClaims([]models.Claim{claim}); e != nil {
		t.Fatal(e)
	}
	run.Papers = []models.Paper{paper}
	run.Claims = []models.Claim{claim}
	if e = s.saveVerificationRun(run); e != nil {
		t.Fatal(e)
	}
	d, e := s.PreparePublication(context.Background(), run.ID)
	if e != nil {
		t.Fatal(e)
	}
	return s, d
}
func testFigurePNG(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if e := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 2, 2))); e != nil {
		t.Fatal(e)
	}
	return b.Bytes()
}
func attachPublicationFigures(t *testing.T, s *Service, d models.PublicationDraft) models.PublicationDraft {
	t.Helper()
	for _, f := range d.Figures {
		var e error
		d, e = s.PublicationAction(context.Background(), d.ID, d.Revision, "figure", "reviewer", "Fixture image", f.ID, testFigurePNG(t))
		if e != nil {
			t.Fatal(e)
		}
	}
	return d
}
func TestPublicationApprovalAndReplayExport(t *testing.T) {
	s, d := publicationFixture(t)
	ctx := context.Background()
	if _, e := s.PublicationAction(ctx, d.ID, d.Revision, "export", "reviewer", "Share", "", nil); e == nil {
		t.Fatal("unapproved export")
	}
	for _, f := range d.Figures {
		cfg, err := png.DecodeConfig(bytes.NewReader(f.PNG))
		if err != nil || cfg.Width != 1100 || f.ImageDigest != digestBytes(f.PNG) {
			t.Fatal("automatic figure missing or invalid")
		}
	}
	original := d.Revision
	d = attachPublicationFigures(t, s, d)
	if original == d.Revision {
		t.Fatal("figure did not change revision")
	}
	if _, e := s.PublicationAction(ctx, d.ID, original, "approve", "reviewer", "Reviewed", "", nil); e == nil {
		t.Fatal("stale revision accepted")
	}
	var e error
	d, e = s.PublicationAction(ctx, d.ID, d.Revision, "approve", "reviewer", "Reviewed all artifacts", "", nil)
	if e != nil {
		t.Fatal(e)
	}
	if d.EvidenceStatus != "inconclusive" || d.Run.Results[0].Verdict != "inconclusive" {
		t.Fatal("approval promoted scientific support")
	}
	d, e = s.PublicationAction(ctx, d.ID, d.Revision, "export", "reviewer", "Share local package", "", nil)
	if e != nil {
		t.Fatal(e)
	}
	if d.Status != "exported" || len(d.Audit) != len(d.Figures)+2 {
		t.Fatal("audit missing")
	}
	raw, e := os.ReadFile(filepath.Join(d.ExportPath, "evidence.json"))
	if e != nil {
		t.Fatal(e)
	}
	var bundle models.VerificationRun
	if e = json.Unmarshal(raw, &bundle); e != nil {
		t.Fatal(e)
	}
	if bundle.Papers[0].FullText != "" || len(bundle.Documents) != 0 {
		t.Fatal("full source exported")
	}
	replay, e := ReplayVerificationBundle(ctx, bundle)
	if e != nil {
		t.Fatal(e)
	}
	for i := range replay {
		if replay[i].OutputDigest != bundle.Results[i].OutputDigest {
			t.Fatal("export replay mismatch")
		}
	}
	var manifest struct {
		Files map[string]string `json:"files"`
	}
	raw, e = os.ReadFile(filepath.Join(d.ExportPath, "manifest.json"))
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(raw, &manifest); e != nil {
		t.Fatal(e)
	}
	for file, digest := range manifest.Files {
		data, e := os.ReadFile(filepath.Join(d.ExportPath, file))
		if e != nil || digestBytes(data) != digest {
			t.Fatal("manifest mismatch", file, e)
		}
	}
	readme, e := os.ReadFile(filepath.Join(d.ExportPath, "REPRODUCE.md"))
	if e != nil {
		t.Fatal(e)
	}
	for _, want := range []string{bundle.ToolVersion, bundle.ImplementationDigest, bundle.Runtime, "research-replay", "matches"} {
		if !strings.Contains(string(readme), want) {
			t.Fatalf("REPRODUCE.md missing %q", want)
		}
	}
	if !strings.Contains(string(readme), "not independent replication") || !strings.Contains(string(readme), "does not establish causation") {
		t.Fatal("REPRODUCE.md must state its honest limits")
	}
	d, e = s.PublicationAction(ctx, d.ID, d.Revision, "withdraw", "reviewer", "New objection", "", nil)
	if e != nil || d.Status != "withdrawn" {
		t.Fatal(e)
	}
	if _, e = os.Stat(d.ExportPath); e != nil {
		t.Fatal("withdrawal erased history")
	}
}
func TestPublicationEvidenceChangeAndRejection(t *testing.T) {
	s, d := publicationFixture(t)
	d = attachPublicationFigures(t, s, d)
	ctx := context.Background()
	d, e := s.PublicationAction(ctx, d.ID, d.Revision, "approve", "reviewer", "Reviewed", "", nil)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.store.SaveClaims([]models.Claim{{ID: "new", Text: "New evidence"}}); e != nil {
		t.Fatal(e)
	}
	got, e := s.GetPublication(d.ID)
	if e != nil || !got.Stale {
		t.Fatal("not stale", e)
	}
	if _, e = s.PublicationAction(ctx, d.ID, d.Revision, "export", "reviewer", "Share", "", nil); e == nil {
		t.Fatal("stale evidence exported")
	}
	got, e = s.PublicationAction(ctx, d.ID, d.Revision, "reject", "reviewer", "Evidence changed", "", nil)
	if e != nil || got.Status != "rejected" {
		t.Fatal(e)
	}
	if _, e = s.PublicationAction(ctx, d.ID, d.Revision, "approve", "reviewer", "Override", "", nil); e == nil {
		t.Fatal("rejected revision approved")
	}
}
func TestPublicationAPIBoundaries(t *testing.T) {
	s, d := publicationFixture(t)
	for _, tc := range []struct {
		origin, body string
		want         int
	}{{"https://evil.example", `{}`, 403}, {"", `{"runId":"x","approve":true}`, 400}} {
		r := httptest.NewRequest(http.MethodPost, "/api/research/publications", strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		HandleAPI(w, r, s)
		if w.Code != tc.want {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if _, e := s.GetPublication("../escape"); e == nil {
		t.Fatal("path accepted")
	}
	if _, e := s.PublicationAction(context.Background(), d.ID, d.Revision, "figure", "reviewer", "Attach", d.Figures[0].ID, []byte("not PNG")); e == nil {
		t.Fatal("invalid image accepted")
	}
	d.Markdown += "tamper"
	if e := s.publicationStore().saveSlice(d.ID+".json", d); e != nil {
		t.Fatal(e)
	}
	if _, e := s.GetPublication(d.ID); e == nil {
		t.Fatal("tampered paper accepted")
	}
}

func TestCandidateEvidenceDoesNotDefaultToCorpus(t *testing.T) {
	claims := []models.Claim{{ID: "unrelated", PaperID: "other"}, {ID: "selected", PaperID: "paper"}}
	papers := []models.Paper{{ID: "other"}, {ID: "paper"}}
	candidate := models.CandidateHypothesis{PaperIDs: []string{"paper"}}
	if len(claimsForCandidate(claims, candidate)) != 0 {
		t.Fatal("empty selection leaked corpus claims")
	}
	candidate.ClaimIDs = []string{"selected"}
	if got := claimsForCandidate(claims, candidate); len(got) != 1 || got[0].ID != "selected" {
		t.Fatal("wrong claim scope")
	}
	if got := papersForCandidate(candidate, papers); len(got) != 1 || got[0].ID != "paper" {
		t.Fatal("wrong paper scope")
	}
	candidate.PaperIDs = nil
	if len(papersForCandidate(candidate, papers)) != 0 {
		t.Fatal("empty selection leaked corpus papers")
	}
}

func TestPublicationFlagsHistoricalUnrelatedClaims(t *testing.T) {
	s, d := publicationFixture(t)
	unrelated := models.Claim{ID: "unrelated", PaperID: "other", Text: "Unrelated corpus claim"}
	d.Claims = append(d.Claims, unrelated)
	d.Run.Claims = append(d.Run.Claims, unrelated)
	d.Markdown = writePublication(d)
	d.Revision = publicationRevision(d)
	if err := s.savePublication(d); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.GetPublication(d.ID)
	if err != nil || len(loaded.ReviewIssues) == 0 {
		t.Fatalf("historical issue missing: %v", err)
	}
	if loaded.Markdown != d.Markdown || loaded.Revision != d.Revision {
		t.Fatal("historical content rewritten")
	}
	for _, action := range []string{"approve", "export"} {
		if _, err := s.PublicationAction(context.Background(), d.ID, d.Revision, action, "reviewer", "Reviewed", "", nil); err == nil || !strings.Contains(err.Error(), "not selected") {
			t.Fatalf("%s did not block unrelated evidence: %v", action, err)
		}
	}
	if err := s.saveVerificationRun(d.Run); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PreparePublication(context.Background(), d.Run.ID); err == nil || !strings.Contains(err.Error(), "not selected") {
		t.Fatalf("old run accepted: %v", err)
	}
}

func TestPublicationGeneratedFigureDeterministic(t *testing.T) {
	f := models.PublicationFigure{Title: "Known means", Data: []models.VerificationGroup{{Name: "negative", Count: 2, Mean: -2}, {Name: "positive", Count: 2, Mean: 8}}, Metrics: map[string]float64{"difference": 10}}
	a, err := publicationFigurePNG(f)
	if err != nil {
		t.Fatal(err)
	}
	b, err := publicationFigurePNG(f)
	if err != nil || !bytes.Equal(a, b) {
		t.Fatal("figure is not deterministic")
	}
	decoded, err := png.Decode(bytes.NewReader(a))
	if err != nil {
		t.Fatal(err)
	}
	// Known negative and positive means must occupy opposite sides of zero.
	for _, point := range []image.Point{{620, 120}, {700, 180}} {
		r, g, _, _ := decoded.At(point.X, point.Y).RGBA()
		if g <= r {
			t.Fatal("expected cyan bar at", point)
		}
	}
}
func TestPublicationMissingFigureStillBlocksApproval(t *testing.T) {
	s, d := publicationFixture(t)
	d.Figures[0].PNG = nil
	d.Figures[0].ImageDigest = ""
	d.Revision = publicationRevision(d)
	if err := s.savePublication(d); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PublicationAction(context.Background(), d.ID, d.Revision, "approve", "reviewer", "Share", "", nil); err == nil {
		t.Fatal("missing image approved")
	}
}
