package research

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func TestStoreRoundTrip(t *testing.T) {
	store := NewStore(t.TempDir())

	papers := []models.Paper{{ID: "p1", Title: "One", Year: 2024, Abstract: "abstract"}}
	if err := store.SavePapers(papers); err != nil {
		t.Fatalf("SavePapers: %v", err)
	}
	got, err := store.LoadPapers()
	if err != nil {
		t.Fatalf("LoadPapers: %v", err)
	}
	if len(got) != 1 || got[0].ID != "p1" || got[0].Title != "One" {
		t.Fatalf("paper round trip: %+v", got)
	}

	claims := []models.Claim{{ID: "c1", PaperID: "p1", Text: "claim"}}
	if err := store.SaveClaims(claims); err != nil {
		t.Fatalf("SaveClaims: %v", err)
	}
	claimsGot, err := store.LoadClaims()
	if err != nil {
		t.Fatalf("LoadClaims: %v", err)
	}
	if len(claimsGot) != 1 || claimsGot[0].ID != "c1" {
		t.Fatalf("claim round trip: %+v", claimsGot)
	}
}

func TestStoreEmptyIsNotError(t *testing.T) {
	store := NewStore(t.TempDir())
	papers, err := store.LoadPapers()
	if err != nil {
		t.Fatalf("LoadPapers on empty store: %v", err)
	}
	if len(papers) != 0 {
		t.Fatalf("expected empty, got %d", len(papers))
	}
}

func TestIngestPersistsWithoutBrain(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	papers := []models.Paper{{ID: "arx-1", Title: "A paper", Abstract: "Some abstract text."}}

	claims, err := svc.IngestPapers(context.Background(), papers)
	if err != nil {
		t.Fatalf("IngestPapers: %v", err)
	}
	if len(claims) != 0 {
		t.Fatalf("expected no claims without a brain, got %d", len(claims))
	}

	list, err := svc.ListPapers()
	if err != nil {
		t.Fatalf("ListPapers: %v", err)
	}
	if len(list) != 1 || list[0].ID != "arx-1" || list[0].IngestedAt == "" {
		t.Fatalf("papers after ingest: %+v", list)
	}
}

func TestIngestIsIdempotentByID(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	_, _ = svc.IngestPapers(context.Background(), []models.Paper{{ID: "dup", Title: "First"}})
	_, _ = svc.IngestPapers(context.Background(), []models.Paper{{ID: "dup", Title: "Second"}})

	list, _ := svc.ListPapers()
	if len(list) != 1 {
		t.Fatalf("expected 1 paper after duplicate ingest, got %d", len(list))
	}
	if list[0].Title != "Second" {
		t.Errorf("paper should be updated: %+v", list[0])
	}
}

func TestHandleAPIGetPapers(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	_ = svc.store.SavePapers([]models.Paper{{ID: "p1", Title: "One"}})

	req := httptest.NewRequest("GET", "/api/research/papers", nil)
	rec := httptest.NewRecorder()
	HandleAPI(rec, req, svc)

	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	var papers []models.Paper
	if err := json.Unmarshal(rec.Body.Bytes(), &papers); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(papers) != 1 || papers[0].ID != "p1" {
		t.Fatalf("papers: %+v", papers)
	}
}

func TestHandleAPIRejectsBadIngestBody(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	req := httptest.NewRequest("POST", "/api/research/ingest", bytes.NewBufferString("{bad"))
	rec := httptest.NewRecorder()
	HandleAPI(rec, req, svc)

	if rec.Code != 400 {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestHandleAPIUnknownRoute(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	req := httptest.NewRequest("GET", "/api/research/nope", nil)
	rec := httptest.NewRecorder()
	HandleAPI(rec, req, svc)

	if rec.Code != 404 {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}
