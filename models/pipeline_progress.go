package models

import (
	"sync"
	"time"
)

const (
	PipelineProgressMessageType = "PIPELINE_PROGRESS"

	PipelineStatusPending   = "pending"
	PipelineStatusRunning   = "running"
	PipelineStatusComplete  = "complete"
	PipelineStatusError     = "error"
	PipelineStatusCancelled = "cancelled"
)

type PipelineProgressStep struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type PipelineProgressStepState struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Status      string `json:"status"`
	StartedAt   string `json:"startedAt,omitempty"`
	CompletedAt string `json:"completedAt,omitempty"`
	DurationMs  int64  `json:"durationMs,omitempty"`
	Detail      string `json:"detail,omitempty"`
	Error       string `json:"error,omitempty"`
}

type PipelineProgressPayload struct {
	RunID                string                      `json:"runId"`
	VaultID              string                      `json:"vaultId,omitempty"`
	Mode                 string                      `json:"mode"`
	StepID               string                      `json:"stepId"`
	StepLabel            string                      `json:"stepLabel"`
	Status               string                      `json:"status"`
	CompletedSteps       int                         `json:"completedSteps"`
	TotalSteps           int                         `json:"totalSteps"`
	StartedAt            string                      `json:"startedAt"`
	StepStartedAt        string                      `json:"stepStartedAt,omitempty"`
	CompletedAt          string                      `json:"completedAt,omitempty"`
	ElapsedMs            int64                       `json:"elapsedMs"`
	DurationMs           int64                       `json:"durationMs,omitempty"`
	EstimatedRemainingMs int64                       `json:"estimatedRemainingMs,omitempty"`
	Detail               string                      `json:"detail,omitempty"`
	Error                string                      `json:"error,omitempty"`
	Steps                []PipelineProgressStepState `json:"steps,omitempty"`
}

type PipelineProgressTracker struct {
	mu                 sync.Mutex
	runID              string
	vaultID            string
	mode               string
	startedAt          time.Time
	steps              []PipelineProgressStepState
	spans              []PipelineProfileSpan
	activeSpans        map[string]PipelineProfileSpan
	counters           map[string]int
	tokenUsage         map[string]PipelineProfileTokenUsage
	personaDiagnostics []PipelinePersonaDiagnostic
	now                func() time.Time
	currentID          string
}

func DefaultPipelineProgressSteps() []PipelineProgressStep {
	return []PipelineProgressStep{
		{ID: "start", Label: "Starting crawl"},
		{ID: "plan_queries", Label: "Planning search queries"},
		{ID: "dispatch_legs", Label: "Dispatching legs"},
		{ID: "gather_evidence", Label: "Gathering evidence"},
		{ID: "image_review", Label: "Image review"},
		{ID: "final_report", Label: "Final report synthesis"},
		{ID: "vault_persistence", Label: "Vault persistence"},
		{ID: "persona_analysis", Label: "Persona analysis"},
		{ID: "overlap_scan", Label: "Unified theory scan"},
		{ID: "relationship_synthesis", Label: "Relationship synthesis"},
		{ID: "discovery_review", Label: "Discovery review"},
		{ID: "complete", Label: "Pipeline complete"},
	}
}

func LocalPipelineProgressSteps() []PipelineProgressStep {
	return []PipelineProgressStep{
		{ID: "start", Label: "Starting local crawl"},
		{ID: "plan_queries", Label: "Parsing local files"},
		{ID: "dispatch_legs", Label: "Dispatching document chunks"},
		{ID: "gather_evidence", Label: "Gathering evidence"},
		{ID: "final_report", Label: "Local report synthesis"},
		{ID: "vault_persistence", Label: "Vault persistence"},
		{ID: "persona_analysis", Label: "Persona analysis"},
		{ID: "overlap_scan", Label: "Unified theory scan"},
		{ID: "relationship_synthesis", Label: "Relationship synthesis"},
		{ID: "discovery_review", Label: "Discovery review"},
		{ID: "complete", Label: "Pipeline complete"},
	}
}

func RabbitHolePipelineProgressSteps() []PipelineProgressStep {
	return []PipelineProgressStep{
		{ID: "start", Label: "Opening Rabbit Hole"},
		{ID: "plan_queries", Label: "Planning search queries"},
		{ID: "dispatch_legs", Label: "Dispatching legs"},
		{ID: "gather_evidence", Label: "Gathering evidence"},
		{ID: "image_review", Label: "Image review"},
		{ID: "final_report", Label: "Pass report synthesis"},
		{ID: "vault_persistence", Label: "Vault persistence"},
		{ID: "rabbit_gatekeeper", Label: "Rabbit Hole gatekeeper"},
		{ID: "persona_analysis", Label: "Persona analysis"},
		{ID: "overlap_scan", Label: "Unified theory scan"},
		{ID: "relationship_synthesis", Label: "Relationship synthesis"},
		{ID: "discovery_review", Label: "Discovery review"},
		{ID: "complete", Label: "Pipeline complete"},
	}
}

func NewPipelineProgressTracker(runID, vaultID, mode string, steps []PipelineProgressStep) *PipelineProgressTracker {
	return NewPipelineProgressTrackerWithClock(runID, vaultID, mode, steps, time.Now)
}

func NewPipelineProgressTrackerWithClock(runID, vaultID, mode string, steps []PipelineProgressStep, now func() time.Time) *PipelineProgressTracker {
	if now == nil {
		now = time.Now
	}

	startedAt := now()
	stepStates := make([]PipelineProgressStepState, 0, len(steps))
	for _, step := range steps {
		stepStates = append(stepStates, PipelineProgressStepState{
			ID:     step.ID,
			Label:  step.Label,
			Status: PipelineStatusPending,
		})
	}

	return &PipelineProgressTracker{
		runID:              runID,
		vaultID:            vaultID,
		mode:               mode,
		startedAt:          startedAt,
		steps:              stepStates,
		spans:              []PipelineProfileSpan{},
		activeSpans:        make(map[string]PipelineProfileSpan),
		counters:           make(map[string]int),
		tokenUsage:         make(map[string]PipelineProfileTokenUsage),
		personaDiagnostics: []PipelinePersonaDiagnostic{},
		now:                now,
	}
}

func (t *PipelineProgressTracker) Start(stepID, detail string) WSMessage {
	return t.transition(stepID, PipelineStatusRunning, detail, "")
}

func (t *PipelineProgressTracker) RunID() string {
	if t == nil {
		return ""
	}
	return t.runID
}

func (t *PipelineProgressTracker) Complete(stepID, detail string) WSMessage {
	return t.transition(stepID, PipelineStatusComplete, detail, "")
}

func (t *PipelineProgressTracker) Error(stepID, message string) WSMessage {
	return t.transition(stepID, PipelineStatusError, "", message)
}

func (t *PipelineProgressTracker) Cancel(stepID, detail string) WSMessage {
	return t.transition(stepID, PipelineStatusCancelled, detail, "")
}

func (t *PipelineProgressTracker) transition(stepID, status, detail, errorMessage string) WSMessage {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := t.now()
	stepIndex := t.ensureStep(stepID)
	step := &t.steps[stepIndex]

	if status == PipelineStatusRunning && t.currentID != "" && t.currentID != stepID {
		if currentIndex := t.indexOf(t.currentID); currentIndex >= 0 && t.steps[currentIndex].Status == PipelineStatusRunning {
			t.completeStep(&t.steps[currentIndex], now, t.steps[currentIndex].Detail)
		}
	}

	switch status {
	case PipelineStatusRunning:
		step.Status = PipelineStatusRunning
		step.Detail = detail
		step.Error = ""
		if step.StartedAt == "" {
			step.StartedAt = formatPipelineTime(now)
		}
		t.currentID = stepID
	case PipelineStatusComplete:
		if step.ID == "complete" {
			for index := range t.steps {
				if t.steps[index].Status == PipelineStatusPending {
					t.steps[index].Status = PipelineStatusComplete
					t.steps[index].Detail = "Not required for this run"
				}
			}
		}
		t.completeStep(step, now, detail)
		if t.currentID == stepID {
			t.currentID = ""
		}
	case PipelineStatusError:
		step.Status = PipelineStatusError
		step.Error = errorMessage
		step.Detail = detail
		if step.StartedAt == "" {
			step.StartedAt = formatPipelineTime(now)
		}
		step.CompletedAt = formatPipelineTime(now)
		if t.currentID == stepID {
			t.currentID = ""
		}
	case PipelineStatusCancelled:
		for index := range t.steps {
			if t.steps[index].Status == PipelineStatusRunning {
				t.cancelStep(&t.steps[index], now, detail)
			}
		}
		t.cancelStep(step, now, detail)
		t.currentID = ""
	}

	payload := t.payloadFor(*step, status, detail, errorMessage, now)
	return WSMessage{Type: PipelineProgressMessageType, Payload: payload}
}

func (t *PipelineProgressTracker) completeStep(step *PipelineProgressStepState, now time.Time, detail string) {
	step.Status = PipelineStatusComplete
	step.Detail = detail
	step.Error = ""
	if step.StartedAt == "" {
		step.StartedAt = formatPipelineTime(now)
	}
	step.CompletedAt = formatPipelineTime(now)
	step.DurationMs = durationSince(step.StartedAt, now)
}

func (t *PipelineProgressTracker) cancelStep(step *PipelineProgressStepState, now time.Time, detail string) {
	step.Status = PipelineStatusCancelled
	step.Detail = detail
	step.Error = ""
	if step.StartedAt == "" {
		step.StartedAt = formatPipelineTime(now)
	}
	step.CompletedAt = formatPipelineTime(now)
	step.DurationMs = durationSince(step.StartedAt, now)
}

func (t *PipelineProgressTracker) payloadFor(step PipelineProgressStepState, status, detail, errorMessage string, now time.Time) PipelineProgressPayload {
	completedSteps := 0
	completedDurations := make([]int64, 0, len(t.steps))
	for _, state := range t.steps {
		if state.Status == PipelineStatusComplete {
			completedSteps++
			if state.DurationMs > 0 {
				completedDurations = append(completedDurations, state.DurationMs)
			}
		}
	}

	estimatedRemainingMs := int64(0)
	if len(completedDurations) >= 2 {
		var totalDuration int64
		for _, duration := range completedDurations {
			totalDuration += duration
		}
		averageDuration := totalDuration / int64(len(completedDurations))
		remainingSteps := len(t.steps) - completedSteps
		if status == PipelineStatusRunning && remainingSteps > 0 {
			estimatedRemainingMs = averageDuration * int64(remainingSteps)
		}
	}

	return PipelineProgressPayload{
		RunID:                t.runID,
		VaultID:              t.vaultID,
		Mode:                 t.mode,
		StepID:               step.ID,
		StepLabel:            step.Label,
		Status:               status,
		CompletedSteps:       completedSteps,
		TotalSteps:           len(t.steps),
		StartedAt:            formatPipelineTime(t.startedAt),
		StepStartedAt:        step.StartedAt,
		CompletedAt:          step.CompletedAt,
		ElapsedMs:            now.Sub(t.startedAt).Milliseconds(),
		DurationMs:           step.DurationMs,
		EstimatedRemainingMs: estimatedRemainingMs,
		Detail:               detail,
		Error:                errorMessage,
		Steps:                append([]PipelineProgressStepState(nil), t.steps...),
	}
}

func (t *PipelineProgressTracker) ensureStep(stepID string) int {
	if index := t.indexOf(stepID); index >= 0 {
		return index
	}

	t.steps = append(t.steps, PipelineProgressStepState{
		ID:     stepID,
		Label:  stepID,
		Status: PipelineStatusPending,
	})
	return len(t.steps) - 1
}

func (t *PipelineProgressTracker) indexOf(stepID string) int {
	for index, step := range t.steps {
		if step.ID == stepID {
			return index
		}
	}
	return -1
}

func formatPipelineTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func durationSince(startedAt string, now time.Time) int64 {
	if startedAt == "" {
		return 0
	}
	parsed, err := time.Parse(time.RFC3339Nano, startedAt)
	if err != nil {
		return 0
	}
	return now.Sub(parsed).Milliseconds()
}
