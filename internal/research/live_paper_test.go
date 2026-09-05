package research

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
	"github.com/joho/godotenv"
)

func TestLivePaperTrial(t *testing.T) {
	if os.Getenv("GORANTULA_PAPER_QA") != "1" {
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
	output := filepath.Join("..", "..", "local-test-docs", "phase3", "real-paper", "runs", time.Now().Format("20060102-150405"))
	if err := os.MkdirAll(output, 0755); err != nil {
		t.Fatal(err)
	}
	csvBytes, err := os.ReadFile("../../local-test-docs/phase3/real-paper/penguins.csv")
	if err != nil {
		t.Fatal(err)
	}
	paperBytes, err := os.ReadFile("../../local-test-docs/phase3/real-paper/paper.txt")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct{ name, csv, prompt string }{
		{"adelie-mass", string(csvBytes), "Among the sampled adult Adelie penguins, how much heavier are males than females? Compare your findings with the attached paper and explain the limitations of the analysis and any causal conclusions. The selected dataset is the full simplified palmerpenguins dataset associated with this paper."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			s := NewService(root, br)
			candidate := models.CandidateHypothesis{ID: "live-" + tc.name, Hypothesis: tc.prompt, State: "reviewed", PaperIDs: []string{"fixture-paper"}}
			if err := s.store.SaveCandidates([]models.CandidateHypothesis{candidate}); err != nil {
				t.Fatal(err)
			}
			if err := s.store.SavePapers([]models.Paper{{ID: "fixture-paper", Title: "Ecological Sexual Dimorphism and Environmental Variability within a Community of Antarctic Penguins (Gorman et al., 2014)", SourceURL: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0090081", FullText: string(paperBytes)}}); err != nil {
				t.Fatal(err)
			}
			dataID := ""
			if tc.csv != "" {
				d, err := s.RegisterDataset(tc.name, "https://raw.githubusercontent.com/allisonhorst/palmerpenguins/main/inst/extdata/penguins.csv ; Provenance: https://allisonhorst.github.io/palmerpenguins/ identifies these as empirical measurements collected by Kristen Gorman and Palmer Station LTER, originally published in Gorman et al. 2014. The CC0 penguins table is a simplified version of penguins_raw, with 344 observations. Simplification does not imply simulated measurements; original analysis-specific eligibility subsets are not established by this metadata.", tc.csv)
				if err != nil {
					t.Fatal(err)
				}
				dataID = d.ID
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
			// These independent reference checks are never included in model context.
			found := false
			for _, result := range run.Results {
				if result.Status != "completed" || result.Call.Tool != "figure-reproduce" {
					t.Error("expected descriptive comparison without unmodeled independence")
				}
				if len(result.Groups) == 2 {
					found = result.Groups[0].Count == 73 && result.Groups[1].Count == 73 && math.Abs(result.Groups[0].Mean-3368.8356164383563) < 1e-8 && math.Abs(result.Groups[1].Mean-4043.4931506849316) < 1e-8
				}
			}
			if !found || run.Dataset.Rows != 146 {
				t.Error("reference means or complete-case counts not matched")
			}
			sourceRead := false
			for _, action := range run.DatasetActions {
				if action.Call.Tool == "evidence-lookup" && len(action.Passages) > 0 {
					sourceRead = true
				}
			}
			if !sourceRead {
				t.Error("paper comparison lacks retrieved evidence")
			}

			if run.Status != "completed" {
				t.Errorf("live agent run failed: %s", run.Error)
			}

		})
	}
	fmt.Println("BUNDLES", output)
}
