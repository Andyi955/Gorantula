package research

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/brain"
)

func TestGenerateDiscoveryQuestions(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	originalSearch := openDataFetch
	defer func() { openDataFetch = originalSearch }()
	openDataFetch = func(_ context.Context, _ string, _ int64) ([]byte, string, error) {
		return []byte(zenodoFixture), "", nil
	}
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, _ string, out interface{}) error {
		return json.Unmarshal([]byte(`{"questions":["Do species differ in body mass?","Does fertilizer increase crop yield?","  ","Do species differ in body mass?"]}`), out)
	}}}}
	got, err := s.generateDiscoveryQuestions(context.Background(), "ecology", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 valid unique questions, got %d (%v)", len(got), got)
	}
	if got[0] != "Do species differ in body mass" || strings.HasSuffix(got[0], "?") {
		t.Fatalf("question should be trailing-? trimmed: %q", got[0])
	}
}

func TestGenerateDiscoveryQuestionsEmpty(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	s.brain = &brain.Brain{ModelRouter: map[string]brain.ModelProvider{"deepseek": verificationModel{generate: func(_ context.Context, _ string, out interface{}) error {
		return json.Unmarshal([]byte(`{"questions":["","   "]}`), out)
	}}}}
	if _, err := s.generateDiscoveryQuestions(context.Background(), "x", 1); err == nil {
		t.Fatal("expected an error when no bounded question is proposed")
	}
}
