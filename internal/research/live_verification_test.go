package research

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
	"github.com/joho/godotenv"
)

func TestLiveResearchQA(t *testing.T) {
	if os.Getenv("GORANTULA_LIVE_QA") != "1" {
		t.Skip("explicit live QA only")
	}
	_ = godotenv.Load("../../.env")
	br := &brain.Brain{}
	router, err := brain.NewModelRouter(br)
	if err != nil {
		t.Fatal(err)
	}
	br.ModelRouter = router
	fmt.Println("LIVE PROVIDER", br.GetSearchProvider().Name())
	output := filepath.Join("..", "..", "local-test-docs", "phase3", "live-llm", time.Now().Format("20060102-150405"))
	if err := os.MkdirAll(output, 0755); err != nil {
		t.Fatal(err)
	}
	cases := []struct{ name, csv, prompt string }{
		{"numeric", "subject,x,y\ns1,1,5\ns2,2,7\ns3,3,9\ns4,4,11\ns5,5,13\ns6,6,15\n", "This is a synthetic software test. Find the literal source phrase 'observations are independent' using evidence lookup, validate subject IDs, then use correlation and simple regression on numeric x/y. Each row is one independent subject with two measurements. Report actual tool results and limitations; do not approve any research finding."},
		{"paired", "subject,before,after\ns1,1,3\ns2,2,4\ns3,3,5\ns4,4,6\ns5,5,7\ns6,6,8\n", "Synthetic software test: each row is one distinct independent subject, with a matched before and after measurement. Use dataset-validate with idColumn subject to check duplicate and missing IDs. Then use stats-paired with groupColumn before and valueColumn after, reporting the computed difference and interval. Do not claim these synthetic results are empirical evidence."},
		{"groups", "group,value\na,1\na,3\na,5\na,7\nb,9\nb,11\nb,13\nb,15\n", "This is a synthetic software test of independent groups. Inspect and validate the data, then run the independent-group permutation test, effect size with interval, and figure tool for group/value. Report actual results and keep software testing separate from empirical research."},
		{"join", "subject,value\na,1\nb,2\nc,3\nd,4\n", "Synthetic test: join the selected left dataset to the saved dataset named 'Join status labels' on subject, using inner join. Report unmatched counts. Keep only status=keep, inspect the subset, then plot mean value grouped by status. Do not use a two-group test. Keep provenance and explain row exclusions."},
		{"scanned-pdf", "", "Synthetic OCR test: use the uploaded PDF named 'Scanned research fixture'. First scan page 1 with paper-scan, then read its table using paper-complex-table: page 1, region [0,20,100,75], columnCuts [25], headerRows 1. Save the extracted table using its extractionId. Inspect it, exclude the Total row by filtering Sample ne Total, and plot Measurement grouped by Sample. Each group has one measurement so do not perform inferential statistics. Describe any OCR or layout problems honestly."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			s := NewService(root, br)
			candidate := models.CandidateHypothesis{ID: "live-" + tc.name, Hypothesis: tc.prompt, State: "reviewed", PaperIDs: []string{"fixture-paper"}}
			if err := s.store.SaveCandidates([]models.CandidateHypothesis{candidate}); err != nil {
				t.Fatal(err)
			}
			if err := s.store.SavePapers([]models.Paper{{ID: "fixture-paper", Title: "Synthetic fixture provenance", FullText: "This is a synthetic software validation dataset. The observations are independent across subjects. Values are not empirical research measurements."}}); err != nil {
				t.Fatal(err)
			}
			dataID := ""
			if tc.csv != "" {
				d, err := s.RegisterDataset(tc.name, "Synthetic software test, not research evidence", tc.csv)
				if err != nil {
					t.Fatal(err)
				}
				dataID = d.ID
			}
			if tc.name == "join" {
				if _, err := s.RegisterDataset("Join status labels", "Synthetic subject labels", "subject,status\na,keep\nb,keep\nc,drop\ne,keep\n"); err != nil {
					t.Fatal(err)
				}
			}
			if tc.name == "scanned-pdf" {
				raw := scannedFixturePDF()
				id := digestBytes(raw)
				doc := models.ResearchDocument{Name: "Scanned research fixture", URL: "local-pdf:" + id, Digest: id, Bytes: raw}
				if err := s.verificationStore("documents").saveSlice(id+".json", doc); err != nil {
					t.Fatal(err)
				}
			}
			previous := ""
			s.SetVerificationNotify(func(run models.VerificationRun) {
				progress := fmt.Sprintf("%s data=%d calculations=%d", run.Status, len(run.DatasetActions), len(run.Results))
				if progress != previous {
					fmt.Println("PROGRESS", tc.name, progress)
					previous = progress
				}
			})
			run, err := s.StartVerification(models.VerificationRequest{Mode: "agent", CandidateID: candidate.ID, DatasetID: dataID})
			if err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(150 * time.Second)
			for time.Now().Before(deadline) {
				time.Sleep(500 * time.Millisecond)
				run, err = s.GetVerificationRun(run.ID)
				if err != nil {
					t.Fatal(err)
				}
				if run.Status != "running" && run.Status != "queued" {
					break
				}
			}
			raw, _ := json.MarshalIndent(run, "", "  ")
			if err := os.WriteFile(filepath.Join(output, tc.name+".json"), raw, 0600); err != nil {
				t.Fatal(err)
			}
			for _, a := range run.DatasetActions {
				fmt.Println("DATA", tc.name, a.Call.Tool, a.Summary, a.Error)
			}
			for _, r := range run.Results {
				fmt.Println("RESULT", tc.name, r.Call.Tool, r.Status, r.Summary)
			}
			fmt.Println("INTERPRETATION", tc.name, run.Interpretation)
			fmt.Println("STATUS", tc.name, run.Status, run.Error)
			if len(run.Results) > 0 {
				replayed, err := ReplayVerificationBundle(context.Background(), run)
				matches := err == nil && len(replayed) == len(run.Results)
				for i, r := range replayed {
					if r.OutputDigest != run.Results[i].OutputDigest {
						matches = false
					}
				}
				fmt.Println("REPLAY", tc.name, matches)
				if !matches {
					t.Error("offline replay did not match live results")
				}
			}
			if run.Status != "completed" {
				t.Errorf("live agent run failed: %s", run.Error)
			}
			if tc.name == "numeric" {
				found := false
				for _, r := range run.Results {
					if r.Call.Tool == "stats-regression" && r.Metrics["slope"] == 2 && r.Metrics["intercept"] == 3 {
						found = true
					}
				}
				if !found {
					t.Error("expected regression not obtained")
				}
			}
			if tc.name == "paired" {
				found := false
				validated := false
				for _, r := range run.Results {
					if r.Call.Tool == "stats-paired" && r.Metrics["meanDifference"] == 2 {
						found = true
					}
				}
				for _, a := range run.DatasetActions {
					if a.Call.Tool == "dataset-validate" && a.Error == "" {
						validated = true
					}
				}
				if !found || !validated {
					t.Error("expected paired difference and validation not obtained")
				}
			}
			if tc.name == "groups" {
				found := false
				for _, r := range run.Results {
					if r.MeanDifference != nil && *r.MeanDifference == 8 {
						found = true
					}
				}
				if !found {
					t.Error("expected group difference not obtained")
				}
			}
			if tc.name == "join" && (run.Dataset.Rows != 2 || len(run.Results) != 1) {
				t.Error("expected two joined/filtered rows")
			}
			if tc.name == "scanned-pdf" && (!strings.Contains(run.Dataset.CSV, "42.75") || run.Dataset.Rows != 2 || len(run.Results) != 1) {
				t.Error("expected two extracted measurement rows")
			}
		})
	}
	fmt.Println("BUNDLES", output)
}
