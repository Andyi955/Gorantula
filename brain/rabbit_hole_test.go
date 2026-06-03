package brain

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"spider-agent/models"
)

func TestEvaluateRabbitHoleGatekeeperParsesContinueDecision(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			if !strings.Contains(prompt, "Gatekeeper") || !strings.Contains(prompt, "pass 1") {
				t.Fatalf("gatekeeper prompt missing expected context: %s", prompt)
			}
			decision := target.(*RabbitHoleGatekeeperDecision)
			decision.Continue = true
			decision.Reason = "Two credible open angles remain."
			decision.NoveltyScore = 0.82
			decision.SuggestedQueries = []string{
				"follow the procurement exception trail",
				"compare regulator statements with vendor disclosures",
				"",
			}
			return nil
		},
	}
	brain := &Brain{ModelRouter: map[string]ModelProvider{"deepseek": mock}}

	decision, err := brain.EvaluateRabbitHoleGatekeeper(context.Background(), RabbitHoleGatekeeperInput{
		OriginalPrompt: "AI regulatory capture",
		PassNumber:     1,
		Findings:       []string{"Initial pass found procurement exception claims."},
	})
	if err != nil {
		t.Fatalf("EvaluateRabbitHoleGatekeeper() error = %v", err)
	}

	if !decision.Continue {
		t.Fatal("expected gatekeeper to continue")
	}
	if decision.Reason != "Two credible open angles remain." {
		t.Fatalf("reason = %q", decision.Reason)
	}
	if decision.NoveltyScore != 0.82 {
		t.Fatalf("novelty score = %f", decision.NoveltyScore)
	}
	if len(decision.SuggestedQueries) != 2 {
		t.Fatalf("expected empty suggested query to be removed, got %#v", decision.SuggestedQueries)
	}
}

func TestEvaluateRabbitHoleGatekeeperStopsWhenModelReturnsNoAngles(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			decision := target.(*RabbitHoleGatekeeperDecision)
			decision.Continue = true
			decision.Reason = "All useful trails are exhausted."
			decision.NoveltyScore = 0.1
			decision.SuggestedQueries = []string{"   "}
			return nil
		},
	}
	brain := &Brain{ModelRouter: map[string]ModelProvider{"deepseek": mock}}

	decision, err := brain.EvaluateRabbitHoleGatekeeper(context.Background(), RabbitHoleGatekeeperInput{
		OriginalPrompt: "AI regulatory capture",
		PassNumber:     2,
		Findings:       []string{"Second pass repeated the same sources."},
	})
	if err != nil {
		t.Fatalf("EvaluateRabbitHoleGatekeeper() error = %v", err)
	}

	if decision.Continue {
		t.Fatalf("expected no useful suggested queries to force stop, got %#v", decision)
	}
	if !strings.Contains(strings.ToLower(decision.StopReason), "no new search angles") {
		t.Fatalf("stop reason = %q", decision.StopReason)
	}
}

func TestRabbitHoleRunLoggerWritesTraceFile(t *testing.T) {
	root := t.TempDir()
	logger, err := newRabbitHoleRunLoggerInRoot(root, "inv/rabbit:case", "run/one:two", "test prompt")
	if err != nil {
		t.Fatalf("newRabbitHoleRunLoggerInRoot() error = %v", err)
	}

	logger.Logf("pass %d planned %s", 1, RabbitHoleToolWebSearch)
	logger.WriteSection("Final Rabbit Hole Synthesis", "A concise synthesis body.")

	if !strings.HasPrefix(logger.Path(), root) {
		t.Fatalf("logger path %q was not inside root %q", logger.Path(), root)
	}
	if strings.Contains(filepath.Base(logger.Path()), "/") || strings.Contains(filepath.Base(logger.Path()), ":") {
		t.Fatalf("logger filename was not sanitized: %q", filepath.Base(logger.Path()))
	}

	body, err := os.ReadFile(logger.Path())
	if err != nil {
		t.Fatalf("failed to read logger output: %v", err)
	}
	text := string(body)
	for _, expected := range []string{
		"Rabbit Hole Run Trace",
		"Prompt: test prompt",
		"[RabbitHole] pass 1 planned web_search",
		"Final Rabbit Hole Synthesis",
		"A concise synthesis body.",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("expected log file to contain %q, got:\n%s", expected, text)
		}
	}
}

func TestSanitizeRabbitHoleToolPlanKeepsAgenticTools(t *testing.T) {
	plan := sanitizeRabbitHoleToolPlan(RabbitHoleToolPlan{
		Tasks: []RabbitHoleToolTask{
			{ID: "a", Tool: "web_search", Query: "AI data center water permits Virginia", Rationale: "Find current sources"},
			{ID: "b", Tool: "vault_search", Query: "data center grid strain", Rationale: "Compare old investigations"},
			{ID: "c", Tool: "timeline_context", Query: "timeline conflicts", Rationale: "Extract dates"},
			{ID: "d", Tool: "shell_exec", Query: "rm", Rationale: "bad"},
			{ID: "e", Tool: "web_search", Query: "AI data center water permits Virginia", Rationale: "duplicate"},
		},
	})

	if len(plan.Tasks) != 3 {
		t.Fatalf("expected 3 safe unique tasks, got %#v", plan.Tasks)
	}
	if plan.Tasks[0].ID != "rabbit-tool-1" || plan.Tasks[0].Tool != RabbitHoleToolWebSearch {
		t.Fatalf("first task not normalized: %#v", plan.Tasks[0])
	}
	if plan.Tasks[1].Tool != RabbitHoleToolVaultSearch {
		t.Fatalf("vault search task missing: %#v", plan.Tasks)
	}
	if plan.Tasks[2].Tool != RabbitHoleToolTimelineContext {
		t.Fatalf("timeline context task missing: %#v", plan.Tasks)
	}
}

func TestBuildRabbitHoleProvisionalNodeMarksClickableLiveTrail(t *testing.T) {
	node := buildRabbitHoleProvisionalNode(models.NutrientFlow{
		SourceURL: "https://example.com/data-center-report",
		Content:   "On 2026-05-21, regulators warned that data center water demand and grid strain were rising in Texas.",
	}, RabbitHoleToolTask{
		ID:        "rabbit-tool-1",
		Tool:      RabbitHoleToolWebSearch,
		Query:     "Texas data center water demand",
		Rationale: "Track local permitting pressure",
	}, "inv-rabbit", 2, 4)

	if node.Origin != "rabbit-hole" {
		t.Fatalf("origin = %q", node.Origin)
	}
	if node.RabbitState != RabbitHoleNodeStateProvisional {
		t.Fatalf("rabbit state = %q", node.RabbitState)
	}
	if node.RabbitTool != RabbitHoleToolWebSearch {
		t.Fatalf("rabbit tool = %q", node.RabbitTool)
	}
	if node.RabbitPass != 2 {
		t.Fatalf("rabbit pass = %d", node.RabbitPass)
	}
	if !strings.Contains(node.FullText, "Track local permitting pressure") {
		t.Fatalf("full text did not preserve tool rationale: %s", node.FullText)
	}
}

func TestBuildTaggedRabbitHoleProvisionalNodeUsesSummaryEntityTags(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			if !strings.Contains(prompt, "REQUIRED TAGGING") {
				t.Fatalf("expected Rabbit Hole tool node to use standard node tagging prompt: %s", prompt)
			}
			return json.Unmarshal([]byte(`{
				"title": "NERC Alert Conflict",
				"summary": "[ORG:NERC] issued a [DATE:2026-05-18] alert that conflicts with [ORG:Fermi America] project timing in [LOC:Texas]. [ORG:Meta] demand remains part of the load-pressure context."
			}`), target)
		},
	}
	brain := &Brain{ModelRouter: map[string]ModelProvider{"deepseek": mock}}
	t.Setenv("DEFAULT_SEARCH_MODEL", "deepseek")

	node := brain.buildTaggedRabbitHoleProvisionalNode(context.Background(), models.NutrientFlow{
		SourceURL: "timeline://rabbit-hole/NERC Level 3 alert",
		Content:   "Rabbit Hole timeline context for: NERC Level 3 alert May 2026 date conflict May 4 vs May 18. Fermi America and Meta are part of the load-pressure context in Texas.",
	}, RabbitHoleToolTask{
		ID:        "rabbit-tool-1",
		Tool:      RabbitHoleToolTimelineContext,
		Query:     "NERC Level 3 alert May 2026 date conflict May 4 vs May 18",
		Rationale: "Extract chronology",
	}, "inv-rabbit", 3, 1)

	if node.Title != "NERC Alert Conflict" {
		t.Fatalf("title = %q", node.Title)
	}
	if !strings.Contains(node.Summary, "[ORG:NERC]") || !strings.Contains(node.Summary, "[DATE:2026-05-18]") || !strings.Contains(node.Summary, "[LOC:Texas]") {
		t.Fatalf("expected tagged summary, got %q", node.Summary)
	}
	if !strings.Contains(node.FullText, "Rabbit tool: timeline_context") || !strings.Contains(node.FullText, "Fermi America and Meta") {
		t.Fatalf("full text should preserve tool metadata and original content, got %q", node.FullText)
	}
}

func TestSearchRabbitHoleVaultMemoryFindsOlderInvestigations(t *testing.T) {
	root := t.TempDir()
	oldVault := filepath.Join(root, "inv-old")
	currentVault := filepath.Join(root, "inv-current")
	if err := os.MkdirAll(oldVault, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(currentVault, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldVault, "crawl_old.md"), []byte("Virginia grid strain and data center water permit conflict with utility hearing."), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(currentVault, "crawl_current.md"), []byte("Current vault also mentions water permits."), 0644); err != nil {
		t.Fatal(err)
	}

	records := searchRabbitHoleVaultMemoryInRoot(root, "inv-current", "Virginia data center water grid permit", 3)

	if len(records) == 0 {
		t.Fatal("expected matching vault memory records")
	}
	if records[0].Tool != RabbitHoleToolVaultSearch {
		t.Fatalf("tool = %q", records[0].Tool)
	}
	if !strings.Contains(records[0].Source, "inv-old") {
		t.Fatalf("expected older vault source first, got %q", records[0].Source)
	}
	if !strings.Contains(records[0].Content, "Virginia grid strain") {
		t.Fatalf("content = %q", records[0].Content)
	}
	for _, record := range records {
		if strings.Contains(record.Source, "inv-current") {
			t.Fatalf("current vault memory should be injected as context, not surfaced as a new vault_search node: %#v", records)
		}
	}
}

func TestSearchRabbitHoleVaultMemorySkipsCurrentVaultReports(t *testing.T) {
	root := t.TempDir()
	currentVault := filepath.Join(root, "inv-current")
	if err := os.MkdirAll(currentVault, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(currentVault, "append_2026-05-27_15-44-27_rabbit_hole_deep.md"),
		[]byte("Meta Richland Parish Louisiana water permit grid pressure data center opposition FERC NERC Project Matador repeated entities."),
		0644,
	); err != nil {
		t.Fatal(err)
	}

	records := searchRabbitHoleVaultMemoryInRoot(root, "inv-current", "Meta Richland Parish Louisiana water permit grid pressure data center", 3)

	if len(records) != 0 {
		t.Fatalf("current vault Rabbit Hole reports should not be rebroadcast as new evidence nodes, got %#v", records)
	}
}

func TestBuildRabbitHoleTimelineContextExtractsChronology(t *testing.T) {
	context := buildRabbitHoleTimelineContext([]RabbitHoleEvidenceRecord{
		{
			Tool:    RabbitHoleToolWebSearch,
			Source:  "https://example.com/a",
			Content: "On 2026-05-21, a utility hearing covered water demand. A later 2026-06-02 filing discussed grid costs.",
		},
		{
			Tool:    RabbitHoleToolVaultSearch,
			Source:  "vault://inv-old/report.md",
			Content: "Older note from 2025-11-14 mentioned the same substation constraint.",
		},
	}, "data center water grid")

	if !strings.Contains(context.Content, "2025-11-14") || !strings.Contains(context.Content, "2026-06-02") {
		t.Fatalf("timeline context missing dates: %s", context.Content)
	}
	if context.Tool != RabbitHoleToolTimelineContext {
		t.Fatalf("tool = %q", context.Tool)
	}
}

func TestPlanRabbitHoleToolTasksUsesModelTools(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			if !strings.Contains(prompt, "web_search") || !strings.Contains(prompt, "vault_search") || !strings.Contains(prompt, "timeline_context") {
				t.Fatalf("planner prompt did not advertise tools: %s", prompt)
			}
			plan := target.(*RabbitHoleToolPlan)
			plan.Tasks = []RabbitHoleToolTask{
				{Tool: RabbitHoleToolVaultSearch, Query: "older AI infrastructure investigations", Rationale: "find historical echoes"},
				{Tool: RabbitHoleToolWebSearch, Query: "new AI data center grid strain", Rationale: "fresh sources"},
			}
			return nil
		},
	}
	brain := &Brain{ModelRouter: map[string]ModelProvider{"deepseek": mock}}

	tasks, err := brain.planRabbitHoleToolTasks(context.Background(), RabbitHolePlanningInput{
		OriginalPrompt: "AI data centers and utility pressure",
		PassNumber:     1,
	})
	if err != nil {
		t.Fatalf("planRabbitHoleToolTasks() error = %v", err)
	}

	if len(tasks) != 2 {
		t.Fatalf("tasks = %#v", tasks)
	}
	if tasks[0].Tool != RabbitHoleToolVaultSearch || tasks[1].Tool != RabbitHoleToolWebSearch {
		t.Fatalf("unexpected planned tasks: %#v", tasks)
	}
}
