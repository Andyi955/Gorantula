package brain

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"unicode/utf8"

	"spider-agent/models"
)

const maxTokenUsageRecords = 2048

type llmTokenUsage struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
	Estimated        bool
}

type tokenUsageRecord struct {
	ScopeID          string
	Operation        string
	Provider         string
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
	Estimated        bool
}

type tokenUsageSummary struct {
	CallCount          int
	ReportedCallCount  int
	EstimatedCallCount int
	PromptTokens       int
	CompletionTokens   int
	TotalTokens        int
	ProviderTotals     map[string]int
}

type tokenUsageTracker struct {
	mu          sync.Mutex
	records     []tokenUsageRecord
	nextScopeID uint64
}

type tokenUsageContextMetadata struct {
	ScopeID   string
	Operation string
}

type tokenUsageContextKey struct{}

func newTokenUsageTracker() *tokenUsageTracker {
	return &tokenUsageTracker{
		records: make([]tokenUsageRecord, 0, 128),
	}
}

func (t *tokenUsageTracker) newScopeID(prefix string) string {
	if prefix == "" {
		prefix = "llm"
	}
	id := atomic.AddUint64(&t.nextScopeID, 1)
	return fmt.Sprintf("%s-%d", prefix, id)
}

func (t *tokenUsageTracker) record(record tokenUsageRecord) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if len(t.records) == maxTokenUsageRecords {
		copy(t.records, t.records[1:])
		t.records[len(t.records)-1] = record
		return
	}

	t.records = append(t.records, record)
}

func (t *tokenUsageTracker) summarize(scopeID string) tokenUsageSummary {
	t.mu.Lock()
	defer t.mu.Unlock()

	summary := tokenUsageSummary{
		ProviderTotals: make(map[string]int),
	}

	for _, record := range t.records {
		if scopeID != "" && record.ScopeID != scopeID {
			continue
		}

		summary.CallCount++
		summary.PromptTokens += record.PromptTokens
		summary.CompletionTokens += record.CompletionTokens
		summary.TotalTokens += record.TotalTokens
		if record.Estimated {
			summary.EstimatedCallCount++
		} else {
			summary.ReportedCallCount++
		}
		summary.ProviderTotals[record.Provider] += record.TotalTokens
	}

	return summary
}

func withTokenUsageTracking(ctx context.Context, scopeID, operation string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}

	metadata := tokenUsageContextMetadata{
		ScopeID:   scopeID,
		Operation: operation,
	}

	return context.WithValue(ctx, tokenUsageContextKey{}, metadata)
}

func tokenUsageMetadataFromContext(ctx context.Context) tokenUsageContextMetadata {
	if ctx == nil {
		return tokenUsageContextMetadata{}
	}

	metadata, _ := ctx.Value(tokenUsageContextKey{}).(tokenUsageContextMetadata)
	return metadata
}

func tokenUsageOperationLabel(prefix, label string) string {
	cleaned := strings.ToLower(strings.TrimSpace(label))
	if cleaned == "" {
		return prefix
	}

	replacer := strings.NewReplacer(" ", "_", "-", "_", "/", "_", "\\", "_")
	cleaned = replacer.Replace(cleaned)
	return prefix + ":" + cleaned
}

func normalizeLLMTokenUsage(prompt, completion string, usage *llmTokenUsage) llmTokenUsage {
	if usage == nil || (usage.PromptTokens == 0 && usage.CompletionTokens == 0 && usage.TotalTokens == 0) {
		promptTokens := estimateTextTokens(prompt)
		completionTokens := estimateTextTokens(completion)
		return llmTokenUsage{
			PromptTokens:     promptTokens,
			CompletionTokens: completionTokens,
			TotalTokens:      promptTokens + completionTokens,
			Estimated:        true,
		}
	}

	normalized := *usage
	if normalized.TotalTokens == 0 {
		normalized.TotalTokens = normalized.PromptTokens + normalized.CompletionTokens
	}
	return normalized
}

func estimateTextTokens(text string) int {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return 0
	}

	return int(math.Ceil(float64(utf8.RuneCountInString(trimmed)) / 4.0))
}

func (b *Brain) ensureTokenUsageTracker() *tokenUsageTracker {
	if b == nil {
		return nil
	}

	b.tokenUsageMu.Lock()
	defer b.tokenUsageMu.Unlock()

	if b.tokenUsage == nil {
		b.tokenUsage = newTokenUsageTracker()
	}

	return b.tokenUsage
}

func (b *Brain) newTokenUsageScope(prefix string) string {
	tracker := b.ensureTokenUsageTracker()
	if tracker == nil {
		return ""
	}

	return tracker.newScopeID(prefix)
}

func (b *Brain) summarizeTokenUsageScope(scopeID string) tokenUsageSummary {
	tracker := b.ensureTokenUsageTracker()
	if tracker == nil {
		return tokenUsageSummary{}
	}

	return tracker.summarize(scopeID)
}

func (b *Brain) recordProviderTokenUsage(ctx context.Context, providerName, fallbackOperation, prompt, completion string, usage *llmTokenUsage) {
	tracker := b.ensureTokenUsageTracker()
	if tracker == nil {
		return
	}

	metadata := tokenUsageMetadataFromContext(ctx)
	operation := fallbackOperation
	if metadata.Operation != "" {
		operation = metadata.Operation
	}

	normalized := normalizeLLMTokenUsage(prompt, completion, usage)
	if normalized.TotalTokens == 0 {
		return
	}

	record := tokenUsageRecord{
		ScopeID:          metadata.ScopeID,
		Operation:        operation,
		Provider:         providerName,
		PromptTokens:     normalized.PromptTokens,
		CompletionTokens: normalized.CompletionTokens,
		TotalTokens:      normalized.TotalTokens,
		Estimated:        normalized.Estimated,
	}
	tracker.record(record)

	fmt.Printf("[TokenUsage] provider=%s operation=%s prompt=%d completion=%d total=%d estimated=%t scope=%s\n",
		record.Provider, record.Operation, record.PromptTokens, record.CompletionTokens, record.TotalTokens, record.Estimated, record.ScopeID)
}

func (b *Brain) broadcastSystemLog(message string) {
	if b == nil || b.NS == nil || b.NS.Broadcast == nil || strings.TrimSpace(message) == "" {
		return
	}

	b.NS.Broadcast(models.WSMessage{
		Type:    "SYSTEM_LOG",
		Payload: message,
	})
}

func (b *Brain) broadcastTokenUsageSummary(investigationID, label string, summary tokenUsageSummary) {
	if summary.CallCount == 0 {
		return
	}

	message := formatTokenUsageSummary(label, summary)
	fmt.Printf("[TokenUsage] %s\n", message)
	b.broadcastTokenUsageReport(buildTokenUsageReport(investigationID, label, summary))
	b.broadcastSystemLog(message)
}

func (b *Brain) broadcastTokenUsageReport(report models.TokenUsageReport) {
	if b == nil || b.NS == nil || b.NS.Broadcast == nil {
		return
	}

	b.NS.Broadcast(models.WSMessage{
		Type:    "TOKEN_USAGE",
		Payload: report,
	})
}

func formatTokenUsageSummary(label string, summary tokenUsageSummary) string {
	coverage := fmt.Sprintf("%d reported", summary.ReportedCallCount)
	if summary.EstimatedCallCount > 0 {
		coverage = fmt.Sprintf("%d reported, %d estimated", summary.ReportedCallCount, summary.EstimatedCallCount)
	}

	return fmt.Sprintf("%s token usage: %d total (%d prompt, %d completion) across %d calls; %s; providers: %s.",
		label,
		summary.TotalTokens,
		summary.PromptTokens,
		summary.CompletionTokens,
		summary.CallCount,
		coverage,
		formatProviderTotals(summary.ProviderTotals),
	)
}

func buildTokenUsageReport(investigationID, label string, summary tokenUsageSummary) models.TokenUsageReport {
	providerTotals := make(map[string]int, len(summary.ProviderTotals))
	for provider, total := range summary.ProviderTotals {
		providerTotals[provider] = total
	}

	return models.TokenUsageReport{
		InvestigationID:    investigationID,
		Label:              label,
		CallCount:          summary.CallCount,
		ReportedCallCount:  summary.ReportedCallCount,
		EstimatedCallCount: summary.EstimatedCallCount,
		PromptTokens:       summary.PromptTokens,
		CompletionTokens:   summary.CompletionTokens,
		TotalTokens:        summary.TotalTokens,
		ProviderTotals:     providerTotals,
	}
}

func formatProviderTotals(providerTotals map[string]int) string {
	if len(providerTotals) == 0 {
		return "none"
	}

	names := make([]string, 0, len(providerTotals))
	for name := range providerTotals {
		names = append(names, name)
	}
	sort.Strings(names)

	parts := make([]string, 0, len(names))
	for _, name := range names {
		parts = append(parts, fmt.Sprintf("%s=%d", name, providerTotals[name]))
	}

	return strings.Join(parts, ", ")
}
