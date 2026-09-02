package brain

import (
	"context"
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
