package brain

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"spider-agent/models"
	"spider-agent/nervous_system"
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
			if strings.Contains(prompt, "strict entity extraction") {
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
			strings.Contains(payload, "Entity Hunter") &&
			strings.Contains(payload, "Timeline Analyst") {
			foundWarning = true
			break
		}
	}
	if !foundWarning {
		t.Fatalf("expected partial persona SYSTEM_LOG, got %#v", messages)
	}
}
