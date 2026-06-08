package brain

import (
	"context"
	"fmt"
	"strings"
	"time"

	"spider-agent/models"
)

// ProcessPrompt runs the entire lifecycle for a given user prompt.
func (b *Brain) ProcessPrompt(ctx context.Context, prompt string) (string, error) {
	return b.ProcessPromptWithOptions(ctx, prompt, false)
}

func (b *Brain) ProcessPromptWithOptions(ctx context.Context, prompt string, scrapeImages bool) (string, error) {
	return b.processPrompt(ctx, prompt, "", false, scrapeImages, nil)
}

func (b *Brain) ProcessPromptWithProgress(ctx context.Context, prompt string, scrapeImages bool, progress *models.PipelineProgressTracker) (string, error) {
	return b.processPrompt(ctx, prompt, "", false, scrapeImages, progress)
}

// ProcessPromptForVault runs a new investigation crawl while targeting a specific investigation vault ID.
func (b *Brain) ProcessPromptForVault(ctx context.Context, prompt, vaultID string) (string, error) {
	return b.ProcessPromptForVaultWithOptions(ctx, prompt, vaultID, false)
}

func (b *Brain) ProcessPromptForVaultWithOptions(ctx context.Context, prompt, vaultID string, scrapeImages bool) (string, error) {
	return b.processPrompt(ctx, prompt, strings.TrimSpace(vaultID), false, scrapeImages, nil)
}

func (b *Brain) ProcessPromptForVaultWithProgress(ctx context.Context, prompt, vaultID string, scrapeImages bool, progress *models.PipelineProgressTracker) (string, error) {
	return b.processPrompt(ctx, prompt, strings.TrimSpace(vaultID), false, scrapeImages, progress)
}

// ProcessPromptIntoVault appends a web crawl into an existing investigation vault.
func (b *Brain) ProcessPromptIntoVault(ctx context.Context, prompt, vaultID string) (string, error) {
	return b.ProcessPromptIntoVaultWithOptions(ctx, prompt, vaultID, false)
}

func (b *Brain) ProcessPromptIntoVaultWithOptions(ctx context.Context, prompt, vaultID string, scrapeImages bool) (string, error) {
	return b.processPrompt(ctx, prompt, strings.TrimSpace(vaultID), true, scrapeImages, nil)
}

func (b *Brain) ProcessPromptIntoVaultWithProgress(ctx context.Context, prompt, vaultID string, scrapeImages bool, progress *models.PipelineProgressTracker) (string, error) {
	return b.processPrompt(ctx, prompt, strings.TrimSpace(vaultID), true, scrapeImages, progress)
}

func notifyImageReviewUnavailable(provider ModelProvider, broadcast models.Broadcaster) {
	if provider == nil || provider.SupportsImageReview() {
		return
	}

	message := fmt.Sprintf(
		"Image scraping is enabled, but provider '%s' does not support multimodal image review. Falling back to basic image scraping for this crawl.",
		provider.Name(),
	)
	fmt.Println("[Brain Warning]", message)
	if broadcast != nil {
		broadcast(models.WSMessage{
			Type:    "SYSTEM_LOG",
			Payload: message,
		})
	}
}

func (b *Brain) broadcastPipelineProgress(progress *models.PipelineProgressTracker, message models.WSMessage) {
	if progress == nil || b == nil || b.NS == nil || b.NS.Broadcast == nil {
		return
	}
	b.NS.Broadcast(message)
}

func progressMessage(progress *models.PipelineProgressTracker, stepID, status, detail string) models.WSMessage {
	if progress == nil {
		return models.WSMessage{}
	}
	switch status {
	case models.PipelineStatusRunning:
		return progress.Start(stepID, detail)
	case models.PipelineStatusComplete:
		return progress.Complete(stepID, detail)
	case models.PipelineStatusError:
		return progress.Error(stepID, detail)
	default:
		return progress.Start(stepID, detail)
	}
}

func checkPipelineContext(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	return ctx.Err()
}

func pipelineRunID(progress *models.PipelineProgressTracker) string {
	if progress == nil {
		return ""
	}
	return progress.RunID()
}

type processPromptRunOptions struct {
	SuppressSynthesisComplete bool
	SuppressTerminalComplete  bool
	NodeOrigin                string
}

func (b *Brain) processPrompt(ctx context.Context, prompt, vaultID string, isAppend bool, scrapeImages bool, progress *models.PipelineProgressTracker) (string, error) {
	return b.processPromptWithRunOptions(ctx, prompt, vaultID, isAppend, scrapeImages, progress, processPromptRunOptions{})
}

func (b *Brain) processPromptWithRunOptions(ctx context.Context, prompt, vaultID string, isAppend bool, scrapeImages bool, progress *models.PipelineProgressTracker, options processPromptRunOptions) (string, error) {
	if strings.HasPrefix(strings.ToLower(prompt), "deep dive investigation into:") {
		fmt.Printf("[Brain] >>> DISPATCHING DEEP DIVE: %s <<<\n", strings.TrimPrefix(prompt, "Deep dive investigation into: "))
	} else {
		fmt.Printf("[Brain] Processing new investigation: %s\n", prompt)
	}
	if err := checkPipelineContext(ctx); err != nil {
		return "", err
	}

	// --- STEP 1: Break down into 8 queries ---
	b.broadcastPipelineProgress(progress, progressMessage(progress, "start", "running", "Operator submitted crawl"))
	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Thinking (Generating sub-queries)",
		})
	}
	b.broadcastPipelineProgress(progress, progressMessage(progress, "start", "complete", "Crawl accepted"))
	b.broadcastPipelineProgress(progress, progressMessage(progress, "plan_queries", "running", "Generating search angles"))

	currentDate := time.Now().Format("Monday, January 2, 2006")
	provider := b.GetSearchProvider()
	if provider == nil {
		return "", fmt.Errorf("no AI model providers are configured or available")
	}
	if scrapeImages && !provider.SupportsImageReview() {
		notifyImageReviewUnavailable(provider, b.NS.Broadcast)
	}

	systemInstruction := fmt.Sprintf("You are the central Brain of a web scraper. Today's current date is %s. Break the user's prompt into between 4 and 12 distinct search queries that cover varied research angles based on the complexity of the request. "+
		"Use the current date to contextualize time-sensitive queries if applicable. "+
		"Example angles: technical specifications, competitive landscape, historical context, future predictions, public sentiment/rumors, financial/market impact, recent news, and expert reviews. "+
		"Return ONLY a JSON object with a 'queries' array of strings.", currentDate)

	fullPrompt := systemInstruction + "\n\nUser Prompt: " + prompt
	var subQ SubQueries
	planCtx, planScopeID := b.StartPipelineTokenScope(ctx, "pipeline-plan", "plan_queries")
	if progress != nil {
		progress.StartSpan("plan_queries_llm", "plan_queries", "Search query planning", "LLM query decomposition")
	}
	if err := b.generateJSONWithFallback(planCtx, "query planning", provider, fullPrompt, &subQ); err != nil {
		if b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type:    "BRAIN_STATE",
				Payload: fmt.Sprintf("Provider %s failed while planning search queries.", provider.Name()),
			})
		}
		if progress != nil {
			progress.CompleteSpan("plan_queries_llm", "query planning failed")
			b.RecordPipelineTokenUsage(progress, planScopeID)
		}
		return "", fmt.Errorf("failed to generate sub-queries format: %w", err)
	}
	if err := checkPipelineContext(ctx); err != nil {
		return "", err
	}
	if progress != nil {
		progress.CompleteSpan("plan_queries_llm", "generated search queries")
		b.RecordPipelineTokenUsage(progress, planScopeID)
	}

	numQueries := len(subQ.Queries)
	if numQueries < 4 {
		numQueries = 4
	}
	if numQueries > 12 {
		numQueries = 12
	}
	// Ensure slice matches the validated length
	if len(subQ.Queries) > numQueries {
		subQ.Queries = subQ.Queries[:numQueries]
	}
	if progress != nil {
		progress.RecordCounter("queries", len(subQ.Queries))
	}
	b.broadcastPipelineProgress(progress, progressMessage(progress, "plan_queries", "complete", fmt.Sprintf("Prepared %d search angles", len(subQ.Queries))))

	// --- STEP 2: Dispatch Queries to Nervous System ---
	b.broadcastPipelineProgress(progress, progressMessage(progress, "dispatch_legs", "running", "Dispatching work to spider legs"))
	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Instructing Legs",
		})
	}

	var mediaURLs []string
	words := strings.Fields(prompt)
	for _, word := range words {
		lWord := strings.ToLower(word)
		if strings.HasPrefix(lWord, "http") && (strings.Contains(lWord, "youtube.com") || strings.Contains(lWord, "youtu.be") || strings.Contains(lWord, "vimeo.com") || strings.HasSuffix(lWord, ".mp3") || strings.HasSuffix(lWord, ".m4a") || strings.HasSuffix(lWord, ".mp4")) {
			mediaURLs = append(mediaURLs, word)
		}
	}

	var supportedMediaURLs []string
	if len(mediaURLs) > 0 {
		if !provider.SupportsMedia() {
			warningMsg := fmt.Sprintf("⚠️ Provider '%s' does not support media transcriptions. Skipping media URLs.", provider.Name())
			fmt.Println("[Brain Warning]", warningMsg)
			if b.NS.Broadcast != nil {
				b.NS.Broadcast(models.WSMessage{
					Type:    "SYSTEM_LOG",
					Payload: warningMsg,
				})
			}
		} else {
			supportedMediaURLs = mediaURLs
		}
	}

	totalLegs := numQueries + len(supportedMediaURLs)

	signals := make([]models.NerveSignal, 0, totalLegs)
	legID := 0
	for _, url := range supportedMediaURLs {
		signals = append(signals, models.NerveSignal{
			TargetQuery: url,
			LegID:       legID,
			IsMedia:     true,
		})
		legID++
	}

	for _, q := range subQ.Queries {
		signals = append(signals, models.NerveSignal{
			TargetQuery: q,
			LegID:       legID,
		})
		legID++
	}
	b.broadcastPipelineProgress(progress, progressMessage(progress, "dispatch_legs", "complete", fmt.Sprintf("Dispatched %d leg tasks", totalLegs)))

	// --- STEP 3: Wait for Nutrients and Store in Abdomen ---
	b.broadcastPipelineProgress(progress, progressMessage(progress, "gather_evidence", "running", "Gathering and summarizing evidence"))
	nutrients, err := b.NS.RunSignals(ctx, signals)
	if err != nil {
		return "", err
	}
	if err := checkPipelineContext(ctx); err != nil {
		return "", err
	}
	summaryCtx, summaryScopeID := b.StartPipelineTokenScope(ctx, "pipeline-node-summary", "node_summary")
	imageCtx, imageScopeID := b.StartPipelineTokenScope(ctx, "pipeline-image-review", "image_review")
	if progress != nil {
		progress.StartSpan("node_summary", "gather_evidence", "Node summary", fmt.Sprintf("summarizing %d nutrients", len(nutrients)))
	}
	processedNutrients := b.processNutrients(summaryCtx, nutrients, nutrientProcessingOptions{
		VaultID:            vaultID,
		ScrapeImages:       scrapeImages,
		Provider:           provider,
		ImageReviewContext: imageCtx,
		Progress:           progress,
	})
	processedNutrients = squashDuplicateProcessedNutrients(processedNutrients)
	if err := checkPipelineContext(ctx); err != nil {
		return "", err
	}
	if progress != nil {
		progress.CompleteSpan("node_summary", fmt.Sprintf("summarized %d nodes", len(processedNutrients)))
		b.RecordPipelineTokenUsage(progress, summaryScopeID)
		if scrapeImages {
			b.RecordPipelineTokenUsage(progress, imageScopeID)
		}
		progress.RecordCounter("legTasks", totalLegs)
		progress.RecordCounter("nodesCreated", len(processedNutrients))
	}
	reviewedImages := 0
	for _, result := range processedNutrients {
		reviewedImages += result.reviewedImages
		if strings.TrimSpace(options.NodeOrigin) != "" {
			result.node.Origin = strings.TrimSpace(options.NodeOrigin)
		}
		b.Abdomen.Mutex.Lock()
		b.Abdomen.MemoryContext = append(b.Abdomen.MemoryContext, result.memory)
		totalMemories := len(b.Abdomen.MemoryContext)
		b.Abdomen.Mutex.Unlock()
		if b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type: "MEMORY_NODE_GATHERED",
				Payload: map[string]interface{}{
					"node":    result.node,
					"total":   totalMemories,
					"vaultId": vaultID,
					"append":  isAppend,
				},
			})
		}
	}
	if progress != nil {
		progress.RecordCounter("imagesStored", reviewedImages)
	}
	b.broadcastPipelineProgress(progress, progressMessage(progress, "gather_evidence", "complete", fmt.Sprintf("Gathered %d evidence memories", len(b.Abdomen.MemoryContext))))
	if scrapeImages {
		b.broadcastPipelineProgress(progress, progressMessage(progress, "image_review", "complete", fmt.Sprintf("Reviewed %d images", reviewedImages)))
	} else {
		b.broadcastPipelineProgress(progress, progressMessage(progress, "image_review", "complete", "Image review skipped"))
	}

	// --- STEP 4: Synthesize Final Response ---
	b.broadcastPipelineProgress(progress, progressMessage(progress, "final_report", "running", "Synthesizing final intelligence report"))
	if err := checkPipelineContext(ctx); err != nil {
		return "", err
	}
	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Synthesizing Final Response",
		})
	}

	b.Abdomen.Mutex.RLock()
	rawFacts := b.Abdomen.MemoryContext
	b.Abdomen.Mutex.RUnlock()

	// Rank and filter facts to prevent token overflow (Generation 2: Selective Memory)
	rankCtx, rankScopeID := b.StartPipelineTokenScope(ctx, "pipeline-rank", "rank_facts")
	if progress != nil {
		progress.StartSpan("rank_facts", "final_report", "Fact ranking", fmt.Sprintf("ranking %d facts", len(rawFacts)))
	}
	contextText, err := b.RankAndFilterFacts(rankCtx, prompt, rawFacts)
	if progress != nil {
		progress.CompleteSpan("rank_facts", "ranked gathered facts")
		b.RecordPipelineTokenUsage(progress, rankScopeID)
	}
	if err != nil {
		fmt.Printf("[Brain Warning] Ranking failed, falling back to raw join: %v\n", err)
		contextText = strings.Join(rawFacts, "\n\n")
	}
	if err := checkPipelineContext(ctx); err != nil {
		return "", err
	}

	// provider is already declared above
	currentDate = time.Now().Format("Monday, January 2, 2006")

	synthesisInstruction := fmt.Sprintf("You are an expert intelligence analyst compiling a final report. Today's current date is %s. Contextualize all findings chronologically based on this date.", currentDate)

	synthesisPrompt := fmt.Sprintf(
		"%s\n\nBased on the following facts gathered by your scraping legs, provide a comprehensive answer to the user's original query.\n\nUser Query: %s\n\nGathered Facts:\n%s",
		synthesisInstruction, prompt, contextText,
	)

	finalCtx, finalScopeID := b.StartPipelineTokenScope(ctx, "pipeline-final-report", "final_report")
	if progress != nil {
		progress.StartSpan("final_report_llm", "final_report", "Final report LLM", "generating final report")
	}
	finalSynthesis, err := b.generateContentWithFallback(finalCtx, "final report", provider, synthesisPrompt)
	if err != nil {
		if b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type:    "BRAIN_STATE",
				Payload: fmt.Sprintf("Provider %s failed while generating final report.", provider.Name()),
			})
		}
		if progress != nil {
			progress.CompleteSpan("final_report_llm", "final report failed")
			b.RecordPipelineTokenUsage(progress, finalScopeID)
		}
		return "", fmt.Errorf("failed to generate final synthesis: %w", err)
	}
	if err := checkPipelineContext(ctx); err != nil {
		return "", err
	}
	if progress != nil {
		progress.CompleteSpan("final_report_llm", "generated final report")
		b.RecordPipelineTokenUsage(progress, finalScopeID)
	}
	b.broadcastPipelineProgress(progress, progressMessage(progress, "final_report", "complete", "Final intelligence report generated"))

	// Save to Vault
	b.broadcastPipelineProgress(progress, progressMessage(progress, "vault_persistence", "running", "Persisting report to vault"))
	vaultPath, err := saveVaultMemory(prompt, contextText, finalSynthesis, vaultID, isAppend)
	if err != nil {
		fmt.Printf("Warning: failed to save vault memory: %v\n", err)
	}
	b.broadcastPipelineProgress(progress, progressMessage(progress, "vault_persistence", "complete", "Vault memory saved"))
	if !options.SuppressTerminalComplete && (vaultID == "" || isAppend) {
		b.broadcastPipelineProgress(progress, progressMessage(progress, "complete", "complete", "Crawl pipeline complete"))
	}

	if b.NS.Broadcast != nil && !options.SuppressSynthesisComplete {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Done",
		})
		b.NS.Broadcast(models.WSMessage{
			Type: "SYNTHESIS_COMPLETE",
			Payload: map[string]interface{}{
				"result":    finalSynthesis,
				"vaultPath": vaultPath,
				"vaultId":   vaultID,
				"append":    isAppend,
				"prompt":    prompt,
				"runId":     pipelineRunID(progress),
			},
		})
	}

	return finalSynthesis, nil
}
