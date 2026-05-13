package models

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const PipelineProfileSavedMessageType = "PIPELINE_PROFILE_SAVED"

type PipelineProfileSpan struct {
	ID          string `json:"id"`
	StepID      string `json:"stepId"`
	Label       string `json:"label"`
	StartedAt   string `json:"startedAt,omitempty"`
	CompletedAt string `json:"completedAt,omitempty"`
	DurationMs  int64  `json:"durationMs,omitempty"`
	Detail      string `json:"detail,omitempty"`
}

type PipelineProfileTokenUsage struct {
	Operation          string `json:"operation"`
	Provider           string `json:"provider"`
	CallCount          int    `json:"callCount"`
	ReportedCallCount  int    `json:"reportedCallCount"`
	EstimatedCallCount int    `json:"estimatedCallCount"`
	PromptTokens       int    `json:"promptTokens"`
	CompletionTokens   int    `json:"completionTokens"`
	TotalTokens        int    `json:"totalTokens"`
}

type PipelineProfileBottleneck struct {
	Kind           string  `json:"kind"`
	ID             string  `json:"id"`
	Label          string  `json:"label"`
	DurationMs     int64   `json:"durationMs,omitempty"`
	TotalTokens    int     `json:"totalTokens,omitempty"`
	PercentOfTotal float64 `json:"percentOfTotal,omitempty"`
}

type PipelinePerformanceProfile struct {
	RunID          string                      `json:"runId"`
	VaultID        string                      `json:"vaultId,omitempty"`
	Mode           string                      `json:"mode"`
	Status         string                      `json:"status"`
	StartedAt      string                      `json:"startedAt"`
	CompletedAt    string                      `json:"completedAt,omitempty"`
	TotalElapsedMs int64                       `json:"totalElapsedMs"`
	Steps          []PipelineProgressStepState `json:"steps,omitempty"`
	Spans          []PipelineProfileSpan       `json:"spans,omitempty"`
	Counters       map[string]int              `json:"counters,omitempty"`
	TokenUsage     []PipelineProfileTokenUsage `json:"tokenUsage,omitempty"`
	Bottlenecks    []PipelineProfileBottleneck `json:"bottlenecks,omitempty"`
}

type PipelineProfileStore struct {
	directory string
	retention int
}

func NewPipelineProfileStore(directory string, retention int) *PipelineProfileStore {
	if retention <= 0 {
		retention = 100
	}
	return &PipelineProfileStore{directory: directory, retention: retention}
}

func (t *PipelineProgressTracker) StartSpan(id, stepID, label, detail string) {
	if t == nil || strings.TrimSpace(id) == "" {
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	now := t.now()
	t.activeSpans[id] = PipelineProfileSpan{
		ID:        strings.TrimSpace(id),
		StepID:    strings.TrimSpace(stepID),
		Label:     fallbackProfileLabel(label, id),
		StartedAt: formatPipelineTime(now),
		Detail:    sanitizeProfileText(detail),
	}
}

func (t *PipelineProgressTracker) CompleteSpan(id, detail string) {
	if t == nil || strings.TrimSpace(id) == "" {
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	now := t.now()
	span, ok := t.activeSpans[id]
	if !ok {
		span = PipelineProfileSpan{ID: strings.TrimSpace(id), Label: strings.TrimSpace(id), StartedAt: formatPipelineTime(now)}
	}
	span.CompletedAt = formatPipelineTime(now)
	span.DurationMs = durationSince(span.StartedAt, now)
	if strings.TrimSpace(detail) != "" {
		span.Detail = sanitizeProfileText(detail)
	}
	t.spans = append(t.spans, span)
	delete(t.activeSpans, id)
}

func (t *PipelineProgressTracker) RecordSpan(span PipelineProfileSpan) {
	if t == nil || strings.TrimSpace(span.ID) == "" {
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	span.ID = strings.TrimSpace(span.ID)
	span.StepID = strings.TrimSpace(span.StepID)
	span.Label = fallbackProfileLabel(span.Label, span.ID)
	span.Detail = sanitizeProfileText(span.Detail)
	if span.DurationMs < 0 {
		span.DurationMs = 0
	}
	t.spans = append(t.spans, span)
}

func (t *PipelineProgressTracker) RecordCounter(name string, delta int) {
	if t == nil || strings.TrimSpace(name) == "" || delta == 0 {
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	t.counters[strings.TrimSpace(name)] += delta
}

func (t *PipelineProgressTracker) RecordTokenUsage(usages ...PipelineProfileTokenUsage) {
	if t == nil {
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	for _, usage := range usages {
		operation := strings.TrimSpace(usage.Operation)
		provider := strings.TrimSpace(usage.Provider)
		if operation == "" || provider == "" || usage.TotalTokens <= 0 {
			continue
		}
		key := operation + "\x00" + provider
		current := t.tokenUsage[key]
		current.Operation = operation
		current.Provider = provider
		current.CallCount += usage.CallCount
		current.ReportedCallCount += usage.ReportedCallCount
		current.EstimatedCallCount += usage.EstimatedCallCount
		current.PromptTokens += usage.PromptTokens
		current.CompletionTokens += usage.CompletionTokens
		current.TotalTokens += usage.TotalTokens
		t.tokenUsage[key] = current
	}
}

func (t *PipelineProgressTracker) Profile() PipelinePerformanceProfile {
	if t == nil {
		return PipelinePerformanceProfile{}
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	now := t.now()
	steps := cloneProfileSteps(t.steps)
	spans := append([]PipelineProfileSpan(nil), t.spans...)
	for _, span := range t.activeSpans {
		spans = append(spans, span)
	}
	counters := make(map[string]int, len(t.counters))
	for key, value := range t.counters {
		counters[key] = value
	}
	tokenUsage := make([]PipelineProfileTokenUsage, 0, len(t.tokenUsage))
	for _, usage := range t.tokenUsage {
		tokenUsage = append(tokenUsage, usage)
	}
	sort.SliceStable(tokenUsage, func(i, j int) bool {
		if tokenUsage[i].TotalTokens == tokenUsage[j].TotalTokens {
			return tokenUsage[i].Operation < tokenUsage[j].Operation
		}
		return tokenUsage[i].TotalTokens > tokenUsage[j].TotalTokens
	})

	status, completedAt := profileStatusAndCompletion(steps)
	if completedAt == "" && status == PipelineStatusComplete {
		completedAt = formatPipelineTime(now)
	}
	totalElapsedMs := now.Sub(t.startedAt).Milliseconds()
	if completedAt != "" {
		if completed, err := time.Parse(time.RFC3339Nano, completedAt); err == nil {
			totalElapsedMs = completed.Sub(t.startedAt).Milliseconds()
		}
	}

	profile := PipelinePerformanceProfile{
		RunID:          t.runID,
		VaultID:        t.vaultID,
		Mode:           t.mode,
		Status:         status,
		StartedAt:      formatPipelineTime(t.startedAt),
		CompletedAt:    completedAt,
		TotalElapsedMs: totalElapsedMs,
		Steps:          steps,
		Spans:          spans,
		Counters:       counters,
		TokenUsage:     tokenUsage,
	}
	profile.Bottlenecks = BuildPipelineBottlenecks(profile)
	return profile
}

func BuildPipelineBottlenecks(profile PipelinePerformanceProfile) []PipelineProfileBottleneck {
	bottlenecks := make([]PipelineProfileBottleneck, 0, len(profile.Spans)+len(profile.Steps)+len(profile.TokenUsage))
	spans := append([]PipelineProfileSpan(nil), profile.Spans...)
	sort.SliceStable(spans, func(i, j int) bool {
		return spans[i].DurationMs > spans[j].DurationMs
	})
	for _, span := range spans {
		if span.DurationMs <= 0 {
			continue
		}
		bottlenecks = append(bottlenecks, PipelineProfileBottleneck{
			Kind:           "span",
			ID:             span.ID,
			Label:          fallbackProfileLabel(span.Label, span.ID),
			DurationMs:     span.DurationMs,
			PercentOfTotal: percentOfTotal(span.DurationMs, profile.TotalElapsedMs),
		})
	}

	steps := append([]PipelineProgressStepState(nil), profile.Steps...)
	sort.SliceStable(steps, func(i, j int) bool {
		return steps[i].DurationMs > steps[j].DurationMs
	})
	for _, step := range steps {
		if step.DurationMs <= 0 {
			continue
		}
		bottlenecks = append(bottlenecks, PipelineProfileBottleneck{
			Kind:           "step",
			ID:             step.ID,
			Label:          fallbackProfileLabel(step.Label, step.ID),
			DurationMs:     step.DurationMs,
			PercentOfTotal: percentOfTotal(step.DurationMs, profile.TotalElapsedMs),
		})
	}

	for _, usage := range profile.TokenUsage {
		if usage.TotalTokens <= 0 {
			continue
		}
		bottlenecks = append(bottlenecks, PipelineProfileBottleneck{
			Kind:        "token",
			ID:          usage.Operation,
			Label:       usage.Operation,
			TotalTokens: usage.TotalTokens,
		})
	}

	if len(bottlenecks) > 8 {
		return bottlenecks[:8]
	}
	return bottlenecks
}

func (s *PipelineProfileStore) Save(profile PipelinePerformanceProfile) error {
	if strings.TrimSpace(profile.RunID) == "" {
		return fmt.Errorf("pipeline profile run id is required")
	}
	if err := os.MkdirAll(s.directory, 0o755); err != nil {
		return err
	}

	profile.Bottlenecks = BuildPipelineBottlenecks(profile)
	payload, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return err
	}

	fileName, err := safePipelineProfileFilename(profile.RunID)
	if err != nil {
		return err
	}
	target := filepath.Join(s.directory, fileName)
	temp := target + ".tmp"
	if err := os.WriteFile(temp, payload, 0o644); err != nil {
		return err
	}
	if err := os.Rename(temp, target); err != nil {
		_ = os.Remove(temp)
		return err
	}
	return s.prune()
}

func (s *PipelineProfileStore) Load(runID string) (PipelinePerformanceProfile, error) {
	fileName, err := safePipelineProfileFilename(runID)
	if err != nil {
		return PipelinePerformanceProfile{}, err
	}
	payload, err := os.ReadFile(filepath.Join(s.directory, fileName))
	if err != nil {
		return PipelinePerformanceProfile{}, err
	}
	var profile PipelinePerformanceProfile
	if err := json.Unmarshal(payload, &profile); err != nil {
		return PipelinePerformanceProfile{}, err
	}
	return profile, nil
}

func (s *PipelineProfileStore) List(limit int) ([]PipelinePerformanceProfile, error) {
	entries, err := os.ReadDir(s.directory)
	if os.IsNotExist(err) {
		return []PipelinePerformanceProfile{}, nil
	}
	if err != nil {
		return nil, err
	}

	profiles := make([]PipelinePerformanceProfile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		payload, err := os.ReadFile(filepath.Join(s.directory, entry.Name()))
		if err != nil {
			continue
		}
		var profile PipelinePerformanceProfile
		if err := json.Unmarshal(payload, &profile); err == nil && profile.RunID != "" {
			profiles = append(profiles, profile)
		}
	}

	sortProfilesNewestFirst(profiles)
	if limit > 0 && len(profiles) > limit {
		return profiles[:limit], nil
	}
	return profiles, nil
}

func (s *PipelineProfileStore) prune() error {
	profiles, err := s.List(0)
	if err != nil || len(profiles) <= s.retention {
		return err
	}
	for _, profile := range profiles[s.retention:] {
		fileName, err := safePipelineProfileFilename(profile.RunID)
		if err != nil {
			continue
		}
		_ = os.Remove(filepath.Join(s.directory, fileName))
	}
	return nil
}

func safePipelineProfileFilename(runID string) (string, error) {
	runID = strings.TrimSpace(runID)
	if runID == "" || filepath.Base(runID) != runID || strings.ContainsAny(runID, `/\`) {
		return "", fmt.Errorf("invalid pipeline run id")
	}
	return runID + ".json", nil
}

func cloneProfileSteps(steps []PipelineProgressStepState) []PipelineProgressStepState {
	cloned := make([]PipelineProgressStepState, 0, len(steps))
	for _, step := range steps {
		step.Detail = ""
		cloned = append(cloned, step)
	}
	return cloned
}

func profileStatusAndCompletion(steps []PipelineProgressStepState) (string, string) {
	status := PipelineStatusRunning
	completedAt := ""
	for _, step := range steps {
		if step.Status == PipelineStatusError {
			return PipelineStatusError, step.CompletedAt
		}
		if step.ID == "complete" && step.Status == PipelineStatusComplete {
			status = PipelineStatusComplete
			completedAt = step.CompletedAt
		}
	}
	return status, completedAt
}

func sortProfilesNewestFirst(profiles []PipelinePerformanceProfile) {
	sort.SliceStable(profiles, func(i, j int) bool {
		left := profileSortTime(profiles[i])
		right := profileSortTime(profiles[j])
		if left.Equal(right) {
			return profiles[i].RunID > profiles[j].RunID
		}
		return left.After(right)
	})
}

func profileSortTime(profile PipelinePerformanceProfile) time.Time {
	for _, candidate := range []string{profile.CompletedAt, profile.StartedAt} {
		if parsed, err := time.Parse(time.RFC3339Nano, candidate); err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func fallbackProfileLabel(label, fallback string) string {
	label = strings.TrimSpace(label)
	if label != "" {
		return label
	}
	return strings.TrimSpace(fallback)
}

func percentOfTotal(durationMs int64, totalElapsedMs int64) float64 {
	if durationMs <= 0 || totalElapsedMs <= 0 {
		return 0
	}
	return float64(durationMs) * 100 / float64(totalElapsedMs)
}

func sanitizeProfileText(value string) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if len([]rune(value)) <= 180 {
		return value
	}
	return string([]rune(value)[:180]) + "..."
}
