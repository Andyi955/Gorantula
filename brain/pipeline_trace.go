package brain

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Pipeline trace: one JSONL line per model call, written to
// pipeline-traces/pipeline-trace.jsonl under the working directory. This is
// the accurate per-call record (provider, prompt size, duration, outcome)
// that the phase tracker and slog lines only imply.

type pipelineTraceRecord struct {
	Timestamp   string `json:"ts"`
	Span        string `json:"span"`
	Provider    string `json:"provider,omitempty"`
	PromptChars int    `json:"promptChars,omitempty"`
	DurationMs  int64  `json:"durationMs"`
	Attempt     int    `json:"attempt,omitempty"`
	Thinking    string `json:"thinking,omitempty"`
	Error       string `json:"error,omitempty"`
}

// traceThinking resolves the run's thinking mode for a trace record:
// "low"/"high" when a run override is active, "default" otherwise (which
// means the provider's own default applies - disabled for DeepSeek).
func traceThinking(ctx context.Context) string {
	if mode := normalizeThinkingMode(thinkingOverrideFromContext(ctx)); mode != "" {
		return mode
	}
	return "default"
}

var (
	pipelineTraceMu     sync.Mutex
	pipelineTraceDir    = "pipeline-traces"
	pipelineTraceErrors = 0
)

// SetPipelineTraceDir overrides the trace output directory (tests).
func SetPipelineTraceDir(dir string) {
	pipelineTraceMu.Lock()
	defer pipelineTraceMu.Unlock()
	pipelineTraceDir = dir
}

func tracePipelineSpan(record pipelineTraceRecord) {
	pipelineTraceMu.Lock()
	defer pipelineTraceMu.Unlock()
	record.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	data, err := json.Marshal(record)
	if err != nil {
		return
	}
	if err := os.MkdirAll(pipelineTraceDir, 0o755); err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(pipelineTraceDir, "pipeline-trace.jsonl"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	if _, err := f.Write(append(data, '\n')); err != nil {
		pipelineTraceErrors++
	}
}
