package brain

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Andyi955/Gorantula/models"
)

func TestAnalyzeWithPersonasThrottlesConcurrency(t *testing.T) {
	var inFlight, maxInFlight int64
	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			current := atomic.AddInt64(&inFlight, 1)
			for {
				observed := atomic.LoadInt64(&maxInFlight)
				if current <= observed || atomic.CompareAndSwapInt64(&maxInFlight, observed, current) {
					break
				}
			}
			time.Sleep(120 * time.Millisecond)
			atomic.AddInt64(&inFlight, -1)
			target.(*PersonaJSONResponse).Confidence = 0.8
			target.(*PersonaJSONResponse).FullAnalysis = "Throttled analysis."
			return nil
		},
	}
	brain := &Brain{
		ModelRouter: map[string]ModelProvider{"mock": mock},
	}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	insights, err := brain.AnalyzeWithPersonasWithProgress(context.Background(), "inv-test", []models.MemoryNode{}, nil)
	if err != nil {
		t.Fatalf("AnalyzeWithPersonasWithProgress failed: %v", err)
	}
	if len(insights) != 7 {
		t.Fatalf("expected all seven persona insights, got %d", len(insights))
	}
	if maxInFlight > personaMaxConcurrency {
		t.Fatalf("expected at most %d concurrent personas, got %d", personaMaxConcurrency, maxInFlight)
	}
	if maxInFlight < 2 {
		t.Fatalf("expected personas to still run in parallel, got max concurrency %d", maxInFlight)
	}
	if maxInFlight == int64(len(GetDefaultPersonas())) {
		t.Fatalf("expected the cap to keep at least one persona from launching simultaneously, got max %d", maxInFlight)
	}
}

func TestSanitizePersonaPromptForFilterSoftensTriggerWords(t *testing.T) {
	prompt := `You are analyzing investigation findings.
The report mentions war casualties, military attacks, propaganda and misinformation campaigns, protests, and sanctions.
CONTEXT BLOCK:
{"keyFindings": ["..."], "connections": []}
Respond ONLY with the JSON described above.`

	sanitized := sanitizePersonaPromptForFilter(prompt)

	if !strings.Contains(sanitized, "armed conflict") || !strings.Contains(sanitized, "humanitarian impact figures") {
		t.Fatalf("expected trigger wording to be softened, got: %s", sanitized)
	}
	if !strings.Contains(sanitized, "information campaigns") || !strings.Contains(sanitized, "unverified claims") {
		t.Fatalf("expected propaganda/misinformation to be softened, got: %s", sanitized)
	}
	if !strings.Contains(sanitized, "public demonstrations") || !strings.Contains(sanitized, "economic restrictions") {
		t.Fatalf("expected protests/sanctions to be softened, got: %s", sanitized)
	}
	if !strings.Contains(sanitized, "defense forces") {
		t.Fatalf("expected military to be softened, got: %s", sanitized)
	}
	if trigger := regexp.MustCompile(`(?i)\b(war|casualties|military|propaganda|misinformation|protests|sanctions)\b`); trigger.MatchString(sanitized) {
		t.Fatalf("expected no trigger words to remain, got: %s", sanitized)
	}
	if !strings.Contains(sanitized, "Respond ONLY with the JSON described above.") {
		t.Fatalf("expected the JSON contract to survive sanitization, got: %s", sanitized)
	}
	if !strings.Contains(sanitized, "licensed investigative research platform") {
		t.Fatalf("expected the neutral analytical framing preamble, got: %s", sanitized)
	}
}

func TestPersonaContentFilterTriggersSanitizedRetry(t *testing.T) {
	var calls int64
	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			atomic.AddInt64(&calls, 1)
			// First (unsanitized) attempt trips the filter; the sanitized
			// retry, recognizable by its framing preamble, succeeds.
			if !strings.Contains(prompt, "licensed investigative research platform") {
				return fmt.Errorf("deepseek content filter blocked this response (finish_reason=content_filter); the topic or wording likely tripped the provider's safety filter")
			}
			if !strings.Contains(prompt, "armed conflict") {
				t.Errorf("expected the sanitized retry to keep the node's softened topic wording, prompt: %s", prompt)
			}
			target.(*PersonaJSONResponse).Confidence = 0.7
			target.(*PersonaJSONResponse).FullAnalysis = "Recovered after sanitized retry."
			return nil
		},
	}
	brain := &Brain{
		ModelRouter: map[string]ModelProvider{"mock": mock},
	}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	nodes := []models.MemoryNode{{
		ID:       "node-1",
		Title:    "War escalation in the region",
		Summary:  "Military attacks intensified; casualties mounted amid propaganda and sanctions.",
		FullText: "Military attacks intensified; casualties mounted amid propaganda and sanctions.",
	}}

	insights, err := brain.AnalyzeWithPersonasWithProgress(context.Background(), "inv-filter", nodes, nil)
	if err != nil {
		t.Fatalf("expected the sanitized retry to recover all personas, got error: %v", err)
	}
	if len(insights) != 7 {
		t.Fatalf("expected all seven persona insights after sanitized retry, got %d", len(insights))
	}
	// Seven personas, each one filtered call plus one successful sanitized call.
	if got := atomic.LoadInt64(&calls); got != 14 {
		t.Fatalf("expected 14 provider calls (7 filtered + 7 sanitized retries), got %d", got)
	}
	for _, insight := range insights {
		if insight.Confidence != 0.7 {
			t.Fatalf("expected recovered insight confidence 0.7 for %s, got %v", insight.PersonaName, insight.Confidence)
		}
	}
}
