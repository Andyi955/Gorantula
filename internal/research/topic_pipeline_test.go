package research

import (
	"context"
	"encoding/json"
	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
	"strings"
	"testing"
)

func topicFixture(t *testing.T, invalid bool) *Service {
	t.Helper()
	originalFetch := openDataFetch
	t.Cleanup(func() { openDataFetch = originalFetch })
	openDataFetch = func(_ context.Context, _ string, _ int64) ([]byte, string, error) {
		return []byte(`{"hits":{"total":0,"hits":[]}}`), "", nil
	}
	s := NewService(t.TempDir(), nil)
	s.webSearch = nil
	s.datasetFetch = func(_ context.Context, u string) ([]byte, string, error) {
		return []byte("<html>No supplementary data links.</html>"), u, nil
	}
	s.retriever = stubRetriever{papers: []models.Paper{{ID: "p1", Title: "Sleep study", Abstract: "Sleep improves memory in the observed sample.", SourceURL: "https://example.org/paper"}}}
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, prompt string, out interface{}) error {
		var response interface{}
		switch {
		case strings.HasPrefix(prompt, "Screen research sources"):
			response = map[string]interface{}{"assessments": []models.SourceAssessment{{PaperID: "p1", Relevance: "direct", DataKind: "primary-study", Quote: "Sleep improves memory in the observed sample.", Limitations: "Abstract only; methods and data unavailable."}}}
		case strings.Contains(prompt, "claim-extraction analyst"):
			response = map[string]interface{}{"claims": []map[string]interface{}{{"text": "Sleep improves memory in the observed sample.", "entities": []string{"[EVENT:Sleep]"}}}}
		case strings.HasPrefix(prompt, "Propose one"):
			id := "p1-claim-1"
			if invalid {
				id = "invented"
			}
			response = map[string]interface{}{"hypothesis": "Does sleep improve memory?", "claimIds": []string{id}}
		case strings.Contains(prompt, "You are the Methods reviewer"), strings.Contains(prompt, "You are the Skeptical reviewer"):
			response = map[string]interface{}{"summary": "Only an abstract is available.", "concerns": []string{"No measurements available."}}
		default:
			response = models.VerificationAgentAction{Action: "finish", Interpretation: "Literature only: the source reports an association. No usable numerical data was found."}
		}
		b, _ := json.Marshal(response)
		return json.Unmarshal(b, out)
	}}}}
	return s
}
func TestTopicPipelineSearchToReviewedLiteratureReport(t *testing.T) {
	s := topicFixture(t, false)
	r, e := s.StartVerification(models.VerificationRequest{Topic: "sleep memory", Mode: "agent", AutoPrepare: true})
	if e != nil {
		t.Fatal(e)
	}
	r = awaitPipeline(t, s, r.ID)
	if r.PipelineStage != "review" {
		t.Fatalf("%s %s", r.Error, r.ReportError)
	}
	if strings.Join(r.CompletedStages, ",") != "searching,connecting,proposing,checking,reviewing" {
		t.Fatal(r.CompletedStages)
	}
	if len(r.DatasetActions) < 1 || r.DatasetActions[0].Call.Tool != "dataset-discover" {
		t.Fatal("early-finishing model bypassed source retrieval")
	}
	hasRepoSearch := false
	for _, a := range r.DatasetActions {
		if a.Call.Tool == "dataset-search" {
			hasRepoSearch = true
		}
	}
	if !hasRepoSearch {
		t.Fatal("repo-search recovery was not surfaced before finishing")
	}
	if len(r.ReportReviews) != 2 || len(r.Results) != 0 {
		t.Fatal("missing review or fabricated computation")
	}
	d, e := s.GetPublication(r.PublicationID)
	if e != nil {
		t.Fatal(e)
	}
	if d.Status != "draft" || d.ExportPath != "" || len(d.Figures) != 0 || !strings.Contains(d.Markdown, "Literature report only") {
		t.Fatal("bad literature report")
	}
}
func TestTopicPipelineRejectsInventedCitation(t *testing.T) {
	s := topicFixture(t, true)
	r, e := s.StartVerification(models.VerificationRequest{Topic: "sleep", Mode: "agent", AutoPrepare: true})
	if e != nil {
		t.Fatal(e)
	}
	r = awaitPipeline(t, s, r.ID)
	if r.PublicationID != "" || !strings.Contains(r.Error, "unknown claim") {
		t.Fatal(r)
	}
}
func TestTopicPipelineEmptySearchStopsBeforeProposal(t *testing.T) {
	s := topicFixture(t, false)
	s.retriever = stubRetriever{}
	r, e := s.StartVerification(models.VerificationRequest{Topic: "sleep", Mode: "agent", AutoPrepare: true})
	if e != nil {
		t.Fatal(e)
	}
	r = awaitPipeline(t, s, r.ID)
	if r.PublicationID != "" || !strings.Contains(r.Error, "no papers") {
		t.Fatal(r)
	}
}
func TestProposeFromDatasetImportsAndProposes(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	originalSearch, originalDl := openDataFetch, dataDownloadFetch
	defer func() { openDataFetch, dataDownloadFetch = originalSearch, originalDl }()
	openDataFetch = func(_ context.Context, _ string, _ int64) ([]byte, string, error) {
		return []byte(`{"hits":{"total":1,"hits":[{"id":1,"metadata":{"title":"Penguins","description":"Body mass by species."},"files":[{"key":"penguins.csv","size":90000,"links":{"self":"https://zenodo.org/records/1/files/penguins.csv/content"}}]}]}}`), "", nil
	}
	dataDownloadFetch = func(_ context.Context, _ string) ([]byte, string, error) {
		return []byte("species,body_mass_g\nAdelie,3701\nGentoo,5076\nChinstrap,3733\n"), "", nil
	}
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, _ string, out interface{}) error {
		return json.Unmarshal([]byte(`{"hypothesis":"Do penguin species differ in body mass?","group":"species","value":"body_mass_g"}`), out)
	}}}}
	run := models.VerificationRun{ID: strings.Repeat("f", 32), Request: models.VerificationRequest{Topic: "Do penguin species differ in body mass?"}}
	if err := s.proposeFromDataset(context.Background(), &run); err != nil {
		t.Fatal(err)
	}
	if run.Dataset.ID == "" || run.Dataset.Rows != 3 {
		t.Fatalf("dataset not imported: id=%q rows=%d", run.Dataset.ID, run.Dataset.Rows)
	}
	if strings.TrimSpace(run.Candidate.Hypothesis) == "" || len(run.Claims) != 1 {
		t.Fatalf("hypothesis/claim not set: hyp=%q claims=%d", run.Candidate.Hypothesis, len(run.Claims))
	}
	if run.Candidate.ClaimIDs[0] != run.Claims[0].ID {
		t.Fatalf("candidate claim ids not linked")
	}
}

func TestProposeFromDatasetRejectsWhenNoDataset(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	originalSearch := openDataFetch
	defer func() { openDataFetch = originalSearch }()
	openDataFetch = func(_ context.Context, _ string, _ int64) ([]byte, string, error) {
		return []byte(`{"hits":{"total":0,"hits":[]}}`), "", nil
	}
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, _ string, out interface{}) error {
		return json.Unmarshal([]byte(`{"hypothesis":"x","group":"","value":""}`), out)
	}}}}
	run := models.VerificationRun{ID: strings.Repeat("g", 32), Request: models.VerificationRequest{Topic: "no data topic"}}
	if err := s.proposeFromDataset(context.Background(), &run); err == nil {
		t.Fatal("expected error when no open-data dataset is available")
	}
}

func TestTopicInputCannotMixCandidate(t *testing.T) {
	s := topicFixture(t, false)
	_, e := s.StartVerification(models.VerificationRequest{Topic: "sleep", CandidateID: "old", Mode: "agent", AutoPrepare: true})
	if e == nil {
		t.Fatal("mixed request accepted")
	}
}

func TestPersistTopicEvidenceReplacesClaimsWhenPaperGainsFullText(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	storePaper := models.Paper{ID: "p1", Title: "Sleep", Abstract: "Abstract summary."}
	oldClaim := models.Claim{ID: "p1-claim-1", PaperID: "p1", Text: "Abstract-based claim.", Provenance: "abstract", SourceSnippet: "Abstract summary."}
	if e := s.store.SavePapers([]models.Paper{storePaper}); e != nil {
		t.Fatal(e)
	}
	if e := s.store.SaveClaims([]models.Claim{oldClaim}); e != nil {
		t.Fatal(e)
	}

	run := models.VerificationRun{
		Papers:    []models.Paper{{ID: "p1", Title: "Sleep", Abstract: "Abstract summary.", FullText: "Full body text reports actual measurements and results."}},
		Claims:    []models.Claim{{ID: "p1-claim-1", PaperID: "p1", Text: "Full-text-based claim.", Provenance: "fullText", SourceSnippet: "Full body text reports actual measurements and results."}},
		Candidate: models.CandidateHypothesis{ID: "topic-x", Hypothesis: "Does sleep help?", State: "proposed"},
	}
	if e := s.persistTopicEvidence(run); e != nil {
		t.Fatalf("full-text enrichment should replace claims, not error: %v", e)
	}
	got, _ := s.ListClaims()
	for _, c := range got {
		if c.ID == "p1-claim-1" && c.Text == "Full-text-based claim." && c.Provenance == "fullText" {
			return
		}
	}
	t.Fatalf("claim not replaced with full-text-based version: %+v", got)
}

func TestPersistTopicEvidenceRejectsChangedClaimWithUnchangedSource(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	storePaper := models.Paper{ID: "p1", Title: "Sleep", Abstract: "Abstract summary."}
	oldClaim := models.Claim{ID: "p1-claim-1", PaperID: "p1", Text: "Claim A.", Provenance: "abstract", SourceSnippet: "Abstract summary."}
	if e := s.store.SavePapers([]models.Paper{storePaper}); e != nil {
		t.Fatal(e)
	}
	if e := s.store.SaveClaims([]models.Claim{oldClaim}); e != nil {
		t.Fatal(e)
	}

	run := models.VerificationRun{
		Papers:    []models.Paper{{ID: "p1", Title: "Sleep", Abstract: "Abstract summary."}}, // same source, no full text
		Claims:    []models.Claim{{ID: "p1-claim-1", PaperID: "p1", Text: "Claim B.", Provenance: "abstract", SourceSnippet: "Abstract summary."}},
		Candidate: models.CandidateHypothesis{ID: "topic-x", Hypothesis: "Does sleep help?", State: "proposed"},
	}
	if e := s.persistTopicEvidence(run); e == nil || !strings.Contains(e.Error(), "source claim changed") {
		t.Fatalf("expected source claim changed error, got %v", e)
	}
}
