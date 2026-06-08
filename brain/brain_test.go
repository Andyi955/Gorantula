package brain

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/Andyi955/Gorantula/models"
	"github.com/Andyi955/Gorantula/nervous_system"
)

// MockProvider implements ModelProvider for testing
type MockProvider struct {
	NameFunc            func() string
	GenerateJSONFunc    func(ctx context.Context, prompt string, target interface{}) error
	ReviewImageJSONFunc func(ctx context.Context, prompt, mimeType string, imageData []byte, target interface{}) error
}

func (m *MockProvider) Name() string              { return m.NameFunc() }
func (m *MockProvider) SupportsMedia() bool       { return false }
func (m *MockProvider) SupportsImageReview() bool { return m.ReviewImageJSONFunc != nil }
func (m *MockProvider) GenerateJSON(ctx context.Context, prompt string, target interface{}) error {
	return m.GenerateJSONFunc(ctx, prompt, target)
}
func (m *MockProvider) GenerateContent(ctx context.Context, prompt string) (string, error) {
	return "Mock synthesis", nil
}
func (m *MockProvider) ReviewImageJSON(ctx context.Context, prompt, mimeType string, imageData []byte, target interface{}) error {
	if m.ReviewImageJSONFunc == nil {
		return nil
	}
	return m.ReviewImageJSONFunc(ctx, prompt, mimeType, imageData, target)
}

func TestRankAndFilterFacts(t *testing.T) {
	// Initialize Brain with mock provider
	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			// Simulate high score for relevant facts
			results := target.(*[]RankResult)
			*results = append(*results, RankResult{Score: 10, Reason: "Very relevant"})
			*results = append(*results, RankResult{Score: 2, Reason: "Security block"})
			return nil
		},
	}

	brain := &Brain{
		ModelRouter: map[string]ModelProvider{"mock": mock},
	}

	// Set env to use mock
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	facts := []string{"Relevant fact about AI", "Security access denied"}
	prompt := "Tell me about AI"

	result, err := brain.RankAndFilterFacts(context.Background(), prompt, facts)
	if err != nil {
		t.Fatalf("RankAndFilterFacts failed: %v", err)
	}

	if len(result) == 0 {
		t.Error("Expected relevant facts to be retained, but got empty result")
	}

	if result == facts[0]+"\n\n"+facts[1] {
		t.Error("Expected security block to be filtered out, but it was retained")
	}
}

func TestValidateSubQueries(t *testing.T) {
	brain := &Brain{}

	tests := []struct {
		name         string
		inputQueries []string
		minCount     int
		maxCount     int
		expectError  bool
	}{
		{
			name:         "Exactly 8 queries",
			inputQueries: []string{"q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"},
			minCount:     8,
			maxCount:     8,
			expectError:  false,
		},
		{
			name:         "Fewer than 4 - must pad",
			inputQueries: []string{"q1"},
			minCount:     4,
			maxCount:     4,
			expectError:  false,
		},
		{
			name:         "More than 12 - must truncate",
			inputQueries: []string{"q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "q11", "q12", "q13"},
			minCount:     12,
			maxCount:     12,
			expectError:  false,
		},
		{
			name:         "No queries - must error",
			inputQueries: []string{},
			minCount:     0,
			maxCount:     0,
			expectError:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			subQ := SubQueries{Queries: tt.inputQueries}
			err := brain.ValidateSubQueries(&subQ)

			if (err != nil) != tt.expectError {
				t.Errorf("ValidateSubQueries() error = %v; expectError %v", err, tt.expectError)
				return
			}

			if !tt.expectError {
				if len(subQ.Queries) < tt.minCount || len(subQ.Queries) > tt.maxCount {
					t.Errorf("ValidateSubQueries() count = %d; want between %d and %d", len(subQ.Queries), tt.minCount, tt.maxCount)
				}
			}
		})
	}
}

func TestCreateMergedInvestigation(t *testing.T) {
	tempDir := t.TempDir()
	origWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("failed to get working directory: %v", err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("failed to change to temp dir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(origWD)
	})

	if err := os.MkdirAll("abdomen_vault", 0755); err != nil {
		t.Fatalf("failed to create abdomen_vault: %v", err)
	}

	engine := NewSynthesisEngine(tempDir, make(chan SynthesisAlert, 1))
	brain := &Brain{Synthesis: engine}

	payload := models.MergeInvestigationsPayload{
		ChildVaultID: "merge-vault",
		ChildTopic:   "Merged Vault",
		ParentIDs:    []string{"vault-a", "vault-b"},
		Nodes: []models.MergedNode{
			{
				ID:               "merged-node-1",
				Title:            "Merged Intel",
				Summary:          "[PERSON:Alice] is linked.",
				FullText:         "[PERSON:Alice] is linked.",
				SourceVaultID:    "vault-a",
				SourceNodeID:     "node-a",
				DerivedFromMerge: true,
			},
		},
		Edges: []models.MergedEdge{
			{ID: "edge-1", Source: "merged-node-1", Target: "merged-node-1", Tag: "RELATED", Reasoning: "loopback"},
		},
	}

	t.Cleanup(func() {
		_ = os.RemoveAll(filepath.Join("abdomen_vault", payload.ChildVaultID))
	})

	if err := brain.CreateMergedInvestigation(context.Background(), payload); err != nil {
		t.Fatalf("CreateMergedInvestigation failed: %v", err)
	}

	metadataPath := filepath.Join("abdomen_vault", payload.ChildVaultID, "metadata.json")
	if _, err := os.Stat(metadataPath); err != nil {
		t.Fatalf("expected metadata.json to exist: %v", err)
	}

	if _, exists := brain.Synthesis.Index.NodeArchive[payload.ChildVaultID]["merged-node-1"]; !exists {
		t.Fatalf("expected merged node to be archived in synthesis engine")
	}
}

func TestNotifyImageReviewUnavailableBroadcastsWarning(t *testing.T) {
	mock := &MockProvider{
		NameFunc:         func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error { return nil },
	}

	var messages []models.WSMessage
	notifyImageReviewUnavailable(mock, func(msg models.WSMessage) {
		messages = append(messages, msg)
	})

	if len(messages) != 1 {
		t.Fatalf("expected 1 warning message, got %d", len(messages))
	}
	if messages[0].Type != "SYSTEM_LOG" {
		t.Fatalf("expected SYSTEM_LOG message, got %q", messages[0].Type)
	}
	if payload, _ := messages[0].Payload.(string); !strings.Contains(payload, "does not support multimodal image review") {
		t.Fatalf("expected unsupported image review warning, got %#v", messages[0].Payload)
	}
}

func TestProcessPromptWithNonGeminiProviderDoesNotRequireLegacyGeminiModel(t *testing.T) {
	t.Setenv("DEFAULT_SEARCH_MODEL", "deepseek")

	mock := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			return errors.New("planner unavailable")
		},
	}

	brain := &Brain{
		Model:       nil,
		NS:          nervous_system.NewNervousSystem(nil),
		Abdomen:     &models.Abdomen{},
		ModelRouter: map[string]ModelProvider{"deepseek": mock},
		tokenUsage:  newTokenUsageTracker(),
	}

	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("ProcessPrompt panicked with nil legacy Gemini model: %v", recovered)
		}
	}()

	_, err := brain.ProcessPromptWithOptions(context.Background(), "latest spacex news", false)
	if err == nil {
		t.Fatal("expected provider planning error")
	}
	if !strings.Contains(err.Error(), "failed to generate sub-queries") {
		t.Fatalf("expected planning error, got %v", err)
	}
}

func TestProcessLocalFilesForVaultBroadcastsVaultScopedMessages(t *testing.T) {
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock-local")
	t.Setenv("GORANTULA_NODE_SUMMARY_CONCURRENCY", "1")

	filePath := filepath.Join(t.TempDir(), "alpha.txt")
	if err := os.WriteFile(filePath, []byte("Alpha case file mentions [ORG:OpenAI] and a second corroborating local note."), 0o600); err != nil {
		t.Fatalf("failed to write local test file: %v", err)
	}

	var messagesMu sync.Mutex
	var messages []models.WSMessage
	mock := &MockProvider{
		NameFunc: func() string { return "mock-local" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			setNodeSummaryResponse(target, "Alpha Local File", "[ORG:OpenAI] appears in the local case file. A second local note corroborates the signal.")
			return nil
		},
	}
	brain := &Brain{
		NS: nervous_system.NewNervousSystem(func(msg models.WSMessage) {
			messagesMu.Lock()
			defer messagesMu.Unlock()
			messages = append(messages, msg)
		}),
		Abdomen:       &models.Abdomen{},
		ModelRouter:   map[string]ModelProvider{"mock-local": mock},
		tokenUsage:    newTokenUsageTracker(),
		AnalysisCache: NewAnalysisCache(t.TempDir()),
	}
	tracker := models.NewPipelineProgressTracker(
		"run-local-vault",
		"inv-local-vault",
		"local",
		models.LocalPipelineProgressSteps(),
	)
	t.Cleanup(func() {
		_ = os.RemoveAll(filepath.Join("abdomen_vault", "inv-local-vault"))
	})

	if _, err := brain.ProcessLocalFilesForVaultWithProgress(context.Background(), []string{filePath}, "inv-local-vault", tracker); err != nil {
		t.Fatalf("ProcessLocalFilesForVaultWithProgress failed: %v", err)
	}

	messagesMu.Lock()
	defer messagesMu.Unlock()

	foundNode := false
	foundSynthesis := false
	for _, msg := range messages {
		payload, _ := msg.Payload.(map[string]interface{})
		switch msg.Type {
		case "MEMORY_NODE_GATHERED":
			foundNode = true
			if payload["vaultId"] != "inv-local-vault" {
				t.Fatalf("expected local node payload vaultId, got %#v", payload)
			}
		case "SYNTHESIS_COMPLETE":
			foundSynthesis = true
			if payload["vaultId"] != "inv-local-vault" || payload["runId"] != "run-local-vault" {
				t.Fatalf("expected local synthesis payload to include vault/run metadata, got %#v", payload)
			}
		case models.PipelineProgressMessageType:
			progress, _ := msg.Payload.(models.PipelineProgressPayload)
			if progress.StepID == "complete" && progress.Status == models.PipelineStatusComplete {
				t.Fatalf("vault-scoped local ingestion should not complete the pipeline before relationship, theory, and discovery analysis")
			}
		}
	}
	if !foundNode {
		t.Fatal("expected local ingestion to broadcast a vault-scoped memory node")
	}
	if !foundSynthesis {
		t.Fatal("expected local ingestion to broadcast a vault-scoped synthesis completion")
	}
}

func TestGenerateJSONWithFallbackUsesAvailableNonGeminiProvider(t *testing.T) {
	primary := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			return errors.New("deepseek unavailable")
		},
	}
	fallback := &MockProvider{
		NameFunc: func() string { return "openai" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			response := target.(*SubQueries)
			response.Queries = []string{"fallback query"}
			return nil
		},
	}
	brain := &Brain{
		ModelRouter: map[string]ModelProvider{
			"deepseek": primary,
			"openai":   fallback,
		},
	}

	var response SubQueries
	if err := brain.generateJSONWithFallback(context.Background(), "planning", primary, "prompt", &response); err != nil {
		t.Fatalf("expected generic fallback to recover, got %v", err)
	}
	if len(response.Queries) != 1 || response.Queries[0] != "fallback query" {
		t.Fatalf("expected fallback response, got %#v", response.Queries)
	}
}

func TestRunPersonaAnalysisFallsBackToAvailableNonGeminiProvider(t *testing.T) {
	fallback := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			response := target.(*PersonaJSONResponse)
			response.KeyFindings = []string{"fallback persona"}
			response.Confidence = 0.8
			return nil
		},
	}
	brain := &Brain{
		ModelRouter: map[string]ModelProvider{
			"deepseek": fallback,
		},
	}

	insight, err := brain.runPersonaAnalysisWithPrompt(context.Background(), Persona{
		Name:        "Skeptic",
		ModelPref:   "missing-provider",
		Perspective: "Checks assumptions",
	}, "prompt")
	if err != nil {
		t.Fatalf("expected available non-Gemini provider to run persona, got %v", err)
	}
	if insight.KeyFindings[0] != "fallback persona" {
		t.Fatalf("expected fallback persona result, got %#v", insight.KeyFindings)
	}
}

func TestRunPersonaAnalysisFallsBackAfterMalformedJSONError(t *testing.T) {
	primary := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			return errors.New("invalid character ',' after object key")
		},
	}
	fallback := &MockProvider{
		NameFunc: func() string { return "openai" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			response := target.(*PersonaJSONResponse)
			response.KeyFindings = []string{"fallback recovered persona"}
			response.Confidence = 0.82
			return nil
		},
	}
	brain := &Brain{
		ModelRouter: map[string]ModelProvider{
			"deepseek": primary,
			"openai":   fallback,
		},
	}

	insight, err := brain.runPersonaAnalysisWithPrompt(context.Background(), Persona{
		Name:        "Entity Hunter",
		ModelPref:   "deepseek",
		Perspective: "Extracts entities",
	}, "prompt")
	if err != nil {
		t.Fatalf("expected fallback to recover malformed JSON, got %v", err)
	}
	if insight.KeyFindings[0] != "fallback recovered persona" {
		t.Fatalf("expected fallback insight, got %#v", insight.KeyFindings)
	}
}

func TestRunPersonaAnalysisRetriesMalformedJSONOnce(t *testing.T) {
	attempts := 0
	provider := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			attempts++
			if attempts == 1 {
				return errors.New("failed to parse JSON response: invalid character ',' after object key, original content: RAW_SECRET_EVIDENCE")
			}
			response := target.(*PersonaJSONResponse)
			response.KeyFindings = []string{"retry recovered persona"}
			response.Confidence = 0.88
			response.NodeIDs = []string{"node-1"}
			return nil
		},
	}
	brain := &Brain{
		ModelRouter: map[string]ModelProvider{"deepseek": provider},
	}

	insight, execution, err := brain.runPersonaAnalysisWithPromptDiagnostic(context.Background(), Persona{
		Name:        "Context Provider",
		ModelPref:   "deepseek",
		Perspective: "Adds context",
	}, "prompt")
	if err != nil {
		t.Fatalf("expected retry to recover malformed JSON, got %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected exactly one retry, got %d attempts", attempts)
	}
	if insight.KeyFindings[0] != "retry recovered persona" {
		t.Fatalf("expected retry insight, got %#v", insight.KeyFindings)
	}
	if execution.attemptCount != 2 || execution.recoveredErrorCategory != "json_parse" {
		t.Fatalf("expected retry metadata, got %#v", execution)
	}
	if strings.Contains(execution.errorSummary, "RAW_SECRET_EVIDENCE") {
		t.Fatalf("retry metadata leaked raw provider content: %#v", execution)
	}
}

func TestRunPersonaAnalysisFallsBackAfterDeadlineExceeded(t *testing.T) {
	primary := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			return context.DeadlineExceeded
		},
	}
	fallback := &MockProvider{
		NameFunc: func() string { return "openai" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			response := target.(*PersonaJSONResponse)
			response.KeyFindings = []string{"deadline fallback persona"}
			response.Confidence = 0.76
			return nil
		},
	}
	brain := &Brain{
		ModelRouter: map[string]ModelProvider{
			"deepseek": primary,
			"openai":   fallback,
		},
	}

	insight, err := brain.runPersonaAnalysisWithPrompt(context.Background(), Persona{
		Name:        "Timeline Analyst",
		ModelPref:   "deepseek",
		Perspective: "Orders events",
	}, "prompt")
	if err != nil {
		t.Fatalf("expected fallback to recover deadline error, got %v", err)
	}
	if insight.KeyFindings[0] != "deadline fallback persona" {
		t.Fatalf("expected fallback insight, got %#v", insight.KeyFindings)
	}
}

func TestGetDefaultPersonasUsesStrictJobBoundaries(t *testing.T) {
	personas := GetDefaultPersonas()
	names := make([]string, 0, len(personas))
	policies := make(map[string]PersonaConnectionPolicy)
	for _, persona := range personas {
		names = append(names, persona.Name)
		policies[persona.Name] = persona.ConnectionPolicy
	}

	expectedNames := []string{
		"Skeptic",
		"Connector",
		"Timeline Analyst",
		"Entity Mapper",
		"Context Brief",
		"Implications Mapper",
		"Evidence Triage",
	}
	if strings.Join(names, "|") != strings.Join(expectedNames, "|") {
		t.Fatalf("unexpected default persona names: %v", names)
	}

	for _, supportOnly := range []string{"Evidence Triage", "Entity Mapper", "Context Brief", "Implications Mapper"} {
		if policies[supportOnly] != PersonaConnectionPolicySupportOnly {
			t.Fatalf("expected %s to be support-only, got %q", supportOnly, policies[supportOnly])
		}
	}
	if policies["Connector"] != PersonaConnectionPolicyConnector {
		t.Fatalf("expected Connector policy, got %q", policies["Connector"])
	}
	if policies["Timeline Analyst"] != PersonaConnectionPolicyTemporal {
		t.Fatalf("expected Timeline Analyst temporal policy, got %q", policies["Timeline Analyst"])
	}
	if policies["Skeptic"] != PersonaConnectionPolicySkeptic {
		t.Fatalf("expected Skeptic policy, got %q", policies["Skeptic"])
	}

	prompt := BuildPersonaPrompt(personas[3], "[NodeID: node-1]\nSummary: test")
	if !strings.Contains(prompt, `"connections": []`) || !strings.Contains(prompt, `"proposedConnections": []`) {
		t.Fatalf("support-only prompt should instruct empty relationship fields, got:\n%s", prompt)
	}
}

func TestRunPersonaAnalysisEnforcesSupportOnlyPolicyAndCaps(t *testing.T) {
	keyFindings := make([]string, 0, 30)
	for idx := 0; idx < 30; idx++ {
		keyFindings = append(keyFindings, "Entity Name")
	}
	questions := make([]string, 0, 10)
	for idx := 0; idx < 10; idx++ {
		questions = append(questions, "Question?")
	}

	mock := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			response := target.(*PersonaJSONResponse)
			response.KeyFindings = keyFindings
			response.Connections = []string{"node-1 links to node-2"}
			response.ProposedConnections = []PersonaConnectionProposal{
				{Source: "node-1", Target: "node-2", Tag: "SHARED_ENTITY", Reasoning: "Both mention the same company.", EvidenceNodeIDs: []string{"node-1", "node-2"}, Confidence: 0.9},
			}
			response.Questions = questions
			response.Confidence = 0.85
			response.NodeIDs = []string{"node-1", "node-2"}
			return nil
		},
	}
	brain := &Brain{ModelRouter: map[string]ModelProvider{"deepseek": mock}}

	insight, err := brain.runPersonaAnalysisWithPrompt(context.Background(), Persona{
		Name:             "Entity Mapper",
		ModelPref:        "deepseek",
		Perspective:      "Extracts entities",
		ConnectionPolicy: PersonaConnectionPolicySupportOnly,
	}, "[NodeID: node-1]\nSummary: A\n\n[NodeID: node-2]\nSummary: B")
	if err != nil {
		t.Fatalf("runPersonaAnalysisWithPrompt failed: %v", err)
	}
	if len(insight.Connections) != 0 || len(insight.ProposedConnections) != 0 {
		t.Fatalf("expected support-only persona relationship fields to be cleared, got connections=%v proposals=%v", insight.Connections, insight.ProposedConnections)
	}
	if len(insight.KeyFindings) > 20 {
		t.Fatalf("expected Entity Mapper key findings to be capped, got %d", len(insight.KeyFindings))
	}
	if len(insight.Questions) > 5 {
		t.Fatalf("expected questions to be capped, got %d", len(insight.Questions))
	}
}

func TestRunPersonaAnalysisFiltersProposalsByPersonaPolicyAndNodeIDs(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			response := target.(*PersonaJSONResponse)
			response.KeyFindings = []string{"persona ok"}
			response.Confidence = 0.9
			response.NodeIDs = []string{"node-1", "node-2"}
			response.ProposedConnections = []PersonaConnectionProposal{
				{Source: "node-1", Target: "node-2", Tag: "CONTRACT_PRECEDES_LAUNCH", Reasoning: "The first event precedes the second event.", EvidenceNodeIDs: []string{"node-1", "node-2"}, Confidence: 0.8},
				{Source: "node-1", Target: "node-2", Tag: "CAUSES", Reasoning: "This causal edge is outside the timeline role.", EvidenceNodeIDs: []string{"node-1", "node-2"}, Confidence: 0.8},
				{Source: "node-10", Target: "node-2", Tag: "PRECEDES", Reasoning: "Uses a short made-up ID.", EvidenceNodeIDs: []string{"node-10", "node-2"}, Confidence: 0.8},
			}
			return nil
		},
	}
	brain := &Brain{ModelRouter: map[string]ModelProvider{"deepseek": mock}}

	insight, err := brain.runPersonaAnalysisWithPrompt(context.Background(), Persona{
		Name:             "Timeline Analyst",
		ModelPref:        "deepseek",
		Perspective:      "Orders events",
		ConnectionPolicy: PersonaConnectionPolicyTemporal,
	}, "[NodeID: node-1]\nSummary: First\n\n[NodeID: node-2]\nSummary: Second")
	if err != nil {
		t.Fatalf("runPersonaAnalysisWithPrompt failed: %v", err)
	}
	if len(insight.ProposedConnections) != 1 {
		t.Fatalf("expected only the valid temporal proposal to remain, got %#v", insight.ProposedConnections)
	}
	if insight.ProposedConnections[0].Tag != "CONTRACT_PRECEDES_LAUNCH" {
		t.Fatalf("unexpected surviving proposal: %#v", insight.ProposedConnections[0])
	}
}

func TestRunPersonaAnalysisDropsCategoryOnlyProposalTags(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			response := target.(*PersonaJSONResponse)
			response.KeyFindings = []string{"persona ok"}
			response.Confidence = 0.9
			response.NodeIDs = []string{"node-1", "node-2"}
			response.ProposedConnections = []PersonaConnectionProposal{
				{Source: "node-1", Target: "node-2", Tag: "COMMON_ENTITY", Reasoning: "Both nodes mention Samsung.", EvidenceNodeIDs: []string{"node-1", "node-2"}, Confidence: 0.9},
				{Source: "node-1", Target: "node-2", Tag: "SAME_EVENT", Reasoning: "Both nodes discuss the same launch.", EvidenceNodeIDs: []string{"node-1", "node-2"}, Confidence: 0.9},
				{Source: "node-1", Target: "node-2", Tag: "SAMSUNG_MEMORY_SHORTAGE", Reasoning: "The Samsung disruption maps to the DDR5 shortage.", EvidenceNodeIDs: []string{"node-1", "node-2"}, Confidence: 0.88},
			}
			return nil
		},
	}
	brain := &Brain{ModelRouter: map[string]ModelProvider{"deepseek": mock}}

	insight, err := brain.runPersonaAnalysisWithPrompt(context.Background(), Persona{
		Name:             "Connector",
		ModelPref:        "deepseek",
		Perspective:      "Finds direct links",
		ConnectionPolicy: PersonaConnectionPolicyConnector,
	}, "[NodeID: node-1]\nSummary: Samsung strike\n\n[NodeID: node-2]\nSummary: DDR5 shortage")
	if err != nil {
		t.Fatalf("runPersonaAnalysisWithPrompt failed: %v", err)
	}
	if len(insight.ProposedConnections) != 1 {
		t.Fatalf("expected only the specific proposal to remain, got %#v", insight.ProposedConnections)
	}
	if insight.ProposedConnections[0].Tag != "SAMSUNG_MEMORY_SHORTAGE" {
		t.Fatalf("unexpected surviving proposal: %#v", insight.ProposedConnections[0])
	}
}

func TestAnalyzeWithPersonasBroadcastsPartialCompletionWarning(t *testing.T) {
	t.Setenv("DEFAULT_PERSONA_MODEL", "deepseek")

	var messagesMu sync.Mutex
	var messages []models.WSMessage
	mock := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			if strings.Contains(prompt, "timeline specialist") {
				return context.DeadlineExceeded
			}
			if strings.Contains(prompt, "strict entity mapping") {
				return errors.New("invalid character ',' after object key")
			}
			response := target.(*PersonaJSONResponse)
			response.KeyFindings = []string{"persona ok"}
			response.Confidence = 0.7
			response.NodeIDs = []string{"node-1"}
			return nil
		},
	}
	brain := &Brain{
		NS: nervous_system.NewNervousSystem(func(msg models.WSMessage) {
			messagesMu.Lock()
			defer messagesMu.Unlock()
			messages = append(messages, msg)
		}),
		ModelRouter: map[string]ModelProvider{"deepseek": mock},
		tokenUsage:  newTokenUsageTracker(),
	}

	insights, err := brain.AnalyzeWithPersonas(context.Background(), "inv-partial", []models.MemoryNode{
		{ID: "node-1", Title: "Node", Summary: "Summary"},
	})
	if err != nil {
		t.Fatalf("expected partial persona analysis to continue, got %v", err)
	}
	if len(insights) != 5 {
		t.Fatalf("expected 5 successful insights, got %d", len(insights))
	}

	messagesMu.Lock()
	defer messagesMu.Unlock()
	foundWarning := false
	for _, msg := range messages {
		payload, _ := msg.Payload.(string)
		if msg.Type == "SYSTEM_LOG" &&
			strings.Contains(payload, "Partial persona analysis completed: 5/7 personas succeeded") &&
			strings.Contains(payload, "Entity Mapper") &&
			strings.Contains(payload, "Timeline Analyst") {
			foundWarning = true
			break
		}
	}
	if !foundWarning {
		t.Fatalf("expected partial persona SYSTEM_LOG, got %#v", messages)
	}
}

func TestAnalyzeWithPersonasRecordsPersonaDiagnostics(t *testing.T) {
	t.Setenv("DEFAULT_PERSONA_MODEL", "deepseek")

	mock := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			if strings.Contains(prompt, "timeline specialist") {
				return context.DeadlineExceeded
			}
			if strings.Contains(prompt, "strict entity mapping") {
				return errors.New("failed to parse JSON response: unexpected end of JSON input, original content: RAW_SECRET_EVIDENCE")
			}
			response := target.(*PersonaJSONResponse)
			response.KeyFindings = []string{"persona ok"}
			response.Confidence = 0.7
			response.NodeIDs = []string{"node-1"}
			return nil
		},
	}
	brain := &Brain{
		ModelRouter: map[string]ModelProvider{"deepseek": mock},
		tokenUsage:  newTokenUsageTracker(),
	}
	tracker := models.NewPipelineProgressTracker(
		"run-persona-diagnostics",
		"inv-persona-diagnostics",
		"web",
		models.DefaultPipelineProgressSteps(),
	)

	insights, err := brain.AnalyzeWithPersonasWithProgress(context.Background(), "inv-persona-diagnostics", []models.MemoryNode{
		{ID: "node-1", Title: "Node", Summary: "Summary with RAW_SECRET_EVIDENCE"},
	}, tracker)
	if err != nil {
		t.Fatalf("expected partial persona analysis to continue, got %v", err)
	}
	if len(insights) != 5 {
		t.Fatalf("expected 5 successful insights, got %d", len(insights))
	}

	profile := tracker.Profile()
	if len(profile.PersonaDiagnostics) != len(GetDefaultPersonas()) {
		t.Fatalf("expected one diagnostic per persona, got %#v", profile.PersonaDiagnostics)
	}

	var timelineFailure *models.PipelinePersonaDiagnostic
	var entityFailure *models.PipelinePersonaDiagnostic
	var connectorSuccess *models.PipelinePersonaDiagnostic
	for index := range profile.PersonaDiagnostics {
		diagnostic := &profile.PersonaDiagnostics[index]
		switch diagnostic.PersonaName {
		case "Timeline Analyst":
			timelineFailure = diagnostic
		case "Entity Mapper":
			entityFailure = diagnostic
		case "Connector":
			connectorSuccess = diagnostic
		}
	}

	if timelineFailure == nil || timelineFailure.Status != "failed" || timelineFailure.ErrorCategory != "timeout" {
		t.Fatalf("expected timeout diagnostic for Timeline Analyst, got %#v", timelineFailure)
	}
	if timelineFailure.Mode != "full_board" || timelineFailure.Provider != "deepseek" || timelineFailure.PreferredProvider != "deepseek" {
		t.Fatalf("unexpected Timeline Analyst provider metadata: %#v", timelineFailure)
	}
	if timelineFailure.PromptChars <= 0 || timelineFailure.NodeCount != 1 || timelineFailure.PendingNodeCount != 0 {
		t.Fatalf("unexpected Timeline Analyst prompt/run metadata: %#v", timelineFailure)
	}
	if entityFailure == nil || entityFailure.Status != "failed" || entityFailure.ErrorCategory != "json_parse" {
		t.Fatalf("expected JSON parse diagnostic for Entity Mapper, got %#v", entityFailure)
	}
	if entityFailure.AttemptCount != 2 {
		t.Fatalf("expected Entity Mapper to record a JSON retry attempt, got %#v", entityFailure)
	}
	if strings.Contains(entityFailure.ErrorSummary, "RAW_SECRET_EVIDENCE") {
		t.Fatalf("entity failure leaked raw provider content: %#v", entityFailure)
	}
	if connectorSuccess == nil || connectorSuccess.Status != "success" || connectorSuccess.Confidence != 0.7 || connectorSuccess.KeyFindingCount != 1 {
		t.Fatalf("expected success diagnostic for Connector, got %#v", connectorSuccess)
	}
}

func TestAnalyzeIncrementalWithPersonasRecordsPendingPersonaDiagnostics(t *testing.T) {
	t.Setenv("DEFAULT_PERSONA_MODEL", "deepseek")

	mock := &MockProvider{
		NameFunc: func() string { return "deepseek" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			response := target.(*PersonaJSONResponse)
			response.KeyFindings = []string{"incremental persona ok"}
			response.Confidence = 0.8
			response.NodeIDs = []string{"node-pending"}
			return nil
		},
	}
	brain := &Brain{
		ModelRouter: map[string]ModelProvider{"deepseek": mock},
		tokenUsage:  newTokenUsageTracker(),
	}
	tracker := models.NewPipelineProgressTracker(
		"run-incremental-persona-diagnostics",
		"inv-incremental-persona-diagnostics",
		"web",
		models.DefaultPipelineProgressSteps(),
	)

	insights, err := brain.AnalyzeIncrementalWithPersonasWithProgress(context.Background(), "inv-incremental-persona-diagnostics", []models.MemoryNode{
		{ID: "node-existing", Title: "Existing", Summary: "Context"},
		{ID: "node-pending", Title: "Pending", Summary: "New evidence"},
	}, []string{"node-pending"}, tracker)
	if err != nil {
		t.Fatalf("expected incremental persona analysis to succeed, got %v", err)
	}
	if len(insights) != len(GetDefaultPersonas()) {
		t.Fatalf("expected all incremental personas to succeed, got %d", len(insights))
	}

	profile := tracker.Profile()
	if len(profile.PersonaDiagnostics) != len(GetDefaultPersonas()) {
		t.Fatalf("expected one incremental diagnostic per persona, got %#v", profile.PersonaDiagnostics)
	}
	for _, diagnostic := range profile.PersonaDiagnostics {
		if diagnostic.Mode != "incremental" || diagnostic.Status != "success" {
			t.Fatalf("unexpected incremental diagnostic status: %#v", diagnostic)
		}
		if diagnostic.NodeCount != 2 || diagnostic.PendingNodeCount != 1 || diagnostic.PromptChars <= 0 {
			t.Fatalf("unexpected incremental diagnostic metadata: %#v", diagnostic)
		}
	}
}
