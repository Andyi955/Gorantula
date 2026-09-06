package research

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
)

func testVerificationCall(tool string) models.VerificationCall {
	return models.VerificationCall{Tool: tool, GroupColumn: "group", ValueColumn: "value", Statement: "Compare the supplied independent groups", Rationale: "Synthetic independent observations for tool validation"}
}

func TestVerificationPermutationKnownDistribution(t *testing.T) {
	// For {1,2}/{3,4}, exactly 2 of the 6 distinct partitions are as extreme
	// as the observed absolute difference of 2. Monte Carlo should approach 1/3.
	data := models.ResearchDataset{CSV: "group,value\na,1\na,2\nb,3\nb,4\n"}
	got := executeVerificationTool(context.Background(), data, testVerificationCall("stats-reanalysis"))
	if got.Status != "completed" || got.PValue == nil || math.Abs(*got.PValue-1.0/3) > 0.035 || *got.MeanDifference != 2 {
		t.Fatalf("unexpected result: %+v", got)
	}
	if got.Verdict != "inconclusive" {
		t.Fatal("a computation must not approve a hypothesis")
	}
	again := executeVerificationTool(context.Background(), data, testVerificationCall("stats-reanalysis"))
	if again.OutputDigest != got.OutputDigest {
		t.Fatal("seeded replay changed")
	}
	data.CSV = "group,value\na,7\na,7\nb,7\nb,7\n"
	null := executeVerificationTool(context.Background(), data, testVerificationCall("stats-reanalysis"))
	if null.PValue == nil || *null.PValue != 1 {
		t.Fatalf("identical observations: %+v", null)
	}
}

func TestVerificationRejectsInvalidDataAndCalls(t *testing.T) {
	for _, raw := range []string{"group,value\na,NaN\na,1\nb,2\nb,3", "group,value\na,\nb,2", "group,value\na,1\nb,2", "group,value\na,Inf\nb,2", "group,value\na,1e99\nb,2"} {
		result := executeVerificationTool(context.Background(), models.ResearchDataset{CSV: raw}, testVerificationCall("stats-reanalysis"))
		if result.Status != "failed" || result.Verdict != "inconclusive" || result.PValue != nil {
			t.Fatalf("invalid data accepted: %+v", result)
		}
	}
	for _, raw := range []string{"a,a\n1,2\n3,4", "a,b\n1,2,3\n4,5", "a,b\n1,2", strings.Repeat("x", maxDatasetBytes+1)} {
		if _, _, err := parseVerificationCSV(raw); err == nil {
			t.Fatal("malformed CSV accepted")
		}
	}
	call := testVerificationCall("shell")
	if err := validateVerificationCall(call); err == nil {
		t.Fatal("unknown tool accepted")
	}
	call = testVerificationCall("figure-reproduce")
	call.GroupColumn = "missing"
	if result := executeVerificationTool(context.Background(), models.ResearchDataset{CSV: "group,value\na,1\nb,2"}, call); result.Status != "failed" {
		t.Fatal("missing column accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := permutationP(ctx, [][]float64{{1, 2}, {3, 4}}, 2); err != context.Canceled {
		t.Fatal("calculation ignored cancellation")
	}
}

func TestVerificationFigureEscapesLabelsAndSupportsNegativeMeans(t *testing.T) {
	data := models.ResearchDataset{CSV: "group,value\n<script>alert(1)</script>,-5\nother,10"}
	result := executeVerificationTool(context.Background(), data, testVerificationCall("figure-reproduce"))
	if result.Status != "completed" || strings.Contains(result.SVG, "<script>") || !strings.Contains(result.SVG, "&lt;script&gt;") || !strings.Contains(result.SVG, `x="425.00"`) {
		t.Fatalf("invalid plot: %+v", result)
	}
	d := xml.NewDecoder(strings.NewReader(result.SVG))
	for {
		_, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
}

func verificationFixture(t *testing.T) (*Service, models.VerificationRequest) {
	t.Helper()
	s := NewService(t.TempDir(), nil)
	if err := s.store.SaveCandidates([]models.CandidateHypothesis{{ID: "candidate", Hypothesis: "Synthetic comparison", State: "approved", ApprovedBy: "operator", ClaimIDs: []string{"claim"}}}); err != nil {
		t.Fatal(err)
	}
	if err := s.store.SaveClaims([]models.Claim{{ID: "claim", Text: "Synthetic test claim", SourceSnippet: "Synthetic test claim"}}); err != nil {
		t.Fatal(err)
	}
	d, err := s.RegisterDataset("Synthetic comparison", "Synthetic fixture, not research evidence", "group,value\na,1\na,2\nb,3\nb,4\n")
	if err != nil {
		t.Fatal(err)
	}
	return s, models.VerificationRequest{Mode: "manual", CandidateID: "candidate", DatasetID: d.ID, Calls: []models.VerificationCall{testVerificationCall("stats-reanalysis"), testVerificationCall("figure-reproduce")}}
}

func awaitVerification(t *testing.T, s *Service, id string) models.VerificationRun {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		run, err := s.GetVerificationRun(id)
		if err != nil {
			t.Fatal(err)
		}
		if run.Status != "running" && run.Status != "queued" {
			return run
		}
		time.Sleep(time.Millisecond * 5)
	}
	t.Fatal("run did not finish")
	return models.VerificationRun{}
}

func TestVerificationPersistenceReplayAndApprovalIsolation(t *testing.T) {
	s, req := verificationFixture(t)
	started, err := s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	finished := awaitVerification(t, s, started.ID)
	if finished.Status != "completed" || len(finished.Results) != 2 || finished.Dataset.CSV == "" || len(finished.Claims) != 1 {
		t.Fatalf("incomplete bundle: %+v", finished)
	}
	standalone, err := ReplayVerificationBundle(context.Background(), finished)
	if err != nil || len(standalone) != 2 || standalone[0].OutputDigest != finished.Results[0].OutputDigest {
		t.Fatalf("standalone replay: %v", err)
	}
	// Replay uses its snapshot even after the source corpus changes.
	if err := s.store.SaveCandidates(nil); err != nil {
		t.Fatal(err)
	}
	restarted := NewService(s.store.root, nil)
	replay, err := restarted.StartVerification(models.VerificationRequest{Mode: "replay", ReplayOf: started.ID})
	if err != nil {
		t.Fatal(err)
	}
	replayed := awaitVerification(t, restarted, replay.ID)
	if replayed.ReplayMatches == nil || !*replayed.ReplayMatches || replayed.Candidate.State != "approved" || replayed.Candidate.ApprovedBy != "operator" {
		t.Fatalf("replay lost provenance: %+v", replayed)
	}
	finished.ImplementationDigest = "changed"
	if err := s.verificationStore("runs").saveSlice(finished.ID+".json", finished); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.StartVerification(models.VerificationRequest{Mode: "replay", ReplayOf: finished.ID}); err == nil {
		t.Fatal("replayed incompatible implementation")
	}
}

func TestVerificationInterruptedRunAndTamperedInput(t *testing.T) {
	s, req := verificationFixture(t)
	id := strings.Repeat("a", 32)
	if err := s.verificationStore("runs").saveSlice(id+".json", models.VerificationRun{ID: id, Status: "running"}); err != nil {
		t.Fatal(err)
	}
	run, err := s.GetVerificationRun(id)
	if err != nil || run.Status != "interrupted" {
		t.Fatalf("stale run: %+v %v", run, err)
	}
	d, err := s.loadDataset(req.DatasetID)
	if err != nil {
		t.Fatal(err)
	}
	d.CSV += "b,99\n"
	if err := s.verificationStore("datasets").saveSlice(d.ID+".json", d); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartVerification(req); err == nil {
		t.Fatal("tampered CSV accepted")
	}
	if _, err := s.loadDataset("../../.env"); err == nil {
		t.Fatal("path accepted as dataset ID")
	}
}

// Embedding the provider interface keeps this fixture focused on the JSON
// protocol; a call to an unsupported provider method deliberately fails the test.
type verificationModel struct {
	brain.ModelProvider
	generate func(context.Context, string, interface{}) error
}

func (m verificationModel) GenerateJSON(ctx context.Context, prompt string, response interface{}) error {
	return m.generate(ctx, prompt, response)
}
func (m verificationModel) Name() string { return "verification-test" }

func TestVerificationAgentUsesToolResultsThenFinishes(t *testing.T) {
	s, req := verificationFixture(t)
	turn := 0
	m := verificationModel{generate: func(ctx context.Context, prompt string, response interface{}) error {
		turn++
		action := models.VerificationAgentAction{Action: "call", Call: func() *models.VerificationCall {
			c := testVerificationCall("stats-reanalysis")
			c.Descriptive = true
			return &c
		}()}
		if turn == 2 {
			if !strings.Contains(prompt, `"meanDifference":`) || !strings.Contains(prompt, "Descriptive mean difference") {
				return fmt.Errorf("real tool result not supplied")
			}
			action = models.VerificationAgentAction{Action: "finish", Interpretation: "Synthetic result only; this does not approve the candidate."}
		}
		data, _ := json.Marshal(action)
		return json.Unmarshal(data, response)
	}}
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": m}}
	req.Mode = "agent"
	req.Calls = nil
	started, err := s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	run := awaitVerification(t, s, started.ID)
	if run.Status != "completed" || len(run.Results) != 1 || run.Interpretation == "" {
		t.Fatalf("agent failed: %+v", run)
	}
	candidates, err := s.ListCandidates()
	if err != nil || candidates[0].State != "approved" {
		t.Fatal("verification mutated approval")
	}
}

func TestFinishWithoutDataSetsRejectedInterpretation(t *testing.T) {
	run := models.VerificationRun{}
	if err := finishWithoutData(&run); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(run.Interpretation, "rejected") || !strings.Contains(run.Interpretation, "no usable data") {
		t.Fatalf("interpretation = %q", run.Interpretation)
	}
}

func TestVerificationAgentToleratesExtraTopLevelField(t *testing.T) {
	s, req := verificationFixture(t)
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, _ string, response interface{}) error {
		// The model adds a harmless top-level field; it must not fail the run.
		return json.Unmarshal([]byte(`{"action":"finish","interpretation":"Synthetic only; no approval.","proposition":"model-added-field"}`), response)
	}}}}
	req.Mode = "agent"
	req.Calls = nil
	run, err := s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	finished := awaitVerification(t, s, run.ID)
	if finished.Status != "completed" || finished.Interpretation == "" {
		t.Fatalf("extra top-level field failed the run: status=%s err=%s", finished.Status, finished.Error)
	}
}

func TestVerificationAgentRejectsCommandInjection(t *testing.T) {
	s, req := verificationFixture(t)
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, _ string, response interface{}) error {
		return json.Unmarshal([]byte(`{"action":"call","call":{"tool":"stats-reanalysis","command":"echo unsafe","groupColumn":"group","valueColumn":"value","statement":"x","rationale":"y"}}`), response)
	}}}}
	req.Mode = "agent"
	req.Calls = nil
	run, err := s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	finished := awaitVerification(t, s, run.ID)
	if finished.Status != "failed" || len(finished.Results) != 0 || !strings.Contains(finished.Error, "unknown field") {
		t.Fatalf("invalid call accepted: %+v", finished)
	}
}

func TestVerificationConcurrencyAndCancellation(t *testing.T) {
	s, req := verificationFixture(t)
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(ctx context.Context, _ string, _ interface{}) error { <-ctx.Done(); return ctx.Err() }}}}
	req.Mode = "agent"
	req.Calls = nil
	a, err := s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartVerification(req); err != ErrVerificationBusy {
		t.Fatalf("missing concurrency limit: %v", err)
	}
	for _, id := range []string{a.ID, b.ID} {
		if err := s.CancelVerification(id); err != nil {
			t.Fatal(err)
		}
		if run := awaitVerification(t, s, id); run.Status != "cancelled" {
			t.Fatalf("cancel: %+v", run)
		}
	}
}

func TestVerificationAPIOriginAndStrictBodies(t *testing.T) {
	s, _ := verificationFixture(t)
	for _, tc := range []struct {
		origin, content, body string
		status                int
	}{
		{"https://untrusted.example", "application/json", `{}`, 403},
		{"http://127.0.0.1:5173", "text/plain", `{}`, 415},
		{"http://localhost:5173", "application/json", `{"mode":"manual","command":"bad"}`, 400},
		{"", "application/json", `{} {}`, 400},
	} {
		r := httptest.NewRequest("POST", "/api/research/verify", strings.NewReader(tc.body))
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("Content-Type", tc.content)
		w := httptest.NewRecorder()
		HandleAPI(w, r, s)
		if w.Code != tc.status {
			t.Fatalf("got %d want %d: %s", w.Code, tc.status, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	HandleAPI(w, httptest.NewRequest("GET", "/api/research/runs/"+strings.Repeat("b", 32), nil), s)
	if w.Code != 404 {
		t.Fatal("missing run should be 404")
	}
}

func TestVerificationDatasetIdentityPreservesProvenance(t *testing.T) {
	s, _ := verificationFixture(t)
	raw := "group,value\na,1\nb,2"
	a, err := s.RegisterDataset("A", "source A", raw)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.RegisterDataset("B", "source B", raw)
	if err != nil {
		t.Fatal(err)
	}
	if a.ID == b.ID || a.Digest != b.Digest {
		t.Fatal("identity must preserve provenance while content digests match")
	}
	if _, err := os.Stat(filepath.Join(s.verificationStore("datasets").root, a.ID+".json")); err != nil {
		t.Fatal(err)
	}
}
