package research

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
)

func awaitPipeline(t *testing.T, s *Service, id string) models.VerificationRun {
	t.Helper()
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); {
		run, err := s.GetVerificationRun(id)
		if err != nil {
			t.Fatal(err)
		}
		if run.PipelineStage == "review" || run.PipelineStage == "needs_attention" {
			return run
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("pipeline did not finish")
	return models.VerificationRun{}
}

func TestPipelineAgentToUnapprovedReport(t *testing.T) {
	s, req := verificationFixture(t)
	datasetID := req.DatasetID
	turn := 0
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, _ string, out interface{}) error {
		turn++
		action := models.VerificationAgentAction{Action: "finish", Interpretation: "What we found: the sample means differ. What remains uncertain: the wider population."}
		if turn == 1 {
			action = models.VerificationAgentAction{Action: "dataset", DatasetCall: &models.DatasetCall{Tool: "dataset-use", DatasetID: datasetID, Rationale: "Selected the matching synthetic software fixture"}}
		}
		if turn == 2 {
			call := testVerificationCall("figure-reproduce")
			action = models.VerificationAgentAction{Action: "call", Call: &call}
		}
		data, _ := json.Marshal(action)
		return json.Unmarshal(data, out)
	}}}}
	req.Mode, req.Calls, req.AutoPrepare = "agent", nil, true
	req.DatasetID = ""
	started, err := s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	run := awaitPipeline(t, s, started.ID)
	if run.PipelineStage != "review" || run.PublicationID == "" {
		t.Fatalf("report missing: %+v", run)
	}
	paper, err := s.GetPublication(run.PublicationID)
	if err != nil {
		t.Fatal(err)
	}
	if paper.Status != "draft" || paper.ApprovedRevision != "" || paper.ExportPath != "" {
		t.Fatal("pipeline made a sharing decision")
	}
	if len(paper.Figures) != 1 || len(paper.Figures[0].PNG) == 0 {
		t.Fatal("pipeline left a manual figure task")
	}
	if paper.Run.Interpretation != run.Interpretation {
		t.Fatal("model explanation lost")
	}
}

func TestPipelineMissingDataNeedsAttentionWithoutFakeReport(t *testing.T) {
	s, req := verificationFixture(t)
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, _ string, out interface{}) error {
		data, _ := json.Marshal(models.VerificationAgentAction{Action: "finish", Interpretation: "No suitable data found."})
		return json.Unmarshal(data, out)
	}}}}
	req.Mode, req.Calls, req.AutoPrepare = "agent", nil, true
	run, err := s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	run = awaitPipeline(t, s, run.ID)
	if run.PipelineStage != "needs_attention" || run.PublicationID != "" || run.ReportError == "" {
		t.Fatal("missing evidence hidden")
	}
}

func TestPipelineInterruptedPreparationIsNotImmortal(t *testing.T) {
	s, _ := verificationFixture(t)
	run := models.VerificationRun{ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Status: "completed", PipelineStage: "preparing", Request: models.VerificationRequest{AutoPrepare: true}}
	if err := s.saveVerificationRun(run); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.GetVerificationRun(run.ID)
	if err != nil || loaded.PipelineStage != "needs_attention" {
		t.Fatalf("interrupted preparation not surfaced: %v", err)
	}
}

func TestPipelineDatasetSelectionIsBoundedAndFrozen(t *testing.T) {
	s, req := verificationFixture(t)
	run := models.VerificationRun{}
	call := models.DatasetCall{Tool: "dataset-use", DatasetID: "../../outside", Rationale: "Check relevant data"}
	if result := s.executeDatasetCall(context.Background(), &run, call); result.Error == "" || run.Dataset.ID != "" {
		t.Fatal("invalid dataset selection accepted")
	}
	call.DatasetID = req.DatasetID
	if result := s.executeDatasetCall(context.Background(), &run, call); result.Error != "" || run.Dataset.ID != req.DatasetID {
		t.Fatalf("stored data not selected: %+v", result)
	}
	run.Results = []models.VerificationResult{{Status: "completed"}}
	if result := s.executeDatasetCall(context.Background(), &run, call); result.Error == "" {
		t.Fatal("dataset changed after successful calculation")
	}
}
