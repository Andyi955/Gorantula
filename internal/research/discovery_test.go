package research

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
)

func TestGenerateDiscoveryQuestions(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	originalSearch := openDataFetch
	defer func() { openDataFetch = originalSearch }()
	openDataFetch = func(_ context.Context, _ string, _ int64) ([]byte, string, error) {
		return []byte(zenodoFixture), "", nil
	}
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, _ string, out interface{}) error {
		return json.Unmarshal([]byte(`{"questions":["Do species differ in body mass?","Does fertilizer increase crop yield?","  ","Do species differ in body mass?"]}`), out)
	}}}}
	got, err := s.generateDiscoveryQuestions(context.Background(), "ecology", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 valid unique questions, got %d (%v)", len(got), got)
	}
	if got[0] != "Do species differ in body mass" || strings.HasSuffix(got[0], "?") {
		t.Fatalf("question should be trailing-? trimmed: %q", got[0])
	}
}

func TestDiscoveryQuestionDuplicateSemantic(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"Do penguin species differ in body mass", "Do penguins differ in body mass", true},
		{"Do iris types differ in petal length", "Do iris species differ in petal length", true},
		{"Do species differ in body mass", "Do penguins differ in mass", false},
		{"Does fertilizer increase crop yield", "Do penguins differ in body mass", false},
		{"Do penguins differ in body mass", "Do penguins differ in body mass", true},
		{"Do birds differ in wing length", "", false},
	}
	for _, tc := range cases {
		got := discoveryQuestionDuplicateSemantic(tc.a, tc.b)
		if got != tc.want {
			t.Errorf("duplicate(%q, %q) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestGenerateDiscoveryQuestionsEmpty(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, _ string, out interface{}) error {
		return json.Unmarshal([]byte(`{"questions":["","   "]}`), out)
	}}}}
	if _, err := s.generateDiscoveryQuestions(context.Background(), "x", 1); err == nil {
		t.Fatal("expected an error when no bounded question is proposed")
	}
}

// newDiscoveryServiceWithRun stores one discovery run in a temp store and
// returns the service plus the stored run.
func newDiscoveryServiceWithRun(t *testing.T, status string) (*Service, models.DiscoveryRun) {
	t.Helper()
	s := NewService(t.TempDir(), nil)
	run := models.DiscoveryRun{
		ID:        strings.Repeat("a", 32),
		Theme:     "ecology",
		Status:    status,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		Questions: []models.DiscoveryQuestion{},
	}
	if err := s.saveDiscovery(run); err != nil {
		t.Fatal(err)
	}
	return s, run
}

// callDiscoveryAPI drives the real router; a non-empty body is sent as JSON so
// the handlers' application/json requirement is exercised.
func callDiscoveryAPI(t *testing.T, s *Service, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	HandleAPI(w, r, s)
	return w
}

func listDiscoveryAPI(t *testing.T, s *Service, path string) []models.DiscoveryRun {
	t.Helper()
	w := callDiscoveryAPI(t, s, http.MethodGet, path, "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s: got %d: %s", path, w.Code, w.Body.String())
	}
	var runs []models.DiscoveryRun
	if err := json.Unmarshal(w.Body.Bytes(), &runs); err != nil {
		t.Fatalf("GET %s: %v (%s)", path, err, w.Body.String())
	}
	return runs
}

func TestDiscoveryDismissHidesRunFromListing(t *testing.T) {
	s, run := newDiscoveryServiceWithRun(t, "completed")

	w := callDiscoveryAPI(t, s, http.MethodPost, "/api/research/discoveries/"+run.ID+"/dismiss", `{}`)
	if w.Code != http.StatusOK {
		t.Fatalf("dismiss: got %d: %s", w.Code, w.Body.String())
	}
	var dismissed models.DiscoveryRun
	if err := json.Unmarshal(w.Body.Bytes(), &dismissed); err != nil {
		t.Fatal(err)
	}
	if !dismissed.Dismissed || dismissed.DismissedAt == "" {
		t.Fatalf("dismiss response must carry the marker: %+v", dismissed)
	}

	if runs := listDiscoveryAPI(t, s, "/api/research/discoveries"); len(runs) != 0 {
		t.Fatalf("dismissed run must be hidden from the default listing: %+v", runs)
	}
	all := listDiscoveryAPI(t, s, "/api/research/discoveries?includeDismissed=1")
	if len(all) != 1 || !all[0].Dismissed || all[0].DismissedAt == "" {
		t.Fatalf("includeDismissed listing must return the archived run: %+v", all)
	}
	if all[0].ID != run.ID {
		t.Fatalf("wrong run returned: %+v", all[0])
	}
	if w := callDiscoveryAPI(t, s, http.MethodGet, "/api/research/discoveries/"+run.ID, ""); w.Code != http.StatusOK {
		t.Fatalf("archived run must stay retrievable by id, got %d", w.Code)
	}
}

func TestDiscoveryRestoreClearsDismissal(t *testing.T) {
	s, run := newDiscoveryServiceWithRun(t, "completed")
	if _, err := s.DismissDiscovery(run.ID); err != nil {
		t.Fatal(err)
	}

	w := callDiscoveryAPI(t, s, http.MethodPost, "/api/research/discoveries/"+run.ID+"/restore", `{}`)
	if w.Code != http.StatusOK {
		t.Fatalf("restore: got %d: %s", w.Code, w.Body.String())
	}
	var restored models.DiscoveryRun
	if err := json.Unmarshal(w.Body.Bytes(), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Dismissed || restored.DismissedAt != "" {
		t.Fatalf("restore must clear the marker and timestamp: %+v", restored)
	}
	if runs := listDiscoveryAPI(t, s, "/api/research/discoveries"); len(runs) != 1 || runs[0].ID != run.ID {
		t.Fatalf("restored run must be listed again: %+v", runs)
	}
	if all := listDiscoveryAPI(t, s, "/api/research/discoveries?includeDismissed=1"); len(all) != 1 || all[0].Dismissed {
		t.Fatalf("includeDismissed listing must show the restored run un-flagged: %+v", all)
	}
}

func TestDiscoveryDeleteRemovesRecord(t *testing.T) {
	s, run := newDiscoveryServiceWithRun(t, "completed")

	w := callDiscoveryAPI(t, s, http.MethodDelete, "/api/research/discoveries/"+run.ID, "")
	if w.Code != http.StatusOK {
		t.Fatalf("delete: got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]bool
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body["deleted"] {
		t.Fatalf("delete response must report the deletion: %s", w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(s.discoveryStore().root, run.ID+".json")); !os.IsNotExist(err) {
		t.Fatalf("record must be removed from disk, stat err = %v", err)
	}
	if w := callDiscoveryAPI(t, s, http.MethodDelete, "/api/research/discoveries/"+run.ID, ""); w.Code != http.StatusNotFound {
		t.Fatalf("second delete must be 404, got %d", w.Code)
	}
	if w := callDiscoveryAPI(t, s, http.MethodGet, "/api/research/discoveries/"+run.ID, ""); w.Code != http.StatusNotFound {
		t.Fatalf("deleted run must be gone, got %d", w.Code)
	}
}

func TestDiscoveryDismissAndDeleteRejectRunningRun(t *testing.T) {
	s, run := newDiscoveryServiceWithRun(t, "running")

	if w := callDiscoveryAPI(t, s, http.MethodPost, "/api/research/discoveries/"+run.ID+"/dismiss", `{}`); w.Code != http.StatusConflict {
		t.Fatalf("dismiss of a running run must be 409, got %d: %s", w.Code, w.Body.String())
	}
	if w := callDiscoveryAPI(t, s, http.MethodDelete, "/api/research/discoveries/"+run.ID, ""); w.Code != http.StatusConflict {
		t.Fatalf("delete of a running run must be 409, got %d: %s", w.Code, w.Body.String())
	}
	current, err := s.GetDiscovery(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Status != "running" || current.Dismissed || current.DismissedAt != "" {
		t.Fatalf("rejected calls must leave the record intact: %+v", current)
	}
	// Restore is not gated on a running run: it only clears the archive marker.
	if w := callDiscoveryAPI(t, s, http.MethodPost, "/api/research/discoveries/"+run.ID+"/restore", `{}`); w.Code != http.StatusOK {
		t.Fatalf("restore must not be rejected for a running run, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDiscoveryArchiveAndDeleteUnknownID(t *testing.T) {
	s, _ := newDiscoveryServiceWithRun(t, "completed")
	missing := strings.Repeat("f", 32)
	for _, tc := range []struct {
		method, path, body string
	}{
		{http.MethodPost, "/api/research/discoveries/" + missing + "/dismiss", `{}`},
		{http.MethodPost, "/api/research/discoveries/" + missing + "/restore", `{}`},
		{http.MethodDelete, "/api/research/discoveries/" + missing, ""},
		{http.MethodPost, "/api/research/discoveries/not-an-id/dismiss", `{}`},
		{http.MethodDelete, "/api/research/discoveries/not-an-id", ""},
	} {
		if w := callDiscoveryAPI(t, s, tc.method, tc.path, tc.body); w.Code != http.StatusNotFound {
			t.Fatalf("%s %s: got %d want 404: %s", tc.method, tc.path, w.Code, w.Body.String())
		}
	}
}
