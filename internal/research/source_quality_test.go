package research

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
)

func TestSourceScreenUsesExactNumberedExcerptAndRetriesOnce(t *testing.T) {
	s := topicFixture(t, false)
	calls := 0
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, prompt string, out interface{}) error {
		calls++
		if strings.Contains(prompt, `"excerpts":["1."]`) {
			t.Fatal("numbered list marker offered as evidence")
		}
		if calls == 1 {
			return json.Unmarshal([]byte(`{"assessments":[]}`), out)
		}
		return json.Unmarshal([]byte(`{"assessments":[{"paperId":"p1","relevance":"indirect","dataKind":"review","excerptIndex":0,"limitations":"Review only; no original observations available."}]}`), out)
	}}}}
	r := models.VerificationRun{ID: strings.Repeat("a", 32), Request: models.VerificationRequest{Topic: "sleep memory"}, Papers: []models.Paper{{ID: "p1", Abstract: "1. Sleep improves memory in the observed sample."}}}
	if err := s.screenTopicPapers(context.Background(), &r); err != nil {
		t.Fatal(err)
	}
	if calls != 2 || r.SourceAssessments[0].Quote != "Sleep improves memory in the observed sample." {
		t.Fatalf("%d %+v", calls, r.SourceAssessments)
	}
}

func TestSourceScreenRejectsUnrelatedAndUngrounded(t *testing.T) {
	for _, tc := range []struct{ name, quote, relevance, want string }{
		{"unrelated", "Sleep improves memory in the observed sample.", "irrelevant", "did not address"},
		{"invented quote", "These data establish moth pollination effects.", "direct", "real source excerpt"},
		{"missing judgment", "Sleep improves memory in the observed sample.", "", "invalid source"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := topicFixture(t, false)
			s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, _ string, out interface{}) error {
				b, _ := json.Marshal(map[string]interface{}{"assessments": []models.SourceAssessment{{PaperID: "p1", Quote: tc.quote, Relevance: tc.relevance, DataKind: "unknown", Limitations: "Methods unavailable."}}})
				return json.Unmarshal(b, out)
			}}}}
			r := models.VerificationRun{Request: models.VerificationRequest{Topic: "moth pollination"}, Papers: []models.Paper{{ID: "p1", Abstract: "Sleep improves memory in the observed sample."}}}
			if err := s.screenTopicPapers(context.Background(), &r); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("%v", err)
			}
		})
	}
}

func TestPaperRetrievalExcludesKnownRetractionsAndParatext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"results":[{"id":"W1","title":"Withdrawn study","is_retracted":true},{"id":"W2","title":"Retraction notice","type":"retraction"},{"id":"W3","title":"Cover page","type":"paratext"},{"id":"W4","title":"Potentially relevant study","type":"article","abstract_inverted_index":{"Measurements":[0],"reported":[1]}}]}`))
	}))
	defer server.Close()
	c := &OpenAlexNoveltyChecker{baseURL: server.URL, client: server.Client()}
	papers, err := c.Retrieve(context.Background(), "topic", 5)
	if err != nil || len(papers) != 1 || papers[0].Title != "Potentially relevant study" {
		t.Fatalf("%+v %v", papers, err)
	}
}
