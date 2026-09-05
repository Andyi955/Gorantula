package research

import (
	"context"
	"encoding/json"
	"github.com/Andyi955/Gorantula/brain"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func TestStudyDesignGate(t *testing.T) {
	call := testVerificationCall("stats-reanalysis")
	quote := "Each observation is an independently sampled experimental unit."
	run := models.VerificationRun{DatasetActions: []models.DatasetResult{{Call: models.DatasetCall{Tool: "evidence-lookup"}, Passages: []models.EvidencePassage{{PaperID: "source", Text: quote}}}}}
	if validateAgentStudyDesign(run, call) == nil {
		t.Fatal("missing design accepted")
	}
	call.Design = &models.StudyDesign{PaperID: "source", Quote: quote, Unit: "experimental unit", Structure: "independent", Independence: "documented", Basis: "Source describes independent sampling", Limitations: "Synthetic fixture, no real-world claim"}
	run.Dataset = models.ResearchDataset{CSV: "subject,group,value\ns1,a,1\ns2,a,2\ns3,b,3\ns4,b,4\n"}
	run.Papers = []models.Paper{{ID: "source", FullText: quote}}
	call.Design.IDColumn = "subject"
	values := []string{"response", "one subject", "none", "none", "none", "observational", "independent units"}
	for i, name := range designFactNames {
		call.Design.Facts = append(call.Design.Facts, models.DesignFact{Name: name, Value: values[i], PaperID: "source", Quote: quote})
	}
	if err := validateAgentStudyDesign(run, call); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*models.StudyDesign){
		func(d *models.StudyDesign) { d.Quote = "A fabricated quotation about independent experimental units." },
		func(d *models.StudyDesign) { d.PaperID = "different" },
		func(d *models.StudyDesign) { d.Structure = "paired" },
		func(d *models.StudyDesign) { d.Independence = "unknown" },
		func(d *models.StudyDesign) { d.Limitations = "" },
	} {
		original := *call.Design
		change(call.Design)
		if validateAgentStudyDesign(run, call) == nil {
			t.Fatal("unsupported design accepted")
		}
		*call.Design = original
	}
	call.Tool = "stats-paired"
	if validateAgentStudyDesign(run, call) == nil {
		t.Fatal("unpaired design accepted for paired test")
	}
	call.Design.Structure = "paired"
	call.Design.Facts[2].Value = "within row"
	call.Design.Facts[3].Value = "within row"
	if err := validateAgentStudyDesign(run, call); err != nil {
		t.Fatal(err)
	}
	call.Descriptive = true
	call.Design = nil
	if err := validateAgentStudyDesign(models.VerificationRun{}, call); err != nil {
		t.Fatal(err)
	}
}

func TestDescriptiveStatisticsNeverEmitInference(t *testing.T) {
	s, _ := verificationFixture(t)
	d, err := s.RegisterDataset("line", "synthetic", "x,y\n1,5\n2,7\n3,9\n4,11\n5,13\n6,15\n")
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range []string{"stats-paired", "stats-correlation", "stats-regression"} {
		call := models.VerificationCall{Tool: tool, GroupColumn: "x", ValueColumn: "y", Statement: "Describe fixture", Rationale: "No inference", Descriptive: true}
		r := executeVerificationTool(context.Background(), d, call)
		if r.Status != "completed" || r.PValue != nil || len(r.Intervals) != 0 || r.Permutations != 0 {
			t.Fatalf("descriptive output leaked inference: %+v", r)
		}
		if tool == "stats-regression" && (r.Metrics["slope"] != 2 || r.Metrics["intercept"] != 3) {
			t.Fatal(r.Metrics)
		}
	}
	d, err = s.RegisterDataset("groups", "synthetic", "group,value\na,1\na,2\na,3\na,4\nb,5\nb,6\nb,7\nb,8\n")
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range []string{"stats-reanalysis", "stats-effects"} {
		call := testVerificationCall(tool)
		call.Descriptive = true
		r := executeVerificationTool(context.Background(), d, call)
		if r.Status != "completed" || r.PValue != nil || len(r.Intervals) != 0 {
			t.Fatalf("bad descriptive groups: %+v", r)
		}
	}
}

func TestAgentDesignRejectionThenDescriptiveRecovery(t *testing.T) {
	s, req := verificationFixture(t)
	turn := 0
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, prompt string, response interface{}) error {
		turn++
		c := testVerificationCall("stats-reanalysis")
		a := models.VerificationAgentAction{Action: "call", Call: &c}
		if turn == 2 {
			if !strings.Contains(prompt, "study-design gate") || !strings.Contains(prompt, "exact descriptive action") {
				t.Error("recovery instruction missing")
			}
			c.Descriptive = true
		}
		if turn >= 3 {
			a = models.VerificationAgentAction{Action: "finish", Interpretation: "Descriptive sample only."}
		}
		raw, _ := json.Marshal(a)
		return json.Unmarshal(raw, response)
	}}}}
	req.Mode = "agent"
	req.Calls = nil
	started, err := s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	run := awaitVerification(t, s, started.ID)
	if run.Status != "completed" || len(run.DatasetActions) != 1 || len(run.Results) != 1 || run.Results[0].PValue != nil || !run.Results[0].Call.Descriptive {
		t.Fatalf("gate recovery failed: %+v", run)
	}
	replay, err := ReplayVerificationBundle(context.Background(), run)
	if err != nil || replay[0].OutputDigest != run.Results[0].OutputDigest {
		t.Fatal("descriptive replay mismatch", err)
	}
}

func TestAgentCompletionCheckRecoversMissingInput(t *testing.T) {
	s, req := verificationFixture(t)
	d, err := s.RegisterDataset("missing", "synthetic", "group,value\na,1\na,3\nb,NA\nb,9\nb,11\n")
	if err != nil {
		t.Fatal(err)
	}
	turn := 0
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, prompt string, response interface{}) error {
		turn++
		c := testVerificationCall("stats-reanalysis")
		c.Descriptive = true
		a := models.VerificationAgentAction{Action: "call", Call: &c}
		switch turn {
		case 2, 5:
			a = models.VerificationAgentAction{Action: "finish", Interpretation: "Done."}
		case 3:
			if !strings.Contains(prompt, "completion-check") {
				t.Error("missing recovery nudge")
			}
			a = models.VerificationAgentAction{Action: "dataset", DatasetCall: &models.DatasetCall{Tool: "dataset-filter", Column: "value", Operator: "not-missing", Rationale: "Missing outcome"}}
		case 4:
			if !strings.Contains(prompt, `"results":[]`) || !strings.Contains(prompt, `"earlierInputResults":[{`) {
				t.Error("old error not separated")
			}
		}
		raw, _ := json.Marshal(a)
		return json.Unmarshal(raw, response)
	}}}}
	req.Mode = "agent"
	req.Calls = nil
	req.DatasetID = d.ID
	started, err := s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	run := awaitVerification(t, s, started.ID)
	if run.Status != "completed" || len(run.Results) != 2 || run.Results[0].Status != "failed" || run.Results[1].Status != "completed" {
		t.Fatalf("recovery failed: %+v", run)
	}
	replay, err := ReplayVerificationBundle(context.Background(), run)
	if err != nil {
		t.Fatal(err)
	}
	for i := range replay {
		if replay[i].OutputDigest != run.Results[i].OutputDigest {
			t.Fatal("attempt replay mismatch")
		}
	}
}

// A real but irrelevant quote must not unlock inference merely because the
// planner filled every field. The independent critique can veto it.
func TestCriticalReviewRejectsMisleadingQuote(t *testing.T) {
	s, _ := verificationFixture(t)
	quote := "We measured fifty cars during the experiment."
	source := quote + " The same five vehicles were tested repeatedly on ten occasions."
	d, err := s.RegisterDataset("cars", "fixture", "subject,group,value\na,x,1\nb,x,2\nc,y,3\nd,y,4\n")
	if err != nil {
		t.Fatal(err)
	}
	call := testVerificationCall("stats-reanalysis")
	call.Design = &models.StudyDesign{PaperID: "p", Quote: quote, Unit: "car", Structure: "independent", Independence: "documented", Basis: "Claimed independence", Limitations: "Historical", IDColumn: "subject"}
	values := []string{"stopping distance", "one car", "none", "none", "none", "observational", "independent units"}
	for i, name := range designFactNames {
		call.Design.Facts = append(call.Design.Facts, models.DesignFact{Name: name, Value: values[i], PaperID: "p", Quote: quote})
	}
	run := models.VerificationRun{Dataset: d, Papers: []models.Paper{{ID: "p", FullText: source}}, DatasetActions: []models.DatasetResult{{Call: models.DatasetCall{Tool: "evidence-lookup"}, Passages: []models.EvidencePassage{{PaperID: "p", Text: quote}}}}}
	calls := 0
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, prompt string, response interface{}) error {
		calls++
		if !strings.Contains(prompt, "same five vehicles") {
			t.Error("contradictory full source omitted")
		}
		raw, _ := json.Marshal(map[string]interface{}{"supported": false, "reason": "The quote counts measurements, not independent cars", "contradictions": []string{"Repeated vehicles"}, "checkedFacts": designFactNames})
		return json.Unmarshal(raw, response)
	}}}}
	if err := s.reviewAgentDesign(context.Background(), &run, call); err == nil {
		t.Fatal("critical rejection ignored")
	}
	if calls != 1 || len(run.StudyReviews) != 1 || run.StudyReviews[0].Supported || run.StudyReviews[0].InputDigest != d.Digest {
		t.Fatal("review not recorded")
	}
	run.Dataset.CSV = "subject,group,value\na,x,1\na,x,2\nb,y,3\nb,y,4\n"
	if err := s.reviewAgentDesign(context.Background(), &run, call); err == nil {
		t.Fatal("repeated units accepted")
	}
	if calls != 1 {
		t.Fatal("contradictory data should block before reviewer")
	}
	call.Design.Facts[4].Value = "household"
	if validateAgentStudyDesign(run, call) == nil {
		t.Fatal("clustering accepted")
	}
	call.Design.Facts[4].Value = "unknown"
	if validateAgentStudyDesign(run, call) == nil {
		t.Fatal("unknown fact accepted")
	}
}

func TestReviewApprovalRequiresAllFactsAndNoContradictions(t *testing.T) {
	s, _ := verificationFixture(t)
	quote := "Independent units were sampled separately with one outcome per subject and no repeated or clustered measurements."
	call := testVerificationCall("stats-reanalysis")
	call.Design = &models.StudyDesign{PaperID: "p", Quote: quote, Unit: "subject", Structure: "independent", Independence: "documented", Basis: "Source", Limitations: "Fixture", IDColumn: "subject"}
	values := []string{"outcome", "one subject", "none", "none", "none", "randomized", "independent units"}
	for i, name := range designFactNames {
		call.Design.Facts = append(call.Design.Facts, models.DesignFact{Name: name, Value: values[i], PaperID: "p", Quote: quote})
	}
	template := models.VerificationRun{Dataset: models.ResearchDataset{CSV: "subject,group,value\na,x,1\nb,x,2\nc,y,3\nd,y,4\n"}, Papers: []models.Paper{{ID: "p", FullText: quote}}, DatasetActions: []models.DatasetResult{{Call: models.DatasetCall{Tool: "evidence-lookup"}, Passages: []models.EvidencePassage{{PaperID: "p", Text: quote}}}}}
	for _, tc := range []struct {
		name           string
		facts          []string
		contradictions []string
		ok             bool
	}{{"complete", designFactNames, nil, true}, {"missing", designFactNames[:6], nil, false}, {"contradiction", designFactNames, []string{"repeated"}, false}} {
		t.Run(tc.name, func(t *testing.T) {
			s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, _ string, response interface{}) error {
				raw, _ := json.Marshal(map[string]interface{}{"supported": true, "reason": "Source checked", "contradictions": tc.contradictions, "checkedFacts": tc.facts})
				return json.Unmarshal(raw, response)
			}}}}
			run := template
			err := s.reviewAgentDesign(context.Background(), &run, call)
			if (err == nil) != tc.ok || run.StudyReviews[0].Supported != tc.ok {
				t.Fatal("review decision mismatch", err)
			}
		})
	}
}
