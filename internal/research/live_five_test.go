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

func TestLiveFiveTrials(t *testing.T) {
	if os.Getenv("GORANTULA_FIVE_QA") != "1" {
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
	output := filepath.Join("..", "..", "local-test-docs", "phase3", "five-trials", "runs", time.Now().Format("20060102-150405"))
	if err := os.MkdirAll(output, 0755); err != nil {
		t.Fatal(err)
	}
	cases := []struct{ name, file, prompt string }{
		{"sleep", "sleep-wide", "Compare the sleep increases under drug 2 versus drug 1 for these patients. Quantify the difference with an appropriate analysis and explain what the study does and does not establish."},
		{"PlantGrowth", "PlantGrowth", "Compare all three plant growth conditions. Which has the highest mean dried weight, by how much versus control, and can the available analysis establish an overall treatment effect?"},
		{"ToothGrowth", "ToothGrowth", "At the 1 mg/day dose, compare odontoblast length for orange juice versus ascorbic acid. Quantify the difference and explain whether this supports a general claim that orange juice is superior at every dose."},
		{"airquality", "airquality", "Compare average measured ozone for each month in these New York observations. Explain missing readings and whether this establishes that the month itself causes ozone to change."},
		{"cars", "cars", "How does stopping distance relate to speed in these historical observations? Quantify a straight-line relationship if the available tools and evidence justify it, and assess whether it can predict stopping distances for modern cars at 70 mph."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			s := NewService(root, br)
			candidate := models.CandidateHypothesis{ID: "live-" + tc.name, Hypothesis: tc.prompt, State: "reviewed", PaperIDs: []string{"fixture-paper"}}
			if err := s.store.SaveCandidates([]models.CandidateHypothesis{candidate}); err != nil {
				t.Fatal(err)
			}
			base := "../../local-test-docs/phase3/five-trials/"
			paperBytes, err := os.ReadFile(base + tc.name + ".txt")
			if err != nil {
				t.Fatal(err)
			}
			url := "https://stat.ethz.ch/R-manual/R-devel/library/datasets/html/" + tc.name + ".html"
			if err := s.store.SavePapers([]models.Paper{{ID: "fixture-paper", Title: tc.name + " official R dataset documentation", SourceURL: url, FullText: string(paperBytes)}}); err != nil {
				t.Fatal(err)
			}
			csvBytes, err := os.ReadFile(base + tc.file + ".csv")
			if err != nil {
				t.Fatal(err)
			}
			provenance := "Public R datasets archive: https://vincentarelbundock.github.io/Rdatasets/csv/datasets/" + tc.name + ".csv ; documentation: " + url + ". Historical observations distributed with R, not simulated QA measurements."
			if tc.name == "sleep" {
				provenance += " Deterministic reshape of the original long table: matched by patient ID, group 1 extra becomes drug1, group 2 extra becomes drug2. No measurements changed; one patient per row."
			}
			d, err := s.RegisterDataset(tc.name, provenance, string(csvBytes))
			if err != nil {
				t.Fatal(err)
			}
			dataID := d.ID
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

			// Ground truth is used only after the model finishes, never in its prompt.
			if len(run.Results) == 0 {
				t.Error("requested quantitative answer was not computed")
			}
			for i, result := range run.Results {
				if result.Status != "completed" {
					if !calculationRecovered(result, run.Results[i+1:]) {
						t.Error("unresolved calculation failure")
					}
					continue
				}
				if result.PValue != nil || len(result.Intervals) > 0 {
					t.Error("sparse source documentation does not justify inference in these trials")
				}
				means := map[string]float64{}
				for _, g := range result.Groups {
					means[g.Name] = g.Mean
				}
				expected := map[string]float64{}
				switch tc.name {
				case "sleep":
					if math.Abs(result.Metrics["meanDifference"]-1.58) > 1e-9 {
						t.Error("paired difference mismatch")
					}
				case "cars":
					if math.Abs(result.Metrics["slope"]-3.9324087591240873) > 1e-9 {
						t.Error("regression mismatch")
					}
				case "PlantGrowth":
					expected = map[string]float64{"ctrl": 5.032, "trt1": 4.661, "trt2": 5.526}
				case "ToothGrowth":
					expected = map[string]float64{"OJ": 22.7, "VC": 16.77}
				case "airquality":
					expected = map[string]float64{"5": 23.615384615384617, "6": 29.444444444444443, "7": 59.11538461538461, "8": 59.96153846153846, "9": 31.448275862068964}
				}
				for group, value := range expected {
					if math.Abs(means[group]-value) > 1e-9 {
						t.Errorf("mean mismatch for %s", group)
					}
				}
			}

			if run.Status != "completed" {
				t.Errorf("live agent run failed: %s", run.Error)
			}

		})
	}
	fmt.Println("BUNDLES", output)
}
