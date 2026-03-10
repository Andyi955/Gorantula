package brain

import (
	"context"
	"testing"
)

// MockProvider implements ModelProvider for testing
type MockProvider struct {
	NameFunc         func() string
	GenerateJSONFunc func(ctx context.Context, prompt string, target interface{}) error
}

func (m *MockProvider) Name() string        { return m.NameFunc() }
func (m *MockProvider) SupportsMedia() bool { return false }
func (m *MockProvider) GenerateJSON(ctx context.Context, prompt string, target interface{}) error {
	return m.GenerateJSONFunc(ctx, prompt, target)
}
func (m *MockProvider) GenerateContent(ctx context.Context, prompt string) (string, error) {
	return "Mock synthesis", nil
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
