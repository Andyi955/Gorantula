package research

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
	"math"
	"strings"
	"testing"
)

func TestResearchValidationAndJoin(t *testing.T) {
	s, _ := verificationFixture(t)
	left, err := s.RegisterDataset("left", "synthetic", "id,mass [kg]\na,1\nb,2\nc,3\n")
	if err != nil {
		t.Fatal(err)
	}
	right, _ := s.RegisterDataset("right", "synthetic", "key,outcome\na,10\nb,20\nd,40\n")
	call := models.DatasetCall{Tool: "dataset-join", Column: "id", RightKey: "key", Operator: "left", Rationale: "Known synthetic key matching", DatasetID: right.ID}
	child, out, err := s.joinDatasets(left, right, call)
	if err != nil || child.Rows != 3 || out.Counts["unmatchedLeft"] != 1 || out.Counts["unmatchedRight"] != 1 || !strings.Contains(child.CSV, "c,3,\n") {
		t.Fatalf("join failed: %+v %v", out, err)
	}
	saved, _ := s.loadDataset(left.ID)
	if saved.CSV != left.CSV || child.OtherParentDigest != right.Digest {
		t.Fatal("provenance lost")
	}
	conflict, _ := s.RegisterDataset("conflict", "synthetic", "key,mass [g]\na,1000\nb,2000\n")
	if _, _, err := s.joinDatasets(left, conflict, call); err == nil {
		t.Fatal("unit mismatch accepted")
	}
	duplicate, _ := s.RegisterDataset("duplicate", "synthetic", "key,outcome\na,1\na,2\n")
	if _, _, err := s.joinDatasets(left, duplicate, call); err == nil {
		t.Fatal("many-to-many join allowed")
	}
	dirty, _ := s.RegisterDataset("dirty", "synthetic", "id,value\na,1\na,1\na,NA\nb,2kg\n")
	checked, err := validateDataset(dirty, models.DatasetCall{Tool: "dataset-validate", IDColumn: "id"})
	if err != nil || checked.Counts["duplicateRows"] != 1 || checked.Counts["repeatedIDs"] != 2 || len(checked.Warnings) < 3 {
		t.Fatalf("validation %+v %v", checked, err)
	}
}

func TestEvidenceLookupRetainsExactSource(t *testing.T) {
	body := "Prior text. Measured mass was 12 kg. Later text."
	out, err := lookupEvidence([]models.Paper{{ID: "paper", FullText: body, SourceURL: "https://example.org/paper"}}, models.DatasetCall{Tool: "evidence-lookup", Query: "mass was"})
	if err != nil || len(out.Passages) != 1 {
		t.Fatal(err, out)
	}
	p := out.Passages[0]
	if body[p.Offset:p.Offset+len(p.Text)] != p.Text || p.Digest != digestBytes([]byte(body)) {
		t.Fatal("source not exact")
	}
	out, err = lookupEvidence([]models.Paper{{FullText: body}}, models.DatasetCall{Query: "invented finding"})
	if err != nil || len(out.Passages) != 0 {
		t.Fatal("invented evidence")
	}
}

// A minimal text PDF gives the extraction test known cells and real page objects.
func researchFixturePDF() []byte {
	var stream strings.Builder
	cells := [][]string{{"group", "value"}, {"a", "1"}, {"a", "3"}, {"b", "9"}, {"b", "11"}}
	for i, row := range cells {
		for j, cell := range row {
			fmt.Fprintf(&stream, "BT /F1 12 Tf 1 0 0 1 %d %d Tm (%s) Tj ET\n", 50+j*150, 750-i*20, cell)
		}
	}
	objects := []string{"<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", stream.Len(), stream.String())}
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	offsets := []int{}
	for i, obj := range objects {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, obj)
	}
	start := b.Len()
	fmt.Fprintf(&b, "xref\n0 6\n0000000000 65535 f \n")
	for _, n := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", n)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", start)
	return b.Bytes()
}
func TestPDFExtractionAndTableSnapshot(t *testing.T) {
	s, _ := verificationFixture(t)
	raw := researchFixturePDF()
	run := models.VerificationRun{PaperSources: []string{"https://example.org/table.pdf"}}
	fetch := func(_ context.Context, u string) ([]byte, string, error) { return raw, u, nil }
	call := models.DatasetCall{Tool: "paper-extract", URL: run.PaperSources[0], Page: 1}
	out := s.executeDatasetCallWithFetcher(context.Background(), &run, call, fetch)
	if out.Error != "" || len(out.Tables) != 1 || out.Tables[0].Rows[4][1] != "11" || out.Passages[0].Page != 1 {
		t.Fatalf("PDF extraction %+v", out)
	}
	run.DatasetActions = append(run.DatasetActions, out)
	call.Tool = "paper-table"
	call.Rationale = "Synthetic PDF known-answer fixture"
	out = s.executeDatasetCallWithFetcher(context.Background(), &run, call, fetch)
	if out.Error != "" || run.Dataset.Rows != 4 || len(run.Documents) != 1 || run.Documents[0].Digest != digestBytes(raw) {
		t.Fatalf("table snapshot %+v", out)
	}
	computed := executeVerificationTool(context.Background(), run.Dataset, testVerificationCall("stats-reanalysis"))
	if computed.MeanDifference == nil || *computed.MeanDifference != 8 {
		t.Fatalf("extracted calculation %+v", computed)
	}
	if _, err := extractPDFPage(context.Background(), raw, call.URL, 2); err == nil {
		t.Fatal("nonexistent page accepted")
	}
	if _, err := extractPDFPage(context.Background(), []byte("not PDF"), call.URL, 1); err == nil {
		t.Fatal("invalid PDF accepted")
	}
}

func TestExtendedStatisticsKnownAnswers(t *testing.T) {
	data := models.ResearchDataset{CSV: "x,y\n1,5\n2,7\n3,9\n4,11\n5,13\n6,15\n"}
	for _, tool := range []string{"stats-regression", "stats-correlation", "stats-paired"} {
		call := testVerificationCall(tool)
		call.GroupColumn = "x"
		call.ValueColumn = "y"
		out := executeVerificationTool(context.Background(), data, call)
		if out.Status != "completed" {
			t.Fatalf("%s: %+v", tool, out)
		}
		switch tool {
		case "stats-regression":
			if math.Abs(out.Metrics["slope"]-2) > 1e-12 || math.Abs(out.Metrics["intercept"]-3) > 1e-12 || out.Metrics["rSquared"] != 1 {
				t.Fatal(out.Metrics)
			}
		case "stats-correlation":
			if out.Metrics["pearsonR"] != 1 {
				t.Fatal(out.Metrics)
			}
		case "stats-paired":
			if out.Metrics["meanDifference"] != 6.5 {
				t.Fatal(out.Metrics)
			}
		}
		again := executeVerificationTool(context.Background(), data, call)
		if again.OutputDigest != out.OutputDigest {
			t.Fatal("nondeterministic statistic")
		}
	}
	data.CSV = "group,value\na,1\na,2\na,3\na,4\nb,5\nb,6\nb,7\nb,8\n"
	out := executeVerificationTool(context.Background(), data, testVerificationCall("stats-effects"))
	if out.Status != "completed" || out.Metrics["meanDifference"] != 4 || math.Abs(out.Metrics["cohensD"]-4/math.Sqrt(5./3)) > 1e-12 {
		t.Fatalf("effects %+v", out)
	}
	if out.Intervals["meanDifference"][0] >= 4 || out.Intervals["meanDifference"][1] <= 4 {
		t.Fatal("invalid interval")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if out := executeVerificationTool(ctx, data, testVerificationCall("stats-effects")); out.Status != "failed" {
		t.Fatal("ignored cancellation")
	}
}

func TestResearchPreparationAndAgentReplay(t *testing.T) {
	s, req := verificationFixture(t)
	prep, err := s.prepareResearchData(context.Background(), preparationRequest{CandidateID: req.CandidateID, DatasetID: req.DatasetID, Call: models.DatasetCall{Tool: "dataset-validate"}})
	if err != nil {
		t.Fatal(err)
	}
	next, err := s.prepareResearchData(context.Background(), preparationRequest{CandidateID: req.CandidateID, DatasetID: req.DatasetID, SessionID: prep["sessionId"].(string), Call: models.DatasetCall{Tool: "dataset-inspect"}})
	if err != nil {
		t.Fatal(err)
	}
	if prep["sessionId"] == next["sessionId"] {
		t.Fatal("preparation snapshot overwritten")
	}
	d, err := s.RegisterDataset("regression", "synthetic", "x,y\n1,5\n2,7\n3,9\n4,11\n5,13\n6,15\n")
	if err != nil {
		t.Fatal(err)
	}
	turn := 0
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, prompt string, response interface{}) error {
		turn++
		var action models.VerificationAgentAction
		switch turn {
		case 1:
			action = models.VerificationAgentAction{Action: "dataset", DatasetCall: &models.DatasetCall{Tool: "dataset-validate"}}
		case 2:
			if !strings.Contains(prompt, "Validation completed") {
				t.Error("validation not sent to agent")
			}
			action = models.VerificationAgentAction{Action: "call", Call: &models.VerificationCall{Descriptive: true, Tool: "stats-regression", GroupColumn: "x", ValueColumn: "y", Statement: "Fit synthetic line", Rationale: "Known independent synthetic observations"}}
		default:
			if !strings.Contains(prompt, `"slope":2`) {
				t.Error("computed slope missing")
			}
			action = models.VerificationAgentAction{Action: "finish", Interpretation: "Synthetic fixture only."}
		}
		raw, _ := json.Marshal(action)
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
	if run.Status != "completed" {
		t.Fatalf("agent failed %+v", run)
	}
	results, err := ReplayVerificationBundle(context.Background(), run)
	if err != nil || len(results) != 1 || results[0].OutputDigest != run.Results[0].OutputDigest {
		t.Fatal("extended replay failed", err)
	}
}
