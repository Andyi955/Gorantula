package research

import (
	"context"
	"encoding/json"
	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
	"net"
	"strings"
	"testing"
)

func TestDatasetInspectionAndImmutableFilter(t *testing.T) {
	s, _ := verificationFixture(t)
	original := "group,value\na,1\na,3\nb,NA\nb,9\nb,11\nc,text\n"
	d, err := s.RegisterDataset("Known values", "Synthetic unit-test fixture", original)
	if err != nil {
		t.Fatal(err)
	}
	inspected, err := inspectDataset(d)
	if err != nil {
		t.Fatal(err)
	}
	col := inspected.Columns[1]
	if col.Missing != 1 || col.Numeric != 4 || col.Text != 1 || *col.Min != 1 || *col.Max != 11 {
		t.Fatalf("bad inspection: %+v", col)
	}
	call := models.DatasetCall{Tool: "dataset-filter", Column: "value", Operator: "gte", Value: "0", Rationale: "Synthetic fixture: keep numeric observations only"}
	run := models.VerificationRun{Dataset: d}
	result := s.executeDatasetCall(context.Background(), &run, call)
	if result.Error != "" || run.Dataset.Rows != 4 || run.Dataset.ParentID != d.ID || run.Dataset.ParentDigest != d.Digest || len(run.DatasetParents) != 1 {
		t.Fatalf("filter: %+v %+v", result, run.Dataset)
	}
	saved, err := s.loadDataset(d.ID)
	if err != nil || saved.CSV != original {
		t.Fatal("original changed", err)
	}
	computed := executeVerificationTool(context.Background(), run.Dataset, testVerificationCall("stats-reanalysis"))
	if computed.MeanDifference == nil || *computed.MeanDifference != 8 {
		t.Fatalf("expected difference 8: %+v", computed)
	}
	run.Results = append(run.Results, computed)
	if got := s.executeDatasetCall(context.Background(), &run, call); got.Error == "" {
		t.Fatal("post-result filtering allowed")
	}
	for _, op := range []string{"shell", "gt"} {
		bad := call
		bad.Operator = op
		bad.Value = "NaN"
		if _, err := s.filterDataset(d, bad); err == nil {
			t.Fatal("invalid filter accepted")
		}
	}
}

func TestDatasetDiscoveryAndPublicNetworkBoundary(t *testing.T) {
	links := datasetLinks([]byte(`<a href="/data.csv">Data</a><a href="/data.csv">Duplicate</a><a href="supplement">Supplement</a><a href="javascript:alert(1)">dataset</a><a href="/about">About</a>`), "https://example.org/paper")
	if len(links) != 2 || links[0] != "https://example.org/data.csv" || links[1] != "https://example.org/supplement" {
		t.Fatalf("unexpected links %v", links)
	}
	for _, address := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "100.100.100.200", "::1", "::ffff:127.0.0.1", "fc00::1", "198.18.0.1", "64:ff9b::7f00:1"} {
		if publicDatasetIP(net.ParseIP(address)) {
			t.Fatal("nonpublic address accepted", address)
		}
	}
	if !publicDatasetIP(net.ParseIP("8.8.8.8")) {
		t.Fatal("public address rejected")
	}
	for _, u := range []string{"file:///etc/passwd", "http://user:pass@example.org", "http://127.0.0.1:8080/data.csv", "http://127.0.0.1/data.csv"} {
		if _, _, err := fetchDatasetURL(context.Background(), u); err == nil {
			t.Fatal("unsafe URL accepted", u)
		}
	}
	s, _ := verificationFixture(t)
	run := models.VerificationRun{}
	if got := s.executeDatasetCall(context.Background(), &run, models.DatasetCall{Tool: "dataset-import", URL: "https://example.org/invented.csv"}); got.Error == "" {
		t.Fatal("unobserved URL allowed")
	}
}

func TestDatasetAgentFiltersThenReplays(t *testing.T) {
	s, req := verificationFixture(t)
	turn := 0
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, prompt string, response interface{}) error {
		turn++
		var action models.VerificationAgentAction
		switch turn {
		case 1:
			action = models.VerificationAgentAction{Action: "dataset", DatasetCall: &models.DatasetCall{Tool: "dataset-inspect"}}
		case 2:
			if !strings.Contains(prompt, `"numeric":`) {
				t.Error("inspection missing from model context")
			}
			action = models.VerificationAgentAction{Action: "dataset", DatasetCall: &models.DatasetCall{Tool: "dataset-filter", Column: "value", Operator: "gte", Value: "0", Rationale: "Known fixture uses nonnegative values"}}
		case 3:
			c := testVerificationCall("stats-reanalysis")
			c.Descriptive = true
			action = models.VerificationAgentAction{Action: "call", Call: &c}
		default:
			action = models.VerificationAgentAction{Action: "finish", Interpretation: "Synthetic fixture only."}
		}
		raw, _ := json.Marshal(action)
		return json.Unmarshal(raw, response)
	}}}}
	req.Mode = "agent"
	req.Calls = nil
	started, err := s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	run := awaitVerification(t, s, started.ID)
	if run.Status != "completed" || len(run.DatasetActions) != 2 || run.Dataset.ParentID != req.DatasetID {
		t.Fatalf("agent dataset flow: %+v", run)
	}
	replay, err := s.StartVerification(models.VerificationRequest{Mode: "replay", ReplayOf: run.ID})
	if err != nil {
		t.Fatal(err)
	}
	finished := awaitVerification(t, s, replay.ID)
	if finished.ReplayMatches == nil || !*finished.ReplayMatches {
		t.Fatalf("replay differs %+v", finished)
	}
	// An agent may identify a data gap without requiring a dummy CSV.
	req.DatasetID = ""
	started, err = s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	if got := awaitVerification(t, s, started.ID); got.Status != "completed" {
		t.Fatal(got.Error)
	}
}

func TestDatasetObservedDiscoveryImportAndMissingSource(t *testing.T) {
	s, _ := verificationFixture(t)
	run := models.VerificationRun{PaperSources: []string{"https://example.org/paper"}}
	raw := "group,value\na,1\na,3\nb,9\nb,11\n"
	fetch := func(_ context.Context, u string) ([]byte, string, error) {
		if strings.HasSuffix(u, "/paper") {
			return []byte(`<a href="/measurements.csv">Dataset</a>`), u, nil
		}
		return []byte(raw), u, nil
	}
	result := s.executeDatasetCallWithFetcher(context.Background(), &run, models.DatasetCall{Tool: "dataset-discover", URL: run.PaperSources[0]}, fetch)
	if result.Error != "" || len(result.Links) != 1 {
		t.Fatalf("discovery: %+v", result)
	}
	run.DatasetActions = append(run.DatasetActions, result)
	result = s.executeDatasetCallWithFetcher(context.Background(), &run, models.DatasetCall{Tool: "dataset-import", URL: result.Links[0]}, fetch)
	if result.Error != "" || run.Dataset.CSV != raw || run.Dataset.Digest != digestBytes([]byte(raw)) || !strings.Contains(run.Dataset.Source, "origin unverified") {
		t.Fatalf("import: %+v", result)
	}
	if _, err := s.RegisterDataset("bad", "invalid UTF-8", string([]byte{'a', ',', 'b', '\n', '1', ',', 255, '\n', '2', ',', '3'})); err == nil {
		t.Fatal("invalid UTF-8 lost original bytes")
	}
}

// Recovery must retain the failed input for replay and lock only after success.
func TestFailedCalculationRecoveryReplay(t *testing.T) {
	s, req := verificationFixture(t)
	d, err := s.RegisterDataset("missing", "empirical source", "group,value\na,1\na,3\nb,NA\nb,9\nb,11\n")
	if err != nil {
		t.Fatal(err)
	}
	req.DatasetID = d.ID
	req.Calls = []models.VerificationCall{testVerificationCall("stats-reanalysis")}
	run, err := s.StartVerification(req)
	if err != nil {
		t.Fatal(err)
	}
	run = awaitVerification(t, s, run.ID)
	if len(run.Results) != 1 || run.Results[0].Status != "failed" {
		t.Fatalf("expected failure: %+v", run.Results)
	}
	filter := models.DatasetCall{Tool: "dataset-filter", Column: "value", Operator: "not-missing", Rationale: "Exclude missing outcome"}
	if got := s.executeDatasetCall(context.Background(), &run, filter); got.Error != "" {
		t.Fatal(got.Error)
	}
	run.Results = append(run.Results, executeVerificationTool(context.Background(), run.Dataset, testVerificationCall("stats-reanalysis")))
	if run.Results[1].Status != "completed" {
		t.Fatal(run.Results[1])
	}
	if got := s.executeDatasetCall(context.Background(), &run, filter); got.Error == "" {
		t.Fatal("successful result must freeze input")
	}
	replay, err := ReplayVerificationBundle(context.Background(), run)
	if err != nil {
		t.Fatal(err)
	}
	for i := range replay {
		if replay[i].OutputDigest != run.Results[i].OutputDigest {
			t.Fatal("replay lost original input")
		}
	}
	run.DatasetParents[0].CSV += "tamper"
	if _, err := ReplayVerificationBundle(context.Background(), run); err == nil {
		t.Fatal("tampered parent accepted")
	}
}
