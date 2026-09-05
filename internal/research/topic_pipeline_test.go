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
	if len(r.DatasetActions) != 1 || r.DatasetActions[0].Call.Tool != "dataset-discover" {
		t.Fatal("early-finishing model bypassed source retrieval")
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
func TestTopicInputCannotMixCandidate(t *testing.T) {
	s := topicFixture(t, false)
	_, e := s.StartVerification(models.VerificationRequest{Topic: "sleep", CandidateID: "old", Mode: "agent", AutoPrepare: true})
	if e == nil {
		t.Fatal("mixed request accepted")
	}
}
