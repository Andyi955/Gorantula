package brain

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Andyi955/Gorantula/models"
)

const (
	RabbitHoleGuidedMode RabbitHoleDescentMode = "guided"
	RabbitHoleMaxMode    RabbitHoleDescentMode = "max"

	maxRabbitHolePasses = 3
)

func rabbitHoleLogf(format string, args ...interface{}) {
	log.Printf("[RabbitHole] "+format, args...)
}

type rabbitHoleRunLogger struct {
	path string
	mu   sync.Mutex
}

func newRabbitHoleRunLogger(vaultID, runID, prompt string) (*rabbitHoleRunLogger, error) {
	return newRabbitHoleRunLoggerInRoot(filepath.Join("abdomen_vault", "rabbit-hole-logs"), vaultID, runID, prompt)
}

func newRabbitHoleRunLoggerInRoot(root, vaultID, runID, prompt string) (*rabbitHoleRunLogger, error) {
	if err := os.MkdirAll(root, 0755); err != nil {
		return nil, err
	}
	now := time.Now()
	fileName := fmt.Sprintf(
		"%s-%s-%s.txt",
		rabbitHoleLogFilePart(vaultID, "vault"),
		rabbitHoleLogFilePart(runID, "run"),
		now.Format("20060102-150405"),
	)
	logger := &rabbitHoleRunLogger{path: filepath.Join(root, fileName)}
	header := strings.Join([]string{
		"Rabbit Hole Run Trace",
		"=====================",
		fmt.Sprintf("Started: %s", now.Format(time.RFC3339)),
		fmt.Sprintf("Vault: %s", strings.TrimSpace(vaultID)),
		fmt.Sprintf("Run: %s", strings.TrimSpace(runID)),
		fmt.Sprintf("Prompt: %s", strings.TrimSpace(prompt)),
		"",
	}, "\n")
	if err := os.WriteFile(logger.path, []byte(header), 0644); err != nil {
		return nil, err
	}
	return logger, nil
}

func rabbitHoleLogFilePart(value, fallback string) string {
	part := safeNodeIDPart(value)
	if part == "" || part == "vault" {
		part = safeNodeIDPart(fallback)
	}
	runes := []rune(part)
	if len(runes) > 80 {
		part = string(runes[:80])
	}
	return part
}

func (logger *rabbitHoleRunLogger) Path() string {
	if logger == nil {
		return ""
	}
	return logger.path
}

func (logger *rabbitHoleRunLogger) Logf(format string, args ...interface{}) {
	message := fmt.Sprintf(format, args...)
	rabbitHoleLogf("%s", message)
	if logger == nil || logger.path == "" {
		return
	}
	logger.mu.Lock()
	defer logger.mu.Unlock()
	line := fmt.Sprintf("%s [RabbitHole] %s\n", time.Now().Format(time.RFC3339), message)
	if err := appendTextFile(logger.path, line); err != nil {
		log.Printf("[RabbitHole] failed to append run trace %s: %v", logger.path, err)
	}
}

func (logger *rabbitHoleRunLogger) WriteSection(title, body string) {
	if logger == nil || logger.path == "" {
		return
	}
	logger.mu.Lock()
	defer logger.mu.Unlock()
	section := fmt.Sprintf("\n%s\n%s\n\n%s\n", title, strings.Repeat("-", len(title)), strings.TrimSpace(body))
	if err := appendTextFile(logger.path, section); err != nil {
		log.Printf("[RabbitHole] failed to append run trace section %s: %v", logger.path, err)
	}
}

func appendTextFile(path, text string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.WriteString(text)
	return err
}

func rabbitHoleLogSnippet(value string, maxRunes int) string {
	value = strings.Join(strings.Fields(value), " ")
	if maxRunes <= 0 {
		maxRunes = 120
	}
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return strings.TrimSpace(string(runes[:maxRunes])) + "..."
}

type RabbitHoleDescentMode string

type RabbitHoleRunOptions struct {
	ContinuationPass int
	PriorFindings    []string
	SuggestedQueries []string
}

type RabbitHoleGatekeeperInput struct {
	OriginalPrompt string
	PassNumber     int
	Findings       []string
}

type RabbitHoleGatekeeperDecision struct {
	Continue         bool     `json:"continue"`
	Reason           string   `json:"reason"`
	StopReason       string   `json:"stopReason,omitempty"`
	NoveltyScore     float32  `json:"noveltyScore"`
	SuggestedQueries []string `json:"suggestedQueries,omitempty"`
}

func normalizeRabbitHoleDescentMode(mode RabbitHoleDescentMode) RabbitHoleDescentMode {
	switch strings.ToLower(strings.TrimSpace(string(mode))) {
	case string(RabbitHoleMaxMode):
		return RabbitHoleMaxMode
	default:
		return RabbitHoleGuidedMode
	}
}

func cleanRabbitHoleStringList(values []string, limit int) []string {
	seen := map[string]struct{}{}
	clean := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(strings.Join(strings.Fields(value), " "))
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		clean = append(clean, value)
		if limit > 0 && len(clean) >= limit {
			break
		}
	}
	return clean
}

func normalizeRabbitHoleRunOptions(options RabbitHoleRunOptions) RabbitHoleRunOptions {
	startPass := options.ContinuationPass
	if startPass <= 0 {
		startPass = 1
	}
	if startPass > maxRabbitHolePasses {
		startPass = maxRabbitHolePasses
	}
	return RabbitHoleRunOptions{
		ContinuationPass: startPass,
		PriorFindings:    cleanRabbitHoleStringList(options.PriorFindings, maxRabbitHolePasses),
		SuggestedQueries: cleanRabbitHoleStringList(options.SuggestedQueries, 6),
	}
}

func sanitizeRabbitHoleDecision(decision RabbitHoleGatekeeperDecision) RabbitHoleGatekeeperDecision {
	decision.Reason = strings.TrimSpace(decision.Reason)
	decision.StopReason = strings.TrimSpace(decision.StopReason)
	decision.SuggestedQueries = cleanRabbitHoleStringList(decision.SuggestedQueries, 6)
	if decision.Continue && len(decision.SuggestedQueries) == 0 {
		decision.Continue = false
		if decision.StopReason == "" {
			decision.StopReason = "No new search angles remain."
		}
	}
	if !decision.Continue && decision.StopReason == "" {
		if decision.Reason != "" {
			decision.StopReason = decision.Reason
		} else {
			decision.StopReason = "The Rabbit Hole gatekeeper found no high-value continuation."
		}
	}
	return decision
}

func (b *Brain) EvaluateRabbitHoleGatekeeper(ctx context.Context, input RabbitHoleGatekeeperInput) (RabbitHoleGatekeeperDecision, error) {
	provider := b.GetSearchProvider()
	if provider == nil {
		return RabbitHoleGatekeeperDecision{}, fmt.Errorf("no AI model providers are configured or available")
	}

	findings := strings.TrimSpace(strings.Join(input.Findings, "\n\n---\n\n"))
	if findings == "" {
		findings = "No findings were gathered."
	}

	prompt := fmt.Sprintf(`You are the Rabbit Hole Gatekeeper for an investigative research system.
Decide whether pass %d should continue for the original prompt.

Original prompt:
%s

Findings so far:
%s

Stop when the remaining trails are repetitive, weakly sourced, too generic, or unlikely to add new evidence.
Continue only when there are concrete new angles that can be searched next.
Return ONLY JSON with:
- continue: boolean
- reason: short explanation
- stopReason: short explanation when stopping
- noveltyScore: number from 0 to 1
- suggestedQueries: up to 6 concrete follow-up search queries`, input.PassNumber, input.OriginalPrompt, findings)

	var decision RabbitHoleGatekeeperDecision
	if err := b.generateJSONWithFallback(ctx, "rabbit hole gatekeeper", provider, prompt, &decision); err != nil {
		return RabbitHoleGatekeeperDecision{}, err
	}
	return sanitizeRabbitHoleDecision(decision), nil
}

func buildRabbitHolePassPrompt(originalPrompt string, passNumber int, suggestedQueries []string) string {
	originalPrompt = strings.TrimSpace(originalPrompt)
	if passNumber <= 1 {
		return "Rabbit Hole deep investigation into: " + originalPrompt
	}
	return fmt.Sprintf(
		"Rabbit Hole continuation pass %d for: %s\nFocus only on these still-open angles: %s\nAvoid repeating sources or generic background already covered.",
		passNumber,
		originalPrompt,
		strings.Join(suggestedQueries, "; "),
	)
}

func rabbitHoleEvidenceSummaries(records []RabbitHoleEvidenceRecord) []string {
	summaries := make([]string, 0, len(records))
	for _, record := range records {
		content := rabbitHoleExcerpt(record.Content, 1200, 0)
		if content == "" {
			continue
		}
		summaries = append(summaries, fmt.Sprintf("[%s] %s\n%s", record.Tool, record.Source, content))
	}
	return summaries
}

func (b *Brain) appendRabbitHoleMemoryAndBroadcast(logger *rabbitHoleRunLogger, node models.MemoryNode, memory string, vaultID string, appendToVault bool) {
	totalMemories := 0
	if b.Abdomen != nil {
		b.Abdomen.Mutex.Lock()
		b.Abdomen.MemoryContext = append(b.Abdomen.MemoryContext, memory)
		totalMemories = len(b.Abdomen.MemoryContext)
		b.Abdomen.Mutex.Unlock()
	}
	if b.NS != nil && b.NS.Broadcast != nil {
		logger.Logf(
			"node broadcast vault=%s node=%s state=%s tool=%s pass=%d append=%t memoryTotal=%d title=%q",
			vaultID,
			node.ID,
			node.RabbitState,
			node.RabbitTool,
			node.RabbitPass,
			appendToVault,
			totalMemories,
			rabbitHoleLogSnippet(node.Title, 80),
		)
		b.NS.Broadcast(models.WSMessage{
			Type: "MEMORY_NODE_GATHERED",
			Payload: map[string]interface{}{
				"node":    node,
				"total":   totalMemories,
				"vaultId": vaultID,
				"append":  appendToVault,
			},
		})
	}
}

func (b *Brain) broadcastRabbitHoleToolEvent(logger *rabbitHoleRunLogger, vaultID string, pass int, task RabbitHoleToolTask, status string, detail string) {
	logger.Logf(
		"tool event vault=%s pass=%d tool=%s id=%s status=%s query=%q detail=%q",
		vaultID,
		pass,
		task.Tool,
		task.ID,
		status,
		rabbitHoleLogSnippet(task.Query, 120),
		rabbitHoleLogSnippet(detail, 160),
	)
	if b.NS == nil || b.NS.Broadcast == nil {
		return
	}
	b.NS.Broadcast(models.WSMessage{
		Type: "RABBIT_HOLE_TOOL_EVENT",
		Payload: map[string]interface{}{
			"vaultId":   vaultID,
			"pass":      pass,
			"toolId":    task.ID,
			"tool":      task.Tool,
			"query":     task.Query,
			"status":    status,
			"detail":    detail,
			"rationale": task.Rationale,
		},
	})
}

func (b *Brain) promoteRabbitHoleNodes(logger *rabbitHoleRunLogger, vaultID string, nodeIDs []string) {
	logger.Logf("promoting nodes vault=%s count=%d ids=%s", vaultID, len(nodeIDs), strings.Join(nodeIDs, ","))
	if b.NS == nil || b.NS.Broadcast == nil || len(nodeIDs) == 0 {
		return
	}
	b.NS.Broadcast(models.WSMessage{
		Type: "RABBIT_HOLE_NODE_UPDATE",
		Payload: map[string]interface{}{
			"vaultId":     vaultID,
			"nodeIds":     nodeIDs,
			"rabbitState": RabbitHoleNodeStatePromoted,
		},
	})
}

func (b *Brain) synthesizeRabbitHolePass(ctx context.Context, provider ModelProvider, originalPrompt string, pass int, records []RabbitHoleEvidenceRecord) (string, error) {
	if len(records) == 0 {
		return "", fmt.Errorf("Rabbit Hole pass %d gathered no evidence", pass)
	}
	prompt := fmt.Sprintf(`You are compiling Rabbit Hole pass %d.
Original investigation:
%s

Evidence ledger:
%s

Write a concise investigative pass report. Preserve source grounding, unresolved leads, contradictions, timeline points, and repeated entities.`, pass, originalPrompt, strings.Join(rabbitHoleEvidenceSummaries(records), "\n\n---\n\n"))
	return b.generateContentWithFallback(ctx, "rabbit hole pass synthesis", provider, prompt)
}

func (b *Brain) runRabbitHoleToolPass(ctx context.Context, originalPrompt string, vaultID string, pass int, tasks []RabbitHoleToolTask, scrapeImages bool, appendToVault bool, progress *models.PipelineProgressTracker, ledger []RabbitHoleEvidenceRecord, logger *rabbitHoleRunLogger) ([]RabbitHoleEvidenceRecord, []string, int, error) {
	provider := b.GetSearchProvider()
	if provider == nil {
		return nil, nil, 0, fmt.Errorf("no AI model providers are configured or available")
	}
	logger.Logf(
		"pass %d tool runtime start vault=%s tasks=%d ledger=%d scrapeImages=%t append=%t prompt=%q",
		pass,
		vaultID,
		len(tasks),
		len(ledger),
		scrapeImages,
		appendToVault,
		rabbitHoleLogSnippet(originalPrompt, 140),
	)
	passRecords := []RabbitHoleEvidenceRecord{}
	nodeIDs := []string{}
	reviewedImages := 0

	webTasks := []RabbitHoleToolTask{}
	for _, task := range tasks {
		b.broadcastRabbitHoleToolEvent(logger, vaultID, pass, task, "queued", task.Rationale)
		if task.Tool == RabbitHoleToolWebSearch {
			webTasks = append(webTasks, task)
		}
	}

	if len(webTasks) > 0 {
		signals := make([]models.NerveSignal, 0, len(webTasks))
		for index, task := range webTasks {
			signals = append(signals, models.NerveSignal{TargetQuery: task.Query, LegID: index})
			b.broadcastRabbitHoleToolEvent(logger, vaultID, pass, task, "running", "Searching and fetching web evidence")
		}
		logger.Logf("pass %d dispatch web_search signals=%d vault=%s", pass, len(signals), vaultID)
		nutrients, err := b.NS.RunSignals(ctx, signals)
		if err != nil {
			logger.Logf("pass %d web_search failed vault=%s err=%v", pass, vaultID, err)
			return nil, nil, reviewedImages, err
		}
		logger.Logf("pass %d web_search returned nutrients=%d vault=%s", pass, len(nutrients), vaultID)
		summaryCtx, summaryScopeID := b.StartPipelineTokenScope(ctx, "rabbit-node-summary", "gather_evidence")
		imageCtx, imageScopeID := b.StartPipelineTokenScope(ctx, "rabbit-image-review", "image_review")
		processed := squashDuplicateProcessedNutrients(b.processNutrients(summaryCtx, nutrients, nutrientProcessingOptions{
			VaultID:            vaultID,
			ScrapeImages:       scrapeImages,
			Provider:           provider,
			ImageReviewContext: imageCtx,
			Progress:           progress,
		}))
		logger.Logf("pass %d web_search processed nodes=%d vault=%s", pass, len(processed), vaultID)
		if progress != nil {
			b.RecordPipelineTokenUsage(progress, summaryScopeID)
			if scrapeImages {
				b.RecordPipelineTokenUsage(progress, imageScopeID)
			}
		}
		for _, result := range processed {
			task := webTasks[0]
			if result.index >= 0 && result.index < len(webTasks) {
				task = webTasks[result.index]
			}
			result.node.Origin = "rabbit-hole"
			result.node.RabbitState = RabbitHoleNodeStateProvisional
			result.node.RabbitTool = task.Tool
			result.node.RabbitPass = pass
			result.node.Confidence = 0.64
			reviewedImages += result.reviewedImages
			record := RabbitHoleEvidenceRecord{
				Tool:      task.Tool,
				Query:     task.Query,
				Source:    result.node.SourceURL,
				Content:   result.node.FullText,
				Rationale: task.Rationale,
				NodeID:    result.node.ID,
				Pass:      pass,
			}
			passRecords = append(passRecords, record)
			nodeIDs = append(nodeIDs, result.node.ID)
			logger.Logf(
				"pass %d provisional web node=%s source=%q confidence=%.2f imagesReviewed=%d",
				pass,
				result.node.ID,
				rabbitHoleLogSnippet(result.node.SourceURL, 140),
				result.node.Confidence,
				result.reviewedImages,
			)
			b.appendRabbitHoleMemoryAndBroadcast(logger, result.node, result.memory, vaultID, appendToVault)
			b.broadcastRabbitHoleToolEvent(logger, vaultID, pass, task, "complete", "Created provisional evidence node")
		}
	}

	for _, task := range tasks {
		if err := checkPipelineContext(ctx); err != nil {
			return nil, nil, reviewedImages, err
		}
		switch task.Tool {
		case RabbitHoleToolVaultSearch:
			b.broadcastRabbitHoleToolEvent(logger, vaultID, pass, task, "running", "Searching saved investigations")
			records := searchRabbitHoleVaultMemoryInRoot("./abdomen_vault", vaultID, task.Query, 3)
			logger.Logf("pass %d vault_search query=%q results=%d", pass, rabbitHoleLogSnippet(task.Query, 120), len(records))
			for index, record := range records {
				record.Rationale = task.Rationale
				record.Pass = pass
				node := b.buildTaggedRabbitHoleProvisionalNode(ctx, models.NutrientFlow{
					SourceURL: record.Source,
					Content:   record.Content,
				}, task, vaultID, pass, index)
				record.NodeID = node.ID
				passRecords = append(passRecords, record)
				nodeIDs = append(nodeIDs, node.ID)
				logger.Logf("pass %d provisional vault node=%s source=%q", pass, node.ID, rabbitHoleLogSnippet(record.Source, 140))
				b.appendRabbitHoleMemoryAndBroadcast(logger, node, fmt.Sprintf("Source: %s\nContent: %s", record.Source, record.Content), vaultID, appendToVault)
			}
			b.broadcastRabbitHoleToolEvent(logger, vaultID, pass, task, "complete", fmt.Sprintf("Found %d vault memory echoes", len(records)))
		case RabbitHoleToolTimelineContext:
			b.broadcastRabbitHoleToolEvent(logger, vaultID, pass, task, "running", "Extracting chronology")
			record := buildRabbitHoleTimelineContext(append(append([]RabbitHoleEvidenceRecord{}, ledger...), passRecords...), task.Query)
			logger.Logf("pass %d timeline_context sourceRecords=%d query=%q", pass, len(ledger)+len(passRecords), rabbitHoleLogSnippet(task.Query, 120))
			record.Rationale = task.Rationale
			record.Pass = pass
			node := b.buildTaggedRabbitHoleProvisionalNode(ctx, models.NutrientFlow{
				SourceURL: record.Source,
				Content:   record.Content,
			}, task, vaultID, pass, len(passRecords))
			record.NodeID = node.ID
			passRecords = append(passRecords, record)
			nodeIDs = append(nodeIDs, node.ID)
			logger.Logf("pass %d provisional timeline node=%s", pass, node.ID)
			b.appendRabbitHoleMemoryAndBroadcast(logger, node, fmt.Sprintf("Source: %s\nContent: %s", record.Source, record.Content), vaultID, appendToVault)
			b.broadcastRabbitHoleToolEvent(logger, vaultID, pass, task, "complete", "Created timeline context node")
		}
	}

	logger.Logf("pass %d tool runtime complete vault=%s records=%d nodes=%d imagesReviewed=%d", pass, vaultID, len(passRecords), len(nodeIDs), reviewedImages)
	return passRecords, nodeIDs, reviewedImages, nil
}

func (b *Brain) ProcessRabbitHoleForVaultWithProgress(ctx context.Context, prompt, vaultID string, appendToVault bool, scrapeImages bool, descentMode RabbitHoleDescentMode, progress *models.PipelineProgressTracker) (string, error) {
	return b.ProcessRabbitHoleForVaultWithRunOptions(ctx, prompt, vaultID, appendToVault, scrapeImages, descentMode, progress, RabbitHoleRunOptions{})
}

func (b *Brain) ProcessRabbitHoleForVaultWithRunOptions(ctx context.Context, prompt, vaultID string, appendToVault bool, scrapeImages bool, descentMode RabbitHoleDescentMode, progress *models.PipelineProgressTracker, options RabbitHoleRunOptions) (string, error) {
	prompt = strings.TrimSpace(prompt)
	vaultID = strings.TrimSpace(vaultID)
	if prompt == "" {
		return "", fmt.Errorf("Rabbit Hole crawl requires a prompt")
	}
	if vaultID == "" {
		return "", fmt.Errorf("Rabbit Hole crawl requires a target investigation")
	}

	mode := normalizeRabbitHoleDescentMode(descentMode)
	runOptions := normalizeRabbitHoleRunOptions(options)
	passSummaries := append([]string{}, runOptions.PriorFindings...)
	suggestedQueries := append([]string{}, runOptions.SuggestedQueries...)
	evidenceLedger := []RabbitHoleEvidenceRecord{}
	rabbitNodeIDs := []string{}
	finalSynthesis := ""
	finalVaultPath := ""
	lastDecision := RabbitHoleGatekeeperDecision{Continue: false, StopReason: "Rabbit Hole completed."}
	provider := b.GetSearchProvider()
	if provider == nil {
		return "", fmt.Errorf("no AI model providers are configured or available")
	}
	logger, loggerErr := newRabbitHoleRunLogger(vaultID, pipelineRunID(progress), prompt)
	if loggerErr != nil {
		rabbitHoleLogf("log file unavailable vault=%s run=%s err=%v", vaultID, pipelineRunID(progress), loggerErr)
	}
	logger.Logf("log file path=%s", logger.Path())
	logger.Logf(
		"start vault=%s run=%s mode=%s append=%t scrapeImages=%t continuationPass=%d priorFindings=%d suggestedQueries=%d prompt=%q",
		vaultID,
		pipelineRunID(progress),
		mode,
		appendToVault,
		scrapeImages,
		runOptions.ContinuationPass,
		len(runOptions.PriorFindings),
		len(runOptions.SuggestedQueries),
		rabbitHoleLogSnippet(prompt, 180),
	)

	for pass := runOptions.ContinuationPass; pass <= maxRabbitHolePasses; pass++ {
		if err := checkPipelineContext(ctx); err != nil {
			return "", err
		}
		logger.Logf("pass %d start vault=%s ledger=%d priorFindings=%d suggestedQueries=%d", pass, vaultID, len(evidenceLedger), len(runOptions.PriorFindings), len(suggestedQueries))

		b.broadcastPipelineProgress(progress, progressMessage(progress, "plan_queries", "running", fmt.Sprintf("Planning Rabbit Hole pass %d tool tasks", pass)))
		evidenceSummaries := append([]string{}, runOptions.PriorFindings...)
		evidenceSummaries = append(evidenceSummaries, rabbitHoleEvidenceSummaries(evidenceLedger)...)
		tasks, err := b.planRabbitHoleToolTasks(ctx, RabbitHolePlanningInput{
			OriginalPrompt:    prompt,
			PassNumber:        pass,
			SuggestedQueries:  suggestedQueries,
			EvidenceSummaries: evidenceSummaries,
		})
		if err != nil {
			return "", err
		}
		for _, task := range tasks {
			logger.Logf(
				"pass %d plan task id=%s tool=%s query=%q rationale=%q",
				pass,
				task.ID,
				task.Tool,
				rabbitHoleLogSnippet(task.Query, 140),
				rabbitHoleLogSnippet(task.Rationale, 160),
			)
		}
		b.broadcastPipelineProgress(progress, progressMessage(progress, "plan_queries", "complete", fmt.Sprintf("Planned %d Rabbit Hole tool tasks", len(tasks))))
		b.broadcastPipelineProgress(progress, progressMessage(progress, "dispatch_legs", "complete", fmt.Sprintf("Dispatched %d Rabbit Hole tool tasks", len(tasks))))
		b.broadcastPipelineProgress(progress, progressMessage(progress, "gather_evidence", "running", "Running Rabbit Hole tool agents"))
		passRecords, passNodeIDs, reviewedImages, err := b.runRabbitHoleToolPass(ctx, prompt, vaultID, pass, tasks, scrapeImages, appendToVault || pass > 1, progress, evidenceLedger, logger)
		if err != nil {
			return "", err
		}
		evidenceLedger = append(evidenceLedger, passRecords...)
		rabbitNodeIDs = append(rabbitNodeIDs, passNodeIDs...)
		logger.Logf("pass %d gathered vault=%s passRecords=%d totalLedger=%d passNodes=%d totalNodes=%d", pass, vaultID, len(passRecords), len(evidenceLedger), len(passNodeIDs), len(rabbitNodeIDs))
		b.broadcastPipelineProgress(progress, progressMessage(progress, "gather_evidence", "complete", fmt.Sprintf("Created %d live provisional Rabbit nodes", len(passNodeIDs))))
		if scrapeImages {
			b.broadcastPipelineProgress(progress, progressMessage(progress, "image_review", "complete", fmt.Sprintf("Reviewed %d images", reviewedImages)))
		} else {
			b.broadcastPipelineProgress(progress, progressMessage(progress, "image_review", "complete", "Image review skipped"))
		}

		b.broadcastPipelineProgress(progress, progressMessage(progress, "final_report", "running", fmt.Sprintf("Synthesizing Rabbit Hole pass %d", pass)))
		result, err := b.synthesizeRabbitHolePass(ctx, provider, prompt, pass, evidenceLedger)
		if err != nil {
			return "", err
		}
		finalSynthesis = result
		passSummaries = append(passSummaries, fmt.Sprintf("Pass %d summary:\n%s", pass, result))
		logger.Logf("pass %d synthesis complete chars=%d", pass, len([]rune(result)))
		b.broadcastPipelineProgress(progress, progressMessage(progress, "final_report", "complete", "Rabbit Hole pass report generated"))

		b.broadcastPipelineProgress(progress, progressMessage(progress, "vault_persistence", "running", "Persisting Rabbit Hole pass report"))
		vaultPath, err := saveVaultMemory(buildRabbitHolePassPrompt(prompt, pass, suggestedQueries), strings.Join(rabbitHoleEvidenceSummaries(evidenceLedger), "\n\n"), finalSynthesis, vaultID, appendToVault || pass > 1)
		if err != nil {
			logger.Logf("vault save failed vault=%s pass=%d err=%v", vaultID, pass, err)
		} else {
			finalVaultPath = vaultPath
			logger.Logf("vault saved vault=%s pass=%d path=%s", vaultID, pass, vaultPath)
		}
		b.broadcastPipelineProgress(progress, progressMessage(progress, "vault_persistence", "complete", "Rabbit Hole vault memory saved"))

		b.broadcastPipelineProgress(progress, progressMessage(progress, "rabbit_gatekeeper", "running", fmt.Sprintf("Evaluating pass %d", pass)))
		decision, err := b.EvaluateRabbitHoleGatekeeper(ctx, RabbitHoleGatekeeperInput{
			OriginalPrompt: prompt,
			PassNumber:     pass,
			Findings:       passSummaries,
		})
		if err != nil {
			return "", err
		}
		lastDecision = decision
		if pass >= maxRabbitHolePasses && decision.Continue {
			decision.Continue = false
			decision.StopReason = "Maximum Rabbit Hole descent reached."
			lastDecision = decision
		}
		logger.Logf(
			"gatekeeper pass=%d vault=%s continue=%t novelty=%.2f suggested=%d reason=%q stop=%q",
			pass,
			vaultID,
			decision.Continue,
			decision.NoveltyScore,
			len(decision.SuggestedQueries),
			rabbitHoleLogSnippet(decision.Reason, 220),
			rabbitHoleLogSnippet(decision.StopReason, 220),
		)
		b.broadcastPipelineProgress(progress, progressMessage(progress, "rabbit_gatekeeper", "complete", decision.Reason))
		if b.NS != nil && b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type: "RABBIT_HOLE_GATEKEEPER",
				Payload: map[string]interface{}{
					"vaultId":     vaultID,
					"runId":       pipelineRunID(progress),
					"pass":        pass,
					"descentMode": string(mode),
					"decision":    decision,
					"result":      finalSynthesis,
					"prompt":      prompt,
				},
			})
		}

		if mode == RabbitHoleGuidedMode && decision.Continue {
			logger.Logf("guided awaiting operator vault=%s pass=%d suggested=%d", vaultID, pass, len(decision.SuggestedQueries))
			logger.WriteSection("Latest Rabbit Hole Synthesis", finalSynthesis)
			b.broadcastPipelineProgress(progress, progressMessage(progress, "complete", "complete", "Gatekeeper awaiting operator decision"))
			if b.NS != nil && b.NS.Broadcast != nil {
				b.NS.Broadcast(models.WSMessage{Type: "BRAIN_STATE", Payload: "Rabbit Hole awaiting operator decision"})
			}
			return finalSynthesis, nil
		}
		if mode == RabbitHoleGuidedMode || !decision.Continue {
			logger.Logf("stopping descent vault=%s pass=%d mode=%s continue=%t", vaultID, pass, mode, decision.Continue)
			break
		}
		suggestedQueries = decision.SuggestedQueries
		logger.Logf("continuing descent vault=%s nextPass=%d suggestedQueries=%d", vaultID, pass+1, len(suggestedQueries))
	}

	if b.NS != nil && b.NS.Broadcast != nil {
		b.promoteRabbitHoleNodes(logger, vaultID, rabbitNodeIDs)
		detail := lastDecision.StopReason
		if detail == "" {
			detail = lastDecision.Reason
		}
		if detail == "" {
			detail = "Rabbit Hole descent complete."
		}
		b.NS.Broadcast(models.WSMessage{Type: "BRAIN_STATE", Payload: "Done"})
		logger.Logf("complete vault=%s run=%s nodesPromoted=%d vaultPath=%s rabbitLogPath=%s detail=%q", vaultID, pipelineRunID(progress), len(rabbitNodeIDs), finalVaultPath, logger.Path(), rabbitHoleLogSnippet(detail, 220))
		logger.WriteSection("Final Rabbit Hole Synthesis", finalSynthesis)
		b.NS.Broadcast(models.WSMessage{
			Type: "SYNTHESIS_COMPLETE",
			Payload: map[string]interface{}{
				"result":        finalSynthesis,
				"vaultPath":     finalVaultPath,
				"vaultId":       vaultID,
				"append":        false,
				"prompt":        prompt,
				"runId":         pipelineRunID(progress),
				"mode":          "rabbit-hole",
				"detail":        detail,
				"rabbitLogPath": logger.Path(),
			},
		})
	}

	return finalSynthesis, nil
}
