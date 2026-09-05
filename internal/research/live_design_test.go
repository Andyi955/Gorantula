package research

import (
	"context"
	"encoding/json"
	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
	"github.com/joho/godotenv"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Adversarial sources are synthetic software fixtures, not empirical evidence.
func TestLiveDesignCritique(t *testing.T) {
	if os.Getenv("GORANTULA_DESIGN_QA") != "1" {
		t.Skip("explicit live review only")
	}
	_ = godotenv.Load("../../.env")
	br := &brain.Brain{}
	router, err := brain.NewModelRouter(br)
	if err != nil {
		t.Fatal(err)
	}
	br.ModelRouter = router
	root := filepath.Join("../../local-test-docs/phase3/design-review", time.Now().Format("20060102-150405"))
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	positive := "This is a synthetic software fixture. Four subjects were independently sampled, each from a separate environment with no shared cluster. One response value was measured per subject, with no repeated measurements and no pairing. Subject identifiers a,b,c,d identify the four distinct subjects, not row numbers. Two subjects were randomly assigned to each of groups x and y; allocation was exchangeable under the identical-distribution null. Measurements are response units and each row represents one subject."
	for _, tc := range []struct {
		name, quote, source string
		accept              bool
	}{
		{"supported", positive, positive, true},
		{"count-is-not-independence", "We recorded four measurements in this study.", "We recorded four measurements in this study. The same two subjects were measured twice; identifiers a,b,c,d label measurement records, not distinct subjects.", false},
		{"contradiction-elsewhere", positive, positive + " Correction to the methods: all four subjects were from the same household, and their outcomes shared a household-level intervention; the earlier statement of separate environments is incorrect.", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := NewService(t.TempDir(), br)
			d, err := s.RegisterDataset("fixture", "Synthetic study-design QA", "subject,group,value\na,x,1\nb,x,2\nc,y,3\nd,y,4\n")
			if err != nil {
				t.Fatal(err)
			}
			call := testVerificationCall("stats-reanalysis")
			call.Design = &models.StudyDesign{PaperID: "p", Quote: tc.quote, Unit: "subject", Structure: "independent", Independence: "documented", Basis: "Planner asserts source supports independent subjects", Limitations: "Synthetic fixture only", IDColumn: "subject"}
			values := []string{"response value", "one subject", "none", "none", "none", "randomized", "independent units"}
			for i, name := range designFactNames {
				call.Design.Facts = append(call.Design.Facts, models.DesignFact{Name: name, Value: values[i], PaperID: "p", Quote: tc.quote})
			}
			run := models.VerificationRun{Dataset: d, Papers: []models.Paper{{ID: "p", FullText: tc.source}}, DatasetActions: []models.DatasetResult{{Call: models.DatasetCall{Tool: "evidence-lookup"}, Passages: []models.EvidencePassage{{PaperID: "p", Text: tc.quote}}}}}
			err = s.reviewAgentDesign(context.Background(), &run, call)
			raw, _ := json.MarshalIndent(run, "", "  ")
			if e := os.WriteFile(filepath.Join(root, tc.name+".json"), raw, 0600); e != nil {
				t.Fatal(e)
			}
			t.Logf("accepted=%v review=%+v", err == nil, run.StudyReviews)
			if (err == nil) != tc.accept {
				t.Errorf("unexpected review outcome: %v", err)
			}
		})
	}
	t.Log("bundles", root)
}
