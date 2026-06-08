package brain

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"spider-agent/models"
	"spider-agent/pkg/document"
)

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
	return b.processLocalFiles(ctx, filePaths, "", progress)
}

func (b *Brain) ProcessLocalFilesForVaultWithProgress(ctx context.Context, filePaths []string, vaultID string, progress *models.PipelineProgressTracker) (string, error) {
	return b.processLocalFiles(ctx, filePaths, strings.TrimSpace(vaultID), progress)
}

func (b *Brain) processLocalFiles(ctx context.Context, filePaths []string, vaultID string, progress *models.PipelineProgressTracker) (string, error) {
	fmt.Printf("[Brain] Processing %d local files\n", len(filePaths))
	if err := checkPipelineContext(ctx); err != nil {
		return "", err
	}
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
		if err := checkPipelineContext(ctx); err != nil {
			return "", err
		}
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

	b.broadcastPipelineProgress(progress, progressMessage(progress, "dispatch_legs", "complete", fmt.Sprintf("Dispatched %d chunks", len(allChunks))))

	// --- STEP 4: Wait for Nutrients and Store in Abdomen ---
	b.broadcastPipelineProgress(progress, progressMessage(progress, "gather_evidence", "running", "Summarizing local document chunks"))
	nutrients, err := b.NS.RunSignals(ctx, allChunks)
	if err != nil {
		return "", err
	}
	if err := checkPipelineContext(ctx); err != nil {
		return "", err
	}
	summaryCtx, summaryScopeID := b.StartPipelineTokenScope(ctx, "pipeline-local-node-summary", "node_summary")
	if progress != nil {
		progress.StartSpan("node_summary", "gather_evidence", fmt.Sprintf("Local node summary (%d workers)", nodeSummaryConcurrency()), fmt.Sprintf("summarizing %d chunks", len(nutrients)))
	}
	processedNutrients := b.processNutrients(summaryCtx, nutrients, nutrientProcessingOptions{VaultID: vaultID, Progress: progress})
	if err := checkPipelineContext(ctx); err != nil {
		return "", err
	}
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
					"node":    result.node,
					"total":   totalMemories,
					"vaultId": vaultID,
					"append":  false,
				},
			})
		}
	}
	b.broadcastPipelineProgress(progress, progressMessage(progress, "gather_evidence", "complete", fmt.Sprintf("Gathered %d local evidence memories", len(b.Abdomen.MemoryContext))))

	// --- STEP 4: Synthesize Final Response ---
	b.broadcastPipelineProgress(progress, progressMessage(progress, "final_report", "running", "Synthesizing local report"))
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
	if err := checkPipelineContext(ctx); err != nil {
		return "", err
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
	vaultPath, err := saveVaultMemory(vaultPrefix, contextText, finalSynthesis, vaultID, false)
	if err != nil {
		fmt.Printf("Warning: failed to save vault memory: %v\n", err)
	}
	b.broadcastPipelineProgress(progress, progressMessage(progress, "vault_persistence", "complete", "Local vault memory saved"))
	if vaultID == "" {
		b.broadcastPipelineProgress(progress, progressMessage(progress, "complete", "complete", "Local pipeline complete"))
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
				"append":    false,
				"runId":     pipelineRunID(progress),
			},
		})
	}

	return finalSynthesis, nil
}
