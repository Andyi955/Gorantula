package brain

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/Andyi955/Gorantula/models"
)

// personaMaxConcurrency caps how many persona prompts hit the model
// provider at the same instant. Seven simultaneous large prompts made
// providers like DeepSeek return empty or truncated bodies; capping one
// below the full salvo keeps peak pressure down while the wall time stays
// at the all-at-once baseline (six run in parallel, the seventh starts as
// the first finishes).
const personaMaxConcurrency = 6

type personaAnalysisResult struct {
	personaName string
	insight     PersonaInsight
	diagnostic  models.PipelinePersonaDiagnostic
	err         error
}

type personaExecutionDiagnostic struct {
	preferredProvider      string
	provider               string
	fallbackProvider       string
	status                 string
	errorCategory          string
	errorSummary           string
	recoveredErrorCategory string
	startedAt              string
	completedAt            string
	durationMs             int64
	promptChars            int
	attemptCount           int
}

// AnalyzeWithPersonas runs multi-agent persona analysis on the gathered findings
func (b *Brain) AnalyzeWithPersonas(ctx context.Context, investigationID string, nodes []models.MemoryNode) ([]PersonaInsight, error) {
	return b.analyzeWithPersonas(ctx, investigationID, nodes, nil)
}

func (b *Brain) AnalyzeWithPersonasWithProgress(ctx context.Context, investigationID string, nodes []models.MemoryNode, progress *models.PipelineProgressTracker) ([]PersonaInsight, error) {
	return b.analyzeWithPersonas(ctx, investigationID, nodes, progress)
}

func (b *Brain) analyzeWithPersonas(ctx context.Context, investigationID string, nodes []models.MemoryNode, progress *models.PipelineProgressTracker) ([]PersonaInsight, error) {
	if err := checkPipelineContext(ctx); err != nil {
		return nil, err
	}
	personas := GetDefaultPersonas()
	brainLog("persona").Info("running full-board persona analysis", "personas", len(personas), "nodes", len(nodes), "vault", investigationID)

	findingsText := buildSummaryFirstPersonaFindings(nodes)
	brainLog("persona").Info("prepared full-board persona evidence", "nodes", len(nodes), "personas", len(personas), "chars", len(findingsText), "vault", investigationID)

	scopeID := b.newTokenUsageScope("persona-full-board")
	insightsChan := make(chan personaAnalysisResult, len(personas))

	// Run each persona analysis in parallel, throttled: at most
	// personaMaxConcurrency personas are in flight at once, the rest queue
	// behind them in waves.
	semaphore := make(chan struct{}, personaMaxConcurrency)
	var wg sync.WaitGroup
	for _, persona := range personas {
		wg.Add(1)
		go func(p Persona) {
			defer wg.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			prompt := BuildPersonaPrompt(p, findingsText)
			personaCtx := withTokenUsageTracking(ctx, scopeID, tokenUsageOperationLabel("full_board_persona", p.Name))
			insight, execution, err := b.runPersonaAnalysisWithPromptDiagnostic(personaCtx, p, prompt)
			diagnostic := buildPersonaPipelineDiagnostic("full_board", p, execution, len(nodes), 0, insight)
			if err != nil {
				logPersonaFailure("full_board", progressRunID(progress), investigationID, diagnostic)
				insightsChan <- personaAnalysisResult{personaName: p.Name, diagnostic: diagnostic, err: err}
				return
			}
			insightsChan <- personaAnalysisResult{personaName: p.Name, insight: insight, diagnostic: diagnostic}
		}(persona)
	}
	go func() {
		wg.Wait()
		close(insightsChan)
	}()

	// Collect insights from all personas
	insights := make([]PersonaInsight, 0, len(personas))
	failedPersonas := make(map[string]struct{})
collect:
	for range personas {
		select {
		case <-ctx.Done():
			return insights, ctx.Err()
		case result, ok := <-insightsChan:
			if !ok {
				break collect
			}
			if result.err != nil {
				recordPersonaDiagnostic(progress, result.diagnostic)
				failedPersonas[result.personaName] = struct{}{}
				continue
			}
			insight := result.insight
			if insight.Confidence > 0 {
				recordPersonaDiagnostic(progress, result.diagnostic)
				insights = append(insights, insight)
				brainLog("persona").Info("persona completed", "vault", investigationID, "persona", insight.PersonaName, "confidence", insight.Confidence)
			} else {
				result.diagnostic.Status = "zero_confidence"
				result.diagnostic.ErrorCategory = "zero_confidence"
				result.diagnostic.ErrorSummary = "persona returned no positive confidence"
				recordPersonaDiagnostic(progress, result.diagnostic)
			}
		}
	}

	brainLog("persona").Info("full-board persona analysis complete", "vault", investigationID, "insights", len(insights), "personas", len(personas))
	tokenSummary := b.summarizeTokenUsageScope(scopeID)
	b.broadcastTokenUsageSummary(investigationID, "Full-board persona analysis", tokenSummary)
	b.broadcastPartialPersonaAnalysisWarning(personas, failedPersonas, len(insights))
	b.RecordPipelineTokenUsage(progress, scopeID)
	return insights, nil
}

func buildIncrementalPersonaFindings(nodes []models.MemoryNode, pendingNodeIDs []string) (string, string, []string) {
	pendingNodeIDSet := make(map[string]struct{}, len(pendingNodeIDs))
	for _, nodeID := range pendingNodeIDs {
		pendingNodeIDSet[nodeID] = struct{}{}
	}

	var pendingBuilder strings.Builder
	var contextBuilder strings.Builder
	validPendingNodeIDs := make([]string, 0, len(pendingNodeIDs))

	for _, node := range nodes {
		if _, ok := pendingNodeIDSet[node.ID]; ok {
			validPendingNodeIDs = append(validPendingNodeIDs, node.ID)
			pendingBuilder.WriteString(fmt.Sprintf("[NodeID: %s]\nSource: %s\nTitle: %s\nSummary: %s\nFull Text: %s\n\n",
				node.ID, node.SourceURL, node.Title, node.Summary, node.FullText))
			continue
		}

		contextBuilder.WriteString(fmt.Sprintf("[ContextNodeID: %s]\nTitle: %s\nSummary: %s\n\n",
			node.ID, node.Title, node.Summary))
	}

	return pendingBuilder.String(), contextBuilder.String(), validPendingNodeIDs
}

func (b *Brain) AnalyzeIncrementalWithPersonas(ctx context.Context, investigationID string, nodes []models.MemoryNode, pendingNodeIDs []string) ([]PersonaInsight, error) {
	return b.analyzeIncrementalWithPersonas(ctx, investigationID, nodes, pendingNodeIDs, nil)
}

func (b *Brain) AnalyzeIncrementalWithPersonasWithProgress(ctx context.Context, investigationID string, nodes []models.MemoryNode, pendingNodeIDs []string, progress *models.PipelineProgressTracker) ([]PersonaInsight, error) {
	return b.analyzeIncrementalWithPersonas(ctx, investigationID, nodes, pendingNodeIDs, progress)
}

func (b *Brain) analyzeIncrementalWithPersonas(ctx context.Context, investigationID string, nodes []models.MemoryNode, pendingNodeIDs []string, progress *models.PipelineProgressTracker) ([]PersonaInsight, error) {
	if err := checkPipelineContext(ctx); err != nil {
		return nil, err
	}
	brainLog("persona").Info("running incremental persona analysis", "vault", investigationID, "personas", len(GetDefaultPersonas()), "nodes", len(nodes), "pending_nodes", len(pendingNodeIDs))

	pendingFindings, contextFindings, validPendingNodeIDs := buildIncrementalPersonaFindings(nodes, pendingNodeIDs)
	if len(validPendingNodeIDs) == 0 {
		return nil, fmt.Errorf("incremental persona analysis requires at least one valid pending node")
	}

	personas := GetDefaultPersonas()
	scopeID := b.newTokenUsageScope("persona-incremental")
	insightsChan := make(chan personaAnalysisResult, len(personas))

	semaphore := make(chan struct{}, personaMaxConcurrency)
	var wg sync.WaitGroup
	for _, persona := range personas {
		wg.Add(1)
		go func(p Persona) {
			defer wg.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			prompt := BuildIncrementalPersonaPrompt(p, pendingFindings, contextFindings, validPendingNodeIDs)
			personaCtx := withTokenUsageTracking(ctx, scopeID, tokenUsageOperationLabel("incremental_persona", p.Name))
			insight, execution, err := b.runPersonaAnalysisWithPromptDiagnostic(personaCtx, p, prompt)
			diagnostic := buildPersonaPipelineDiagnostic("incremental", p, execution, len(nodes), len(validPendingNodeIDs), insight)
			if err != nil {
				logPersonaFailure("incremental", progressRunID(progress), investigationID, diagnostic)
				insightsChan <- personaAnalysisResult{personaName: p.Name, diagnostic: diagnostic, err: err}
				return
			}
			insightsChan <- personaAnalysisResult{personaName: p.Name, insight: insight, diagnostic: diagnostic}
		}(persona)
	}
	go func() {
		wg.Wait()
		close(insightsChan)
	}()

	insights := make([]PersonaInsight, 0, len(personas))
	failedPersonas := make(map[string]struct{})
collectIncremental:
	for range personas {
		select {
		case <-ctx.Done():
			return insights, ctx.Err()
		case result, ok := <-insightsChan:
			if !ok {
				break collectIncremental
			}
			if result.err != nil {
				recordPersonaDiagnostic(progress, result.diagnostic)
				failedPersonas[result.personaName] = struct{}{}
				continue
			}
			insight := result.insight
			if insight.Confidence > 0 {
				recordPersonaDiagnostic(progress, result.diagnostic)
				insights = append(insights, insight)
				brainLog("persona").Info("incremental persona completed", "vault", investigationID, "persona", insight.PersonaName, "confidence", insight.Confidence)
			} else {
				result.diagnostic.Status = "zero_confidence"
				result.diagnostic.ErrorCategory = "zero_confidence"
				result.diagnostic.ErrorSummary = "persona returned no positive confidence"
				recordPersonaDiagnostic(progress, result.diagnostic)
			}
		}
	}

	brainLog("persona").Info("incremental persona analysis complete", "vault", investigationID, "insights", len(insights), "personas", len(personas))
	tokenSummary := b.summarizeTokenUsageScope(scopeID)
	b.broadcastTokenUsageSummary(investigationID, "Incremental persona analysis", tokenSummary)
	b.broadcastPartialPersonaAnalysisWarning(personas, failedPersonas, len(insights))
	b.RecordPipelineTokenUsage(progress, scopeID)
	return insights, nil
}

// runPersonaAnalysis executes a single persona's analysis
func (b *Brain) runPersonaAnalysis(ctx context.Context, persona Persona, findings string) (PersonaInsight, error) {
	prompt := BuildPersonaPrompt(persona, findings)
	return b.runPersonaAnalysisWithPrompt(ctx, persona, prompt)
}

func (b *Brain) runPersonaAnalysisWithPrompt(ctx context.Context, persona Persona, prompt string) (PersonaInsight, error) {
	insight, _, err := b.runPersonaAnalysisWithPromptDiagnostic(ctx, persona, prompt)
	return insight, err
}

func (b *Brain) runPersonaAnalysisWithPromptDiagnostic(ctx context.Context, persona Persona, prompt string) (PersonaInsight, personaExecutionDiagnostic, error) {
	startedAt := time.Now()
	execution := personaExecutionDiagnostic{
		preferredProvider: strings.TrimSpace(persona.ModelPref),
		status:            "failed",
		startedAt:         startedAt.Format(time.RFC3339Nano),
		promptChars:       len([]rune(prompt)),
		attemptCount:      1,
	}
	completeExecution := func(status string, err error) personaExecutionDiagnostic {
		completedAt := time.Now()
		execution.status = status
		execution.completedAt = completedAt.Format(time.RFC3339Nano)
		execution.durationMs = completedAt.Sub(startedAt).Milliseconds()
		if err != nil {
			execution.errorCategory = categorizePersonaError(err)
			if strings.TrimSpace(execution.errorSummary) == "" {
				execution.errorSummary = models.SanitizePipelineDiagnosticText(err.Error())
			}
		}
		return execution
	}

	// Get the appropriate model provider
	provider, ok := b.GetRouter(persona.ModelPref)
	if !ok {
		var found bool
		provider, found = b.firstAvailableProvider()
		if !found {
			err := fmt.Errorf("no model providers available to run persona analysis")
			return PersonaInsight{PersonaName: persona.Name, Confidence: 0}, completeExecution("failed", err), err
		}
		brainLog("persona").Warn("preferred persona model unavailable; using fallback", "persona", persona.Name, "preferred_provider", persona.ModelPref, "provider", provider.Name())
	}
	execution.provider = provider.Name()

	brainLog("persona").Info("running persona", "persona", persona.Name, "provider", provider.Name(), "prompt_chars", execution.promptChars)

	var response PersonaJSONResponse
	err := provider.GenerateJSON(ctx, prompt, &response)
	if err != nil && shouldRetryPersonaJSON(err) {
		initialErr := err
		execution.attemptCount = 2
		brainLog("persona").Warn(
			"persona json retry",
			"persona", persona.Name,
			"provider", provider.Name(),
			"prompt_chars", execution.promptChars,
			"category", categorizePersonaError(initialErr),
			"err", models.SanitizePipelineDiagnosticText(initialErr.Error()),
		)
		response = PersonaJSONResponse{}
		retryErr := provider.GenerateJSON(ctx, buildPersonaJSONRetryPrompt(prompt), &response)
		if retryErr == nil {
			execution.recoveredErrorCategory = categorizePersonaError(initialErr)
			brainLog("persona").Info(
				"persona recovered after json retry",
				"persona", persona.Name,
				"provider", provider.Name(),
				"prompt_chars", execution.promptChars,
			)
			err = nil
		} else {
			execution.errorSummary = models.SanitizePipelineDiagnosticText(fmt.Sprintf("primary error: %v; retry error: %v", initialErr, retryErr))
			err = fmt.Errorf("persona JSON retry failed after primary error: primary: %v; retry: %w", initialErr, retryErr)
		}
	}
	if err != nil {
		fallbackProvider, ok := b.fallbackProviderAfter(provider)
		if !ok {
			wrapped := fmt.Errorf("failed to generate persona analysis: %w", err)
			return PersonaInsight{}, completeExecution("failed", wrapped), wrapped
		}
		if ctx.Err() != nil && !errors.Is(err, context.DeadlineExceeded) {
			wrapped := fmt.Errorf("failed to generate persona analysis: %w", err)
			return PersonaInsight{}, completeExecution("failed", wrapped), wrapped
		}
		execution.fallbackProvider = fallbackProvider.Name()
		brainLog("persona").Warn(
			"persona fallback attempt",
			"persona", persona.Name,
			"preferred_provider", execution.preferredProvider,
			"provider", provider.Name(),
			"fallback_provider", fallbackProvider.Name(),
			"prompt_chars", execution.promptChars,
			"category", categorizePersonaError(err),
			"err", models.SanitizePipelineDiagnosticText(err.Error()),
		)
		response = PersonaJSONResponse{}
		if fallbackErr := fallbackProvider.GenerateJSON(ctx, prompt, &response); fallbackErr != nil {
			wrapped := fmt.Errorf("failed to generate persona analysis: %w", err)
			combinedSummary := models.SanitizePipelineDiagnosticText(fmt.Sprintf("primary error: %v; fallback error: %v", err, fallbackErr))
			execution.errorSummary = combinedSummary
			brainLog("persona").Error(
				"persona fallback failed",
				"persona", persona.Name,
				"preferred_provider", execution.preferredProvider,
				"provider", provider.Name(),
				"fallback_provider", fallbackProvider.Name(),
				"prompt_chars", execution.promptChars,
				"primary_category", categorizePersonaError(err),
				"fallback_category", categorizePersonaError(fallbackErr),
				"err", execution.errorSummary,
			)
			diagnostic := completeExecution("failed", wrapped)
			diagnostic.errorSummary = combinedSummary
			return PersonaInsight{}, diagnostic, wrapped
		}
		execution.provider = fallbackProvider.Name()
		brainLog("persona").Info(
			"persona recovered using fallback",
			"persona", persona.Name,
			"preferred_provider", execution.preferredProvider,
			"provider", fallbackProvider.Name(),
			"prompt_chars", execution.promptChars,
		)
	}

	insight := buildPersonaInsight(persona, prompt, response)
	return insight, completeExecution("success", nil), nil
}

func buildPersonaPipelineDiagnostic(mode string, persona Persona, execution personaExecutionDiagnostic, nodeCount, pendingNodeCount int, insight PersonaInsight) models.PipelinePersonaDiagnostic {
	return models.PipelinePersonaDiagnostic{
		Mode:              mode,
		PersonaName:       persona.Name,
		PreferredProvider: execution.preferredProvider,
		Provider:          execution.provider,
		FallbackProvider:  execution.fallbackProvider,
		Status:            execution.status,
		ErrorCategory:     execution.errorCategory,
		ErrorSummary:      execution.errorSummary,
		StartedAt:         execution.startedAt,
		CompletedAt:       execution.completedAt,
		DurationMs:        execution.durationMs,
		PromptChars:       execution.promptChars,
		NodeCount:         nodeCount,
		PendingNodeCount:  pendingNodeCount,
		Confidence:        insight.Confidence,
		KeyFindingCount:   len(insight.KeyFindings),
		AttemptCount:      execution.attemptCount,
		RecoveredCategory: execution.recoveredErrorCategory,
	}
}

func recordPersonaDiagnostic(progress *models.PipelineProgressTracker, diagnostic models.PipelinePersonaDiagnostic) {
	if progress != nil {
		progress.RecordPersonaDiagnostic(diagnostic)
	}
}

func progressRunID(progress *models.PipelineProgressTracker) string {
	if progress == nil {
		return ""
	}
	return progress.RunID()
}

func logPersonaFailure(mode, runID, vaultID string, diagnostic models.PipelinePersonaDiagnostic) {
	brainLog("persona").Error(
		"persona failed",
		"mode", mode,
		"run", runID,
		"vault", vaultID,
		"persona", diagnostic.PersonaName,
		"preferred_provider", diagnostic.PreferredProvider,
		"provider", diagnostic.Provider,
		"fallback_provider", diagnostic.FallbackProvider,
		"prompt_chars", diagnostic.PromptChars,
		"category", diagnostic.ErrorCategory,
		"err", models.SanitizePipelineDiagnosticText(diagnostic.ErrorSummary),
	)
}

func shouldRetryPersonaJSON(err error) bool {
	return categorizePersonaError(err) == "json_parse"
}

func buildPersonaJSONRetryPrompt(prompt string) string {
	return prompt + `

RETRY INSTRUCTIONS:
Your previous persona response could not be parsed as JSON. Try again once.
Return exactly one JSON object matching the requested persona schema.
Do not include markdown, comments, prose, trailing commas, or duplicate object keys.
Use empty arrays for unknown list fields and a numeric confidence between 0 and 1.`
}

func categorizePersonaError(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.Canceled) {
		return "cancelled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "rate limit") || strings.Contains(message, "status 429") || strings.Contains(message, "too many requests"):
		return "rate_limit"
	case strings.Contains(message, "failed to parse json") ||
		strings.Contains(message, "unexpected end of json") ||
		strings.Contains(message, "invalid character") ||
		strings.Contains(message, "json response"):
		return "json_parse"
	case strings.Contains(message, "no model providers") || strings.Contains(message, "unavailable"):
		return "provider_unavailable"
	case strings.Contains(message, "api returned status") || strings.Contains(message, "failed to send request") || strings.Contains(message, "no choices returned"):
		return "provider_error"
	default:
		return "unknown"
	}
}

func (b *Brain) broadcastPartialPersonaAnalysisWarning(personas []Persona, failedPersonas map[string]struct{}, successCount int) {
	if len(failedPersonas) == 0 {
		return
	}

	missing := make([]string, 0, len(failedPersonas))
	for _, persona := range personas {
		if _, failed := failedPersonas[persona.Name]; failed {
			missing = append(missing, persona.Name)
		}
	}
	if len(missing) == 0 {
		return
	}

	b.broadcastSystemLog(fmt.Sprintf(
		"Partial persona analysis completed: %d/%d personas succeeded; missing %s.",
		successCount,
		len(personas),
		strings.Join(missing, ", "),
	))
}
