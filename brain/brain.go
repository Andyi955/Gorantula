package brain

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"spider-agent/models"
	"spider-agent/nervous_system"
	"spider-agent/pkg/document"

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

// SubQueries encapsulates the JSON response expected from the planning model.
type SubQueries struct {
	Queries []string `json:"queries"`
}

// RankResult encapsulates the relevance score for a fact (Generation 2)
type RankResult struct {
	Score  int    `json:"score"`
	Reason string `json:"reason"`
}

var providerFallbackOrder = []string{
	"deepseek",
	"openai",
	"anthropic",
	"qwen",
	"zhipuai",
	"moonshot",
	"minimax",
	"ollama",
	"lmstudio",
	"gemini",
}

// Brain controls the LLM generation and orchestration of the Nervous System
type Brain struct {
	Client       *genai.Client
	Model        *genai.GenerativeModel
	NS           *nervous_system.NervousSystem
	Abdomen      *models.Abdomen
	ModelRouter  map[string]ModelProvider
	routerMu     sync.RWMutex
	modelMu      sync.Mutex
	tokenUsageMu sync.Mutex
	tokenUsage   *tokenUsageTracker
	Synthesis    *SynthesisEngine
}

// GetRouter safely retrieves a model provider from the router
func (b *Brain) GetRouter(name string) (ModelProvider, bool) {
	b.routerMu.RLock()
	defer b.routerMu.RUnlock()
	provider, ok := b.ModelRouter[name]
	return provider, ok
}

// ReloadModelProviders re-initializes the ModelRouter based on the current environment variables
func (b *Brain) ReloadModelProviders() error {
	b.routerMu.Lock()
	defer b.routerMu.Unlock()

	router, err := NewModelRouter(b)
	if err != nil {
		return err
	}
	b.ModelRouter = router
	fmt.Printf("[Brain] Model providers successfully reloaded. Available: %d\n", len(router))
	return nil
}

// NewBrain initializes the genai client and the Brain struct
func NewBrain(ns *nervous_system.NervousSystem, abdomen *models.Abdomen) (*Brain, error) {
	ctx := context.Background()
	apiKey := os.Getenv("GEMINI_API_KEY")
	var client *genai.Client
	var model *genai.GenerativeModel
	if apiKey != "" && providerEnabled("GEMINI_ENABLED") {
		var err error
		client, err = genai.NewClient(ctx, option.WithAPIKey(apiKey))
		if err != nil {
			return nil, err
		}
		model = client.GenerativeModel(envOrDefault("GEMINI_MODEL", DefaultGeminiModel))
	}

	brain := &Brain{
		Client:     client,
		Model:      model, // Legacy ref, kept for backward compatibility if needed temporarily
		NS:         ns,
		Abdomen:    abdomen,
		tokenUsage: newTokenUsageTracker(),
	}

	router, err := NewModelRouter(brain)
	if err != nil {
		fmt.Printf("[Brain] Warning: failed to initialize model router: %v\n", err)
	} else {
		brain.ModelRouter = router
	}

	alertChan := make(chan SynthesisAlert, 20)
	brain.Synthesis = NewSynthesisEngine("./abdomen_vault", alertChan)
	go func() {
		for alert := range alertChan {
			log.Printf("[Brain] Broadcasting SYNTHESIS_ALERT alertKey=%s currentVault=%s entity=%s connectedCases=%v", alert.AlertKey, alert.CurrentVaultID, alert.Entity, alert.ConnectedCases)
			if brain.NS.Broadcast != nil {
				brain.NS.Broadcast(models.WSMessage{
					Type:    "SYNTHESIS_ALERT",
					Payload: alert,
				})
			}
		}
	}()

	return brain, nil
}

func (b *Brain) firstAvailableProvider(excludedNames ...string) (ModelProvider, bool) {
	excluded := make(map[string]struct{}, len(excludedNames))
	for _, name := range excludedNames {
		if name = strings.TrimSpace(name); name != "" {
			excluded[name] = struct{}{}
		}
	}

	b.routerMu.RLock()
	defer b.routerMu.RUnlock()

	for _, name := range providerFallbackOrder {
		if _, skip := excluded[name]; skip {
			continue
		}
		if provider, ok := b.ModelRouter[name]; ok && provider != nil {
			return provider, true
		}
	}
	for name, provider := range b.ModelRouter {
		if _, skip := excluded[name]; !skip && provider != nil {
			return provider, true
		}
	}
	return nil, false
}

func (b *Brain) fallbackProviderAfter(provider ModelProvider) (ModelProvider, bool) {
	if provider == nil {
		return b.firstAvailableProvider()
	}
	return b.firstAvailableProvider(provider.Name())
}

func (b *Brain) generateJSONWithFallback(ctx context.Context, operation string, provider ModelProvider, prompt string, target interface{}) error {
	if provider == nil {
		return fmt.Errorf("no model providers available")
	}
	if err := provider.GenerateJSON(ctx, prompt, target); err != nil {
		fmt.Printf("[Brain Error] %s provider %s failed: %v. Attempting generic provider fallback...\n", operation, provider.Name(), err)
		fallbackProvider, ok := b.fallbackProviderAfter(provider)
		if !ok {
			return err
		}
		if fallbackErr := fallbackProvider.GenerateJSON(ctx, prompt, target); fallbackErr != nil {
			fmt.Printf("[Brain Error] %s fallback provider %s failed: %v\n", operation, fallbackProvider.Name(), fallbackErr)
			return err
		}
		fmt.Printf("[Brain] %s recovered using fallback provider %s\n", operation, fallbackProvider.Name())
	}
	return nil
}

func (b *Brain) generateContentWithFallback(ctx context.Context, operation string, provider ModelProvider, prompt string) (string, error) {
	if provider == nil {
		return "", fmt.Errorf("no model providers available")
	}
	content, err := provider.GenerateContent(ctx, prompt)
	if err == nil {
		return content, nil
	}
	fmt.Printf("[Brain Error] %s provider %s failed: %v. Attempting generic provider fallback...\n", operation, provider.Name(), err)
	fallbackProvider, ok := b.fallbackProviderAfter(provider)
	if !ok {
		return "", err
	}
	content, fallbackErr := fallbackProvider.GenerateContent(ctx, prompt)
	if fallbackErr != nil {
		fmt.Printf("[Brain Error] %s fallback provider %s failed: %v\n", operation, fallbackProvider.Name(), fallbackErr)
		return "", err
	}
	fmt.Printf("[Brain] %s recovered using fallback provider %s\n", operation, fallbackProvider.Name())
	return content, nil
}

func (b *Brain) GetSearchProvider() ModelProvider {
	pref := os.Getenv("DEFAULT_SEARCH_MODEL")
	if pref == "" {
		pref = "deepseek"
	}
	provider, ok := b.GetRouter(pref)
	if !ok {
		if provider, ok = b.GetRouter("deepseek"); ok {
			return provider
		}
	}

	// Safe Fallback: if the preferred provider is missing, use any available provider.
	if provider == nil {
		if p, ok := b.firstAvailableProvider(); ok {
			fmt.Printf("[Brain Warning] Preferred search provider '%s' unavailable. Using '%s' as generic search fallback.\n", pref, p.Name())
			return p
		}
	}

	return provider
}

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

func pipelineRunID(progress *models.PipelineProgressTracker) string {
	if progress == nil {
		return ""
	}
	return progress.RunID()
}

func (b *Brain) processPrompt(ctx context.Context, prompt, vaultID string, isAppend bool, scrapeImages bool, progress *models.PipelineProgressTracker) (string, error) {
	if strings.HasPrefix(strings.ToLower(prompt), "deep dive investigation into:") {
		fmt.Printf("[Brain] >>> DISPATCHING DEEP DIVE: %s <<<\n", strings.TrimPrefix(prompt, "Deep dive investigation into: "))
	} else {
		fmt.Printf("[Brain] Processing new investigation: %s\n", prompt)
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

	// Ensure channels are fresh for this run
	b.NS.NerveChannel = make(chan models.NerveSignal, totalLegs)
	b.NS.NutrientChannel = make(chan models.NutrientFlow, totalLegs)

	legID := 0
	for _, url := range supportedMediaURLs {
		b.NS.NerveChannel <- models.NerveSignal{
			TargetQuery: url,
			LegID:       legID,
			IsMedia:     true,
		}
		legID++
	}

	for _, q := range subQ.Queries {
		b.NS.NerveChannel <- models.NerveSignal{
			TargetQuery: q,
			LegID:       legID,
		}
		legID++
	}
	// Important: close nerveChannel so workers eventually exit
	close(b.NS.NerveChannel)

	// Start working Goroutines (The Legs)
	b.NS.StartLegs()
	b.broadcastPipelineProgress(progress, progressMessage(progress, "dispatch_legs", "complete", fmt.Sprintf("Dispatched %d leg tasks", totalLegs)))

	// --- STEP 3: Wait for Nutrients and Store in Abdomen ---
	b.broadcastPipelineProgress(progress, progressMessage(progress, "gather_evidence", "running", "Gathering and summarizing evidence"))
	nutrients := make([]models.NutrientFlow, 0, totalLegs)
	for i := 0; i < totalLegs; i++ {
		nutrients = append(nutrients, <-b.NS.NutrientChannel)
	}

	// Ensure legs have finished executing cleanly
	b.NS.WaitGroup.Wait()
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
	if vaultID == "" || isAppend {
		b.broadcastPipelineProgress(progress, progressMessage(progress, "complete", "complete", "Crawl pipeline complete"))
	}

	if b.NS.Broadcast != nil {
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

// ProcessLocalDirectory reads a local folder, finding supported files, and dispatches them to Legs.
func (b *Brain) ProcessLocalDirectory(ctx context.Context, dirPath string) (string, error) {
	fmt.Printf("[Brain] Processing local directory: %s\n", dirPath)

	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Scanning Local Files",
		})
	}

	var supportedFiles []string
	err := filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext == ".txt" || ext == ".pdf" || ext == ".docx" || ext == ".md" || ext == ".csv" {
			supportedFiles = append(supportedFiles, path)
		}
		return nil
	})

	if err != nil {
		return "", fmt.Errorf("failed to scan directory: %w", err)
	}

	if len(supportedFiles) == 0 {
		return "", fmt.Errorf("no supported files (txt, md, csv, pdf, docx) found in directory")
	}

	return b.ProcessLocalFiles(ctx, supportedFiles)
}

// ProcessLocalFiles takes specific absolute file paths and dispatches them to Legs.
func (b *Brain) ProcessLocalFiles(ctx context.Context, filePaths []string) (string, error) {
	return b.ProcessLocalFilesWithProgress(ctx, filePaths, nil)
}

func (b *Brain) ProcessLocalFilesWithProgress(ctx context.Context, filePaths []string, progress *models.PipelineProgressTracker) (string, error) {
	fmt.Printf("[Brain] Processing %d local files\n", len(filePaths))
	b.broadcastPipelineProgress(progress, progressMessage(progress, "start", "running", "Operator submitted local files"))
	b.broadcastPipelineProgress(progress, progressMessage(progress, "start", "complete", "Local crawl accepted"))

	supportedFiles := make([]string, 0, len(filePaths))
	for _, path := range filePaths {
		ext := strings.ToLower(filepath.Ext(path))
		if ext == ".txt" || ext == ".pdf" || ext == ".docx" || ext == ".md" || ext == ".csv" {
			// Verify file actually exists before dispatching
			if _, err := os.Stat(path); err == nil {
				supportedFiles = append(supportedFiles, path)
			}
		}
	}

	if len(supportedFiles) == 0 {
		return "", fmt.Errorf("no valid supported files found in the provided list")
	}

	// --- STEP 2: Pre-parse and slice into Chunks ---
	b.broadcastPipelineProgress(progress, progressMessage(progress, "plan_queries", "running", "Parsing local files into chunks"))
	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Ingesting & Chunking local files...",
		})
	}

	var allChunks []models.NerveSignal
	chunkLimit := 10000 // ~3-4 pages per chunk
	fileLimit := 1000000

	for _, path := range supportedFiles {
		ext := strings.ToLower(filepath.Ext(path))
		var content string
		var err error

		switch ext {
		case ".txt", ".md", ".csv":
			content, err = document.ParseTXT(path, fileLimit)
		case ".pdf":
			content, err = document.ParsePDF(path, fileLimit)
		case ".docx":
			content, err = document.ParseDOCX(path, fileLimit)
		}

		if err != nil || content == "" {
			fmt.Printf("[Brain Warning] Failed to parse local file %s: %v\n", filepath.Base(path), err)
			continue
		}

		textChunks := document.ChunkText(content, chunkLimit, 50) // Max 50 chunks per file (Edge case 2)
		totalChunks := len(textChunks)

		for idx, chunkText := range textChunks {
			chunkIdentifier := fmt.Sprintf("%s (Part %d/%d)", filepath.Base(path), idx+1, totalChunks)

			allChunks = append(allChunks, models.NerveSignal{
				TargetQuery: chunkIdentifier,
				IsLocal:     false,
				IsChunk:     true,
				ChunkData:   chunkText,
			})
		}
	}

	if len(allChunks) == 0 {
		return "", fmt.Errorf("failed to extract any content from the selected files")
	}
	b.broadcastPipelineProgress(progress, progressMessage(progress, "plan_queries", "complete", fmt.Sprintf("Prepared %d document chunks", len(allChunks))))

	// --- STEP 3: Dispatch Queries to Nervous System ---
	b.broadcastPipelineProgress(progress, progressMessage(progress, "dispatch_legs", "running", "Dispatching document chunks to legs"))
	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: fmt.Sprintf("Dispatching %d chunks to Legs", len(allChunks)),
		})
	}

	// Ensure channels are fresh for this run
	// Capacity matches total chunks to prevent blocking if workers are slow
	b.NS.NerveChannel = make(chan models.NerveSignal, len(allChunks))
	b.NS.NutrientChannel = make(chan models.NutrientFlow, len(allChunks))

	for i := range allChunks {
		b.NS.NerveChannel <- allChunks[i]
	}
	// Important: close nerveChannel so workers eventually exit
	close(b.NS.NerveChannel)

	// Start working Goroutines (The Legs)
	b.NS.StartLegs()
	b.broadcastPipelineProgress(progress, progressMessage(progress, "dispatch_legs", "complete", fmt.Sprintf("Dispatched %d chunks", len(allChunks))))

	// --- STEP 4: Wait for Nutrients and Store in Abdomen ---
	b.broadcastPipelineProgress(progress, progressMessage(progress, "gather_evidence", "running", "Summarizing local document chunks"))
	// Wait for exactly as many chunks as we dispatched
	expected := len(allChunks)
	nutrients := make([]models.NutrientFlow, 0, expected)
	for i := 0; i < expected; i++ {
		nutrients = append(nutrients, <-b.NS.NutrientChannel)
	}

	b.NS.WaitGroup.Wait()
	summaryCtx, summaryScopeID := b.StartPipelineTokenScope(ctx, "pipeline-local-node-summary", "node_summary")
	if progress != nil {
		progress.StartSpan("node_summary", "gather_evidence", fmt.Sprintf("Local node summary (%d workers)", nodeSummaryConcurrency()), fmt.Sprintf("summarizing %d chunks", len(nutrients)))
	}
	processedNutrients := b.processNutrients(summaryCtx, nutrients, nutrientProcessingOptions{Progress: progress})
	if progress != nil {
		progress.CompleteSpan("node_summary", fmt.Sprintf("summarized %d local nodes", len(processedNutrients)))
		progress.RecordCounter("documentChunks", len(allChunks))
		progress.RecordCounter("nodesCreated", len(processedNutrients))
		b.RecordPipelineTokenUsage(progress, summaryScopeID)
	}
	for _, result := range processedNutrients {
		b.Abdomen.Mutex.Lock()
		b.Abdomen.MemoryContext = append(b.Abdomen.MemoryContext, result.memory)
		totalMemories := len(b.Abdomen.MemoryContext)
		b.Abdomen.Mutex.Unlock()
		if b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type: "MEMORY_NODE_GATHERED",
				Payload: map[string]interface{}{
					"node":  result.node,
					"total": totalMemories,
				},
			})
		}
	}
	b.broadcastPipelineProgress(progress, progressMessage(progress, "gather_evidence", "complete", fmt.Sprintf("Gathered %d local evidence memories", len(b.Abdomen.MemoryContext))))

	// --- STEP 4: Synthesize Final Response ---
	b.broadcastPipelineProgress(progress, progressMessage(progress, "final_report", "running", "Synthesizing local report"))
	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Synthesizing Final Response",
		})
	}

	b.Abdomen.Mutex.RLock()
	contextText := strings.Join(b.Abdomen.MemoryContext, "\n\n")
	b.Abdomen.Mutex.RUnlock()

	currentDate := time.Now().Format("Monday, January 2, 2006")
	provider := b.GetSearchProvider()
	if provider == nil {
		return "", fmt.Errorf("no model providers available")
	}
	synthesisInstruction := fmt.Sprintf("You are an expert intelligence analyst compiling a final report. Today's current date is %s. Contextualize all findings chronologically based on this date.", currentDate)
	synthesisPrompt := fmt.Sprintf(
		"%s\n\nBased on the following facts gathered from local files, provide a comprehensive summary of the documents' contents.\n\nLocal Files: %s\n\nGathered Facts:\n%s",
		synthesisInstruction, strings.Join(filePaths, ", "), contextText,
	)

	if progress != nil {
		progress.StartSpan("local_final_report_llm", "final_report", "Local final report LLM", "generating local report")
	}
	finalSynthesis, err := b.generateContentWithFallback(ctx, "local final report", provider, synthesisPrompt)
	if err != nil {
		if progress != nil {
			progress.CompleteSpan("local_final_report_llm", "local report failed")
		}
		return "", fmt.Errorf("failed to generate final synthesis: %w", err)
	}

	if progress != nil {
		promptTokens := estimateTextTokens(synthesisPrompt)
		completionTokens := estimateTextTokens(finalSynthesis)
		progress.CompleteSpan("local_final_report_llm", "generated local report")
		progress.RecordTokenUsage(models.PipelineProfileTokenUsage{
			Operation:          "final_report",
			Provider:           provider.Name(),
			CallCount:          1,
			EstimatedCallCount: 1,
			PromptTokens:       promptTokens,
			CompletionTokens:   completionTokens,
			TotalTokens:        promptTokens + completionTokens,
		})
	}
	b.broadcastPipelineProgress(progress, progressMessage(progress, "final_report", "complete", "Local report generated"))

	// Save to Vault
	b.broadcastPipelineProgress(progress, progressMessage(progress, "vault_persistence", "running", "Persisting local report to vault"))
	var vaultPrefix string
	if len(filePaths) == 1 {
		vaultPrefix = "local_file_" + filepath.Base(filePaths[0])
	} else {
		vaultPrefix = "local_files_multiple"
	}
	vaultPath, err := saveVaultMemory(vaultPrefix, contextText, finalSynthesis, "", false)
	if err != nil {
		fmt.Printf("Warning: failed to save vault memory: %v\n", err)
	}
	b.broadcastPipelineProgress(progress, progressMessage(progress, "vault_persistence", "complete", "Local vault memory saved"))
	b.broadcastPipelineProgress(progress, progressMessage(progress, "complete", "complete", "Local pipeline complete"))

	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Done",
		})
		b.NS.Broadcast(models.WSMessage{
			Type: "SYNTHESIS_COMPLETE",
			Payload: map[string]interface{}{
				"result":    finalSynthesis,
				"vaultPath": vaultPath,
				"runId":     pipelineRunID(progress),
			},
		})
	}

	return finalSynthesis, nil
}

// saveVaultMemory writes the memory to a properly formatted, timestamped vault file
func saveVaultMemory(prompt, rawData, summary, vaultID string, isAppend bool) (string, error) {
	now := time.Now()

	targetDir := ""
	if vaultID != "" && filepath.Base(vaultID) == vaultID && !strings.ContainsAny(vaultID, `/\`) {
		targetDir = filepath.Join("abdomen_vault", vaultID)
	} else {
		targetDir = fmt.Sprintf("./abdomen_vault/%s", now.Format("2006-01-02"))
	}

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return "", err
	}

	words := strings.Fields(strings.ToLower(prompt))
	topic := "crawl"
	if len(words) > 0 {
		end := 3
		if len(words) < 3 {
			end = len(words)
		}
		topic = strings.Join(words[:end], "_")
	}

	// sanitize
	topicRunes := []rune(topic)
	for i, c := range topicRunes {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
			topicRunes[i] = '-'
		}
	}

	filePrefix := "crawl"
	if isAppend {
		filePrefix = "append"
	}
	filename := fmt.Sprintf("%s_%s_%s.md", filePrefix, now.Format("2006-01-02_15-04-05"), string(topicRunes))
	filepath := filepath.Join(targetDir, filename)

	content := fmt.Sprintf("# Crawler Result Vault\n\n## Final Summary\n%s\n\n## Raw Digested Facts\n%s\n", summary, rawData)
	err := os.WriteFile(filepath, []byte(content), 0644)
	return filepath, err
}

type mergedVaultMetadata struct {
	ChildVaultID string   `json:"childVaultId"`
	ChildTopic   string   `json:"childTopic"`
	ParentIDs    []string `json:"parentIds"`
	NodeCount    int      `json:"nodeCount"`
	EdgeCount    int      `json:"edgeCount"`
	CreatedAt    string   `json:"createdAt"`
	Derived      bool     `json:"derived"`
}

func safeNodeFilename(id string) (string, error) {
	if id == "" {
		return "", fmt.Errorf("invalid node id: empty")
	}
	if filepath.Base(id) != id || strings.ContainsAny(id, `/\`) {
		return "", fmt.Errorf("invalid node id: contains path separators")
	}
	return fmt.Sprintf("node_%s.json", id), nil
}

func (b *Brain) summarizeNode(ctx context.Context, content string) (string, string, error) {
	provider := b.GetSearchProvider()
	if provider == nil {
		return "", "", fmt.Errorf("no model providers available")
	}
	currentDate := time.Now().Format("Monday, January 2, 2006")

	systemInstruction := fmt.Sprintf("You are a Senior Strategic Intelligence Officer. Today's current date is %s. Provide a professional 'INTEL_DOSSIER' style summary. "+
		"1. Title: Short, punchy, high-impact (max 5 words). "+
		"2. Summary: Exactly 2 sentences. Contextualize 'recent' or 'upcoming' based on today's current date. "+
		"3. REQUIRED TAGGING: Wrap critical entities like this: [PERSON:Elon Musk], [ORG:OpenAI], [LOC:London], [DATE:2026-02-24]. "+
		"4. IMPORTANT: Return ONLY a valid JSON object with 'title' and 'summary' keys. No text. No markdown. "+
		"CRITICAL: If the text is a security block or indicates bot detection, return ONLY {}.", currentDate)

	fullPrompt := systemInstruction + "\n\nContent to summarize:\n" + content
	var res struct {
		Title   string `json:"title"`
		Summary string `json:"summary"`
	}
	if err := b.generateJSONWithFallback(ctx, "node summary", provider, fullPrompt, &res); err != nil {
		if b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type:    "BRAIN_STATE",
				Payload: fmt.Sprintf("Provider %s failed while summarizing a node.", provider.Name()),
			})
		}
		return "", "", err
	}
	return res.Title, res.Summary, nil
}

// buildNodeMapping creates a mapping table of node IDs to titles for the AI prompt
func buildNodeMapping(nodes []models.MemoryNode) string {
	mapping := "\n=== NODE ID MAPPING (USE THESE IDs!) ===\n"
	for _, node := range nodes {
		mapping += fmt.Sprintf("ID: %s -> Title: %s\n", node.ID, node.Title)
	}
	mapping += "\nIMPORTANT: When creating connections, you MUST use the EXACT node IDs (like 'node-1738182800-0'), NOT the titles!\n"
	mapping += "The 'source' and 'target' fields must contain only the node IDs.\n\n"
	return mapping
}

func (b *Brain) AnalyzeConnections(ctx context.Context, nodes []models.MemoryNode) ([]models.BoardConnection, error) {
	fmt.Printf("[Brain] Analyzing connections for %d nodes...\n", len(nodes))
	combinedText := ""
	for _, node := range nodes {
		fmt.Printf(" - Node: %s (%s)\n", node.ID, node.Title)
		combinedText += fmt.Sprintf("ID: %s\nTitle: %s\nSummary: %s\n---\n", node.ID, node.Title, node.Summary)
	}

	// Add node ID mapping to help AI use correct IDs
	combinedText += buildNodeMapping(nodes)

	provider := b.GetSearchProvider()
	if provider == nil {
		return nil, fmt.Errorf("no model providers available")
	}
	currentDate := time.Now().Format("Monday, January 2, 2006")

	systemInstruction := fmt.Sprintf("You are a Senior Counter-Intelligence Analyst. Today's current date is %s. Conduct a rigorous cross-examination of these intelligence nodes. "+
		"1. Map the logical infrastructure of the case. Seek strategic dependencies, contradictions, and connections chronologically if needed. "+
		"2. Only connect evidence with high clinical confidence. "+
		"3. Generate a concise, uppercase relationship tag (1-3 words) that best describes each connection (e.g., FUNDED_BY, CONTRADICTS, CORROBORATES, WORKS_FOR). "+
		"4. CRITICAL: Use the node IDs from the mapping above - NOT titles! "+
		"5. IMPORTANT: YOU MUST RETURN ONLY A VALID JSON ARRAY OF OBJECTS. NO TEXT. NO MARKDOWN. Elements must be: 'source', 'target', 'tag', 'reasoning'. "+
		"Connect the 6 strongest relationships.", currentDate)

	fullPrompt := systemInstruction + "\n\nEvidence Nodes:\n" + combinedText

	var connections []models.BoardConnection
	if err := b.generateJSONWithFallback(ctx, "connection analysis", provider, fullPrompt, &connections); err != nil {
		if b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type:    "BRAIN_STATE",
				Payload: fmt.Sprintf("Provider %s failed while analyzing connections.", provider.Name()),
			})
		}
		return nil, err
	}

	for i := range connections {
		connections[i].Tag = SanitizeTag(connections[i].Tag)
	}

	fmt.Printf("[Brain] Analysis complete. Found %d relationships.\n", len(connections))
	return connections, nil
}

// AnalyzeWithPersonas runs multi-agent persona analysis on the gathered findings
func (b *Brain) AnalyzeWithPersonas(ctx context.Context, investigationID string, nodes []models.MemoryNode) ([]PersonaInsight, error) {
	return b.analyzeWithPersonas(ctx, investigationID, nodes, nil)
}

func (b *Brain) AnalyzeWithPersonasWithProgress(ctx context.Context, investigationID string, nodes []models.MemoryNode, progress *models.PipelineProgressTracker) ([]PersonaInsight, error) {
	return b.analyzeWithPersonas(ctx, investigationID, nodes, progress)
}

func (b *Brain) analyzeWithPersonas(ctx context.Context, investigationID string, nodes []models.MemoryNode, progress *models.PipelineProgressTracker) ([]PersonaInsight, error) {
	personas := GetDefaultPersonas()
	fmt.Printf("[Brain] Running multi-agent persona analysis with %d personas...\n", len(personas))

	findingsText := buildSummaryFirstPersonaFindings(nodes)
	fmt.Printf("[Brain] Full-board persona evidence prepared for %d nodes across %d personas (%d chars)\n",
		len(nodes), len(personas), len(findingsText))

	scopeID := b.newTokenUsageScope("persona-full-board")
	insightsChan := make(chan PersonaInsight, len(personas))

	// Run each persona analysis in parallel
	for _, persona := range personas {
		go func(p Persona) {
			personaCtx := withTokenUsageTracking(ctx, scopeID, tokenUsageOperationLabel("full_board_persona", p.Name))
			insight, err := b.runPersonaAnalysis(personaCtx, p, findingsText)
			if err != nil {
				fmt.Printf("[Brain] Persona %s failed: %v\n", p.Name, err)
				// Send empty insight on failure
				insightsChan <- PersonaInsight{PersonaName: p.Name, Confidence: 0}
				return
			}
			insightsChan <- insight
		}(persona)
	}

	// Collect insights from all personas
	insights := make([]PersonaInsight, 0, len(personas))
	for i := 0; i < len(personas); i++ {
		insight := <-insightsChan
		if insight.Confidence > 0 {
			insights = append(insights, insight)
			fmt.Printf("[Brain] Persona %s completed (confidence: %.2f)\n", insight.PersonaName, insight.Confidence)
		}
	}

	fmt.Printf("[Brain] Persona analysis complete. Collected %d insights.\n", len(insights))
	tokenSummary := b.summarizeTokenUsageScope(scopeID)
	b.broadcastTokenUsageSummary(investigationID, "Full-board persona analysis", tokenSummary)
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
	fmt.Printf("[Brain] Running incremental persona analysis with %d personas across %d nodes (%d pending)...\n", len(GetDefaultPersonas()), len(nodes), len(pendingNodeIDs))

	pendingFindings, contextFindings, validPendingNodeIDs := buildIncrementalPersonaFindings(nodes, pendingNodeIDs)
	if len(validPendingNodeIDs) == 0 {
		return nil, fmt.Errorf("incremental persona analysis requires at least one valid pending node")
	}

	personas := GetDefaultPersonas()
	scopeID := b.newTokenUsageScope("persona-incremental")
	insightsChan := make(chan PersonaInsight, len(personas))

	for _, persona := range personas {
		go func(p Persona) {
			prompt := BuildIncrementalPersonaPrompt(p, pendingFindings, contextFindings, validPendingNodeIDs)
			personaCtx := withTokenUsageTracking(ctx, scopeID, tokenUsageOperationLabel("incremental_persona", p.Name))
			insight, err := b.runPersonaAnalysisWithPrompt(personaCtx, p, prompt)
			if err != nil {
				fmt.Printf("[Brain] Incremental persona %s failed: %v\n", p.Name, err)
				insightsChan <- PersonaInsight{PersonaName: p.Name, Confidence: 0}
				return
			}
			insightsChan <- insight
		}(persona)
	}

	insights := make([]PersonaInsight, 0, len(personas))
	for i := 0; i < len(personas); i++ {
		insight := <-insightsChan
		if insight.Confidence > 0 {
			insights = append(insights, insight)
			fmt.Printf("[Brain] Incremental persona %s completed (confidence: %.2f)\n", insight.PersonaName, insight.Confidence)
		}
	}

	fmt.Printf("[Brain] Incremental multi-agent analysis complete. Generated %d valid persona insights.\n", len(insights))
	tokenSummary := b.summarizeTokenUsageScope(scopeID)
	b.broadcastTokenUsageSummary(investigationID, "Incremental persona analysis", tokenSummary)
	b.RecordPipelineTokenUsage(progress, scopeID)
	return insights, nil
}

// runPersonaAnalysis executes a single persona's analysis
func (b *Brain) runPersonaAnalysis(ctx context.Context, persona Persona, findings string) (PersonaInsight, error) {
	prompt := BuildPersonaPrompt(persona, findings)
	return b.runPersonaAnalysisWithPrompt(ctx, persona, prompt)
}

func (b *Brain) runPersonaAnalysisWithPrompt(ctx context.Context, persona Persona, prompt string) (PersonaInsight, error) {
	// Get the appropriate model provider
	provider, ok := b.GetRouter(persona.ModelPref)
	if !ok {
		var found bool
		provider, found = b.firstAvailableProvider()
		if !found {
			return PersonaInsight{PersonaName: persona.Name, Confidence: 0}, fmt.Errorf("no model providers available to run persona analysis")
		}
		fmt.Printf("[Brain Warning] Preferred model '%s' unavailable. Using '%s' for Persona '%s'\n", persona.ModelPref, provider.Name(), persona.Name)
	}

	fmt.Printf("[Brain] Running persona %s with model %s\n", persona.Name, provider.Name())

	var response PersonaJSONResponse
	err := provider.GenerateJSON(ctx, prompt, &response)
	if err != nil {
		return PersonaInsight{}, fmt.Errorf("failed to generate persona analysis: %w", err)
	}

	return PersonaInsight{
		PersonaName:         persona.Name,
		Perspective:         persona.Perspective,
		KeyFindings:         response.KeyFindings,
		Observations:        response.Observations,
		Hypotheses:          response.Hypotheses,
		Connections:         response.Connections,
		Questions:           response.Questions,
		Confidence:          response.Confidence,
		FullAnalysis:        response.FullAnalysis,
		NodeIDs:             response.NodeIDs,
		TimelineEvents:      response.TimelineEvents,
		ProposedConnections: response.ProposedConnections,
	}, nil
}

// SynthesizePersonaInsights combines all persona insights into final connections
func (b *Brain) SynthesizePersonaInsights(ctx context.Context, nodes []models.MemoryNode, insights []PersonaInsight) ([]models.BoardConnection, error) {
	fmt.Printf("[Brain] Synthesizing %d persona insights into final connections...\n", len(insights))

	if len(insights) == 0 {
		// Fall back to standard analysis if no insights
		return b.AnalyzeConnections(ctx, nodes)
	}

	// Build insights summary for synthesis
	insightsSummary := ""
	for _, insight := range insights {
		insightsSummary += fmt.Sprintf("\n=== %s (%s) ===\n", insight.PersonaName, insight.Perspective)
		insightsSummary += fmt.Sprintf("Confidence: %.2f\n", insight.Confidence)
		insightsSummary += "Key Findings:\n"
		for _, f := range insight.KeyFindings {
			insightsSummary += fmt.Sprintf("  - %s\n", f)
		}
		insightsSummary += "Connections:\n"
		for _, c := range insight.Connections {
			insightsSummary += fmt.Sprintf("  - %s\n", c)
		}
		insightsSummary += "Questions:\n"
		for _, q := range insight.Questions {
			insightsSummary += fmt.Sprintf("  - %s\n", q)
		}
		insightsSummary += fmt.Sprintf("Analysis: %s\n", insight.FullAnalysis)
	}

	// Add node ID mapping so AI knows which IDs to use
	insightsSummary += buildNodeMapping(nodes)

	// Now synthesize using the insights
	provider := b.GetSearchProvider()
	if provider == nil {
		return nil, fmt.Errorf("no model providers available")
	}
	currentDate := time.Now().Format("Monday, January 2, 2006")

	systemInstruction := fmt.Sprintf("You are a Senior Counter-Intelligence Analyst coordinating a team of 6 specialists. Today's current date is %s. "+
		"Synthesize the insights from all specialists into the 6 strongest relationships between evidence nodes. "+
		"Each specialist provided: key findings, connections they identified, and follow-up questions. "+
		"Prioritize connections that multiple specialists agree on. "+
		"Generate a concise, uppercase relationship tag (1-3 words) that best describes the connection (e.g., FUNDS, OWNS, DIRECTS, CONTRADICTS). "+
		"CRITICAL: Use the node IDs from the mapping above - NOT titles! "+
		"YOU MUST RETURN ONLY A VALID JSON ARRAY OF OBJECTS. NO TEXT. NO MARKDOWN. Elements must be: 'source', 'target', 'tag', 'reasoning'. "+
		"The 'reasoning' should mention which specialists supported this connection.", currentDate)

	fullPrompt := systemInstruction + "\n\nInsights Summary to Synthesize:\n" + insightsSummary

	var connections []models.BoardConnection
	if err := b.generateJSONWithFallback(ctx, "persona synthesis", provider, fullPrompt, &connections); err != nil {
		if b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type:    "BRAIN_STATE",
				Payload: fmt.Sprintf("Provider %s failed while synthesizing persona findings.", provider.Name()),
			})
		}
		return nil, err
	}

	for i := range connections {
		connections[i].Tag = SanitizeTag(connections[i].Tag)
	}

	fmt.Printf("[Brain] Synthesis complete. Found %d final relationships.\n", len(connections))
	return connections, nil
}

// InterrogateVault reads selected investigations and answers a direct query using ONLY those texts as context.
func (b *Brain) InterrogateVault(ctx context.Context, filePaths []string, query string) (string, error) {
	if len(filePaths) == 0 {
		return "", fmt.Errorf("no files selected for interrogation")
	}

	var builder strings.Builder
	builder.WriteString("Here is a collection of previously gathered intelligence reports and investigations:\n\n")

	// Read each file and append to context
	for _, path := range filePaths {
		data, err := os.ReadFile(path)
		if err != nil {
			fmt.Printf("[Brain Warning] Could not read vault file %s: %v\n", path, err)
			continue
		}

		fileName := filepath.Base(path)
		builder.WriteString(fmt.Sprintf("--- START OF REPORT: %s ---\n", fileName))
		builder.WriteString(string(data))
		builder.WriteString(fmt.Sprintf("\n--- END OF REPORT: %s ---\n\n", fileName))
	}

	vaultContext := builder.String()

	provider := b.GetSearchProvider()
	if provider == nil {
		return "", fmt.Errorf("no model providers available")
	}

	systemPrompt := "You are GORANTULA, an elite AI intelligence analyst. " +
		"You have been asked to interrogate your 'Vault' of past investigations to answer a specific query. " +
		"CRITICAL INSTRUCTION: You MUST base your answer ENTIRELY on the provided investigation reports. " +
		"If the reports do not contain the answer, state that the information is not present in the selected vault files. " +
		"Use Markdown for formatting your response. Provide citations back to the specific report names when possible."

	userPrompt := fmt.Sprintf("%s\n\nUSER QUERY: %s", vaultContext, query)

	return provider.GenerateContent(ctx, systemPrompt+"\n\n"+userPrompt)
}

// ValidateSubQueries ensures we have a valid number of distinct search queries (between 4 and 12)
func (b *Brain) ValidateSubQueries(subQ *SubQueries) error {
	if len(subQ.Queries) == 0 {
		return fmt.Errorf("no queries provided")
	}

	// Dynamic padding if too few
	for len(subQ.Queries) < 4 {
		subQ.Queries = append(subQ.Queries, subQ.Queries[0])
	}

	// Truncate if more than 12
	if len(subQ.Queries) > 12 {
		subQ.Queries = subQ.Queries[:12]
	}

	return nil
}

// RankAndFilterFacts takes raw gathered facts and ranks them by relevance to the user's prompt (Generation 2: Selective Memory)
func (b *Brain) RankAndFilterFacts(ctx context.Context, originalPrompt string, facts []string) (string, error) {
	if len(facts) == 0 {
		return "", nil
	}

	// Step 1: Brainstorm relevance criteria (Internal Mental Check)
	// - Is the fact directly answering the prompt?
	// - Is it a security block/bot detection? (Discard)
	// - Is it a duplicate?

	provider := b.GetSearchProvider()
	if provider == nil {
		return "", fmt.Errorf("no model providers available for ranking")
	}

	fmt.Printf("[Brain] Ranking %d facts for relevance...\n", len(facts))

	// Construct a ranking prompt
	rankingInstruction := "You are a Senior Strategic Intelligence Analyst. Rank the following gathered facts by relevance to the user's prompt. " +
		"Ignore security blocks, 'access denied', or empty content. Give a score from 0 (useless) to 10 (highly relevant). " +
		"Return ONLY a JSON array of objects with 'score' (int) and 'reason' (string) for each fact, in the exact same order as the facts provided."

	// Due to potential token limits on the ranking call itself, we limit the facts processed if huge
	limit := 15
	if len(facts) > limit {
		facts = facts[:limit]
	}

	factsContext := ""
	for i, f := range facts {
		// Truncate individual facts if they are massive to avoid breaking the ranking call
		factSnippet := f
		if len(factSnippet) > 2000 {
			factSnippet = factSnippet[:2000] + "... [TRUNCATED]"
		}
		factsContext += fmt.Sprintf("FACT %d:\n%s\n---\n", i, factSnippet)
	}

	fullPrompt := fmt.Sprintf("%s\n\nUser Prompt: %s\n\nFacts to Rank:\n%s", rankingInstruction, originalPrompt, factsContext)

	var results []RankResult

	if err := provider.GenerateJSON(ctx, fullPrompt, &results); err != nil {
		return "", fmt.Errorf("ranking generation failed: %w", err)
	}

	// Step 2: Filter and reconstruct
	var filteredFacts []string
	for i, res := range results {
		if i >= len(facts) {
			break
		}
		// Only keep high-confidence facts (Score > 5)
		if res.Score > 5 {
			filteredFacts = append(filteredFacts, facts[i])
		}
	}

	// Fallback: If everything was low score, take the top 3 anyway to avoid empty synthesis
	if len(filteredFacts) == 0 && len(facts) > 0 {
		count := 3
		if len(facts) < 3 {
			count = len(facts)
		}
		filteredFacts = facts[:count]
	}

	fmt.Printf("[Brain] Ranking complete. Retained %d/%d facts.\n", len(filteredFacts), len(facts))
	return strings.Join(filteredFacts, "\n\n"), nil
}

// PullNode imports a specific node from one investigation (vault) into another.
func (b *Brain) PullNode(ctx context.Context, sourceVaultID, sourceNodeID, targetVaultID string) error {
	fmt.Printf("[Brain] Pulling node %s from vault %s into %s\n", sourceNodeID, sourceVaultID, targetVaultID)

	b.Synthesis.mu.RLock()
	archive, ok := b.Synthesis.Index.NodeArchive[sourceVaultID]
	if !ok {
		b.Synthesis.mu.RUnlock()
		return fmt.Errorf("source vault %s not found in archive", sourceVaultID)
	}

	node, ok := archive[sourceNodeID]
	b.Synthesis.mu.RUnlock()

	if !ok {
		return fmt.Errorf("node %s not found in source vault %s", sourceNodeID, sourceVaultID)
	}

	// Create a copy with the [IMPORTED] tag
	importedNode := node
	importedNode.ID = fmt.Sprintf("imported-%d-%s", time.Now().UnixNano(), node.ID)
	importedNode.Title = "[IMPORTED] " + node.Title

	// Optional: add a visual marker or provenance tag if we had a metadata map
	// For now, the title prefix is the clear indicator.

	// Broadcast it so the frontend adds it to the current board
	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type: "MEMORY_NODE_GATHERED",
			Payload: map[string]interface{}{
				"node":    importedNode,
				"total":   0,
				"vaultId": targetVaultID,
			},
		})

		b.NS.Broadcast(models.WSMessage{
			Type:    "SYSTEM_LOG",
			Payload: fmt.Sprintf("Imported evidence: %q has been added to the board.", node.Title),
		})
	}

	// SAVE TO DISK: Persist the node in the target vault directory
	targetDir := filepath.Join("abdomen_vault", targetVaultID)
	if err := os.MkdirAll(targetDir, 0755); err == nil {
		nodeJSON, _ := json.MarshalIndent(importedNode, "", "  ")
		fileName, fileErr := safeNodeFilename(importedNode.ID)
		if fileErr == nil {
			os.WriteFile(filepath.Join(targetDir, fileName), nodeJSON, 0644)
		}
	}

	return nil
}

func (b *Brain) CreateMergedInvestigation(_ context.Context, payload models.MergeInvestigationsPayload) error {
	if payload.ChildVaultID == "" || filepath.Base(payload.ChildVaultID) != payload.ChildVaultID {
		return fmt.Errorf("invalid child vault id")
	}

	if len(payload.ParentIDs) < 2 {
		return fmt.Errorf("merge requires at least two parent vaults")
	}

	targetDir := filepath.Join("abdomen_vault", payload.ChildVaultID)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return err
	}

	metadata := mergedVaultMetadata{
		ChildVaultID: payload.ChildVaultID,
		ChildTopic:   payload.ChildTopic,
		ParentIDs:    append([]string(nil), payload.ParentIDs...),
		NodeCount:    len(payload.Nodes),
		EdgeCount:    len(payload.Edges),
		CreatedAt:    time.Now().Format(time.RFC3339),
		Derived:      true,
	}

	metadataJSON, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(targetDir, "metadata.json"), metadataJSON, 0644); err != nil {
		return err
	}

	memoryNodes := make([]models.MemoryNode, 0, len(payload.Nodes))
	for _, node := range payload.Nodes {
		memoryNode := models.MemoryNode{
			ID:        node.ID,
			Title:     node.Title,
			Summary:   node.Summary,
			FullText:  node.FullText,
			SourceURL: node.SourceURL,
			Images:    append([]models.MemoryNodeImage(nil), node.Images...),
		}
		memoryNodes = append(memoryNodes, memoryNode)

		nodeJSON, err := json.MarshalIndent(node, "", "  ")
		if err != nil {
			return err
		}
		fileName, err := safeNodeFilename(node.ID)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(targetDir, fileName), nodeJSON, 0644); err != nil {
			return err
		}
	}

	if len(payload.Edges) > 0 {
		edgeJSON, err := json.MarshalIndent(payload.Edges, "", "  ")
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(targetDir, "edges.json"), edgeJSON, 0644); err != nil {
			return err
		}
	}

	if b.Synthesis != nil {
		b.Synthesis.RegisterDerivedVault(payload.ChildVaultID, payload.ParentIDs, memoryNodes)
	}

	if b.NS != nil && b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "SYSTEM_LOG",
			Payload: fmt.Sprintf("Merged child investigation %q registered with %d copied nodes.", payload.ChildTopic, len(payload.Nodes)),
		})
	}

	return nil
}

// ProcessManualNodeText uses the LLM to identify entities in user-provided text and wrap them in custom tags.
func (b *Brain) ProcessManualNodeText(ctx context.Context, rawText string) (string, error) {
	start := time.Now()
	fmt.Printf("[Brain] READING manual node evidence: %d characters\n", len(rawText))
	fmt.Printf("[Brain] DETERMINING entity highlights for: %q\n", rawText[:min(len(rawText), 50)])

	currentDate := time.Now().Format("Monday, January 2, 2006")
	systemInstruction := fmt.Sprintf(`You are an expert intelligence analyst. 
Today's date is %s.
Your task is to take the provided text and identify People, Organizations, Locations, and Dates/Times.
Wrap each identified entity EXACTLY in the corresponding tag:
- People: [PERSON:Entity Name]
- Organizations: [ORG:Entity Name]
- Locations: [LOC:Entity Name]
- Dates/Times: [DATE:Entity Name]

RULES:
1. Do not change any other part of the text.
2. If the text already has tags, preserve them if they are correct, or fix them if not.
3. Return ONLY the processed text, no explanations or additional formatting.
4. Be precise. If you are not sure, do not tag it.`, currentDate)

	provider := b.GetSearchProvider()
	if provider == nil {
		return "", fmt.Errorf("no AI model providers are configured or available")
	}

	fullPrompt := systemInstruction + "\n\nTEXT TO PROCESS:\n" + rawText
	processedText, err := provider.GenerateContent(ctx, fullPrompt)
	if err != nil {
		fmt.Printf("[Brain Error] Manual node processing failed after %v: %v\n", time.Since(start), err)
		return "", err
	}

	fmt.Printf("[Brain] DETERMINATION COMPLETE in %v. Result snippet: %q\n", time.Since(start), processedText[:min(len(processedText), 50)])
	return strings.TrimSpace(processedText), nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
