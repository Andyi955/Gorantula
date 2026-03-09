package brain

import (
	"context"
	"fmt"
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

// SubQueries encapsulates the JSON response expected from Gemini
type SubQueries struct {
	Queries []string `json:"queries"`
}

// RankResult encapsulates the relevance score for a fact (Generation 2)
type RankResult struct {
	Score  int    `json:"score"`
	Reason string `json:"reason"`
}

// Brain controls the LLM generation and orchestration of the Nervous System
type Brain struct {
	Client      *genai.Client
	Model       *genai.GenerativeModel
	NS          *nervous_system.NervousSystem
	Abdomen     *models.Abdomen
	ModelRouter map[string]ModelProvider
	routerMu    sync.RWMutex
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
	if apiKey == "" {
		return nil, fmt.Errorf("GEMINI_API_KEY environment variable not set")
	}
	client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return nil, err
	}

	model := client.GenerativeModel("gemini-3-flash-preview")

	brain := &Brain{
		Client:  client,
		Model:   model, // Legacy ref, kept for backward compatibility if needed temporarily
		NS:      ns,
		Abdomen: abdomen,
	}

	router, err := NewModelRouter(brain)
	if err != nil {
		fmt.Printf("[Brain] Warning: failed to initialize model router: %v\n", err)
	} else {
		brain.ModelRouter = router
	}

	return brain, nil
}

func (b *Brain) GetSearchProvider() ModelProvider {
	pref := os.Getenv("DEFAULT_SEARCH_MODEL")
	if pref == "" {
		pref = "gemini"
	}
	provider, ok := b.GetRouter(pref)
	if !ok {
		if provider, ok = b.GetRouter("gemini"); ok {
			return provider
		}
	}

	// Safe Fallback: if gemini is missing, use any available provider
	if provider == nil {
		b.routerMu.RLock()
		defer b.routerMu.RUnlock()
		for _, p := range b.ModelRouter {
			fmt.Printf("[Brain Warning] Gemini missing. Using '%s' as generic search fallback.\n", p.Name())
			return p
		}
	}

	return provider
}

// ProcessPrompt runs the entire lifecycle for a given user prompt
func (b *Brain) ProcessPrompt(ctx context.Context, prompt string) (string, error) {
	if strings.HasPrefix(strings.ToLower(prompt), "deep dive investigation into:") {
		fmt.Printf("[Brain] >>> DISPATCHING DEEP DIVE: %s <<<\n", strings.TrimPrefix(prompt, "Deep dive investigation into: "))
	} else {
		fmt.Printf("[Brain] Processing new investigation: %s\n", prompt)
	}

	// --- STEP 1: Break down into 8 queries ---
	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Thinking (Generating sub-queries)",
		})
	}

	b.Model.ResponseMIMEType = "application/json"

	currentDate := time.Now().Format("Monday, January 2, 2006")
	provider := b.GetSearchProvider()
	if provider == nil {
		return "", fmt.Errorf("no AI model providers are configured or available")
	}

	systemInstruction := fmt.Sprintf("You are the central Brain of a web scraper. Today's current date is %s. Break the user's prompt into between 4 and 12 distinct search queries that cover varied research angles based on the complexity of the request. "+
		"Use the current date to contextualize time-sensitive queries if applicable. "+
		"Example angles: technical specifications, competitive landscape, historical context, future predictions, public sentiment/rumors, financial/market impact, recent news, and expert reviews. "+
		"Return ONLY a JSON object with a 'queries' array of strings.", currentDate)

	fullPrompt := systemInstruction + "\n\nUser Prompt: " + prompt
	var subQ SubQueries
	if err := provider.GenerateJSON(ctx, fullPrompt, &subQ); err != nil {
		fmt.Printf("[Brain Error] Selected provider %s failed: %v. Attempting Gemini fallback...\n", provider.Name(), err)
		if b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type:    "BRAIN_STATE",
				Payload: fmt.Sprintf("Provider %s failed, falling back to active provider...", provider.Name()),
			})
		}
		fallbackProvider, ok := b.GetRouter("gemini")
		if !ok || fallbackProvider.GenerateJSON(ctx, fullPrompt, &subQ) != nil {
			return "", fmt.Errorf("failed to generate sub-queries format (even after fallback): %w", err)
		}
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

	// --- STEP 2: Dispatch Queries to Nervous System ---
	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Instructing Legs",
		})
	}
	// Ensure channels are fresh for this run
	b.NS.NerveChannel = make(chan models.NerveSignal, numQueries)
	b.NS.NutrientChannel = make(chan models.NutrientFlow, numQueries)

	for i, q := range subQ.Queries {
		b.NS.NerveChannel <- models.NerveSignal{
			TargetQuery: q,
			LegID:       i,
		}
	}
	// Important: close nerveChannel so workers eventually exit
	close(b.NS.NerveChannel)

	// Start working Goroutines (The Legs)
	b.NS.StartLegs()

	// --- STEP 3: Wait for Nutrients and Store in Abdomen ---
	for i := 0; i < numQueries; i++ {
		nutrient := <-b.NS.NutrientChannel

		b.Abdomen.Mutex.Lock()
		if nutrient.Error == nil && nutrient.Content != "" {
			// Generate a 2-sentence summary and title for the node
			title, summary, err := b.summarizeNode(ctx, nutrient.Content)

			// Skip node if summary fails or indicates junk content (e.g. security block or empty page)
			if err != nil || title == "" || strings.Contains(strings.ToLower(summary), "security access") || strings.Contains(strings.ToLower(summary), "failed to extract") {
				fmt.Printf("[Brain info] Skipping node for Leg %d due to low quality content or extraction failure.\n", nutrient.LegID)
			} else {
				memory := fmt.Sprintf("Source: %s\nContent: %s", nutrient.SourceURL, nutrient.Content)
				b.Abdomen.MemoryContext = append(b.Abdomen.MemoryContext, memory)

				node := models.MemoryNode{
					ID:        fmt.Sprintf("node-%d-%d", time.Now().UnixNano(), i),
					Title:     title,
					Summary:   summary,
					FullText:  nutrient.Content,
					SourceURL: nutrient.SourceURL,
				}

				if b.NS.Broadcast != nil {
					b.NS.Broadcast(models.WSMessage{
						Type: "MEMORY_NODE_GATHERED",
						Payload: map[string]interface{}{
							"node":  node,
							"total": len(b.Abdomen.MemoryContext),
						},
					})
				}
			}
		} else if nutrient.Error != nil {
			fmt.Printf("[Brain Warning] Leg %d returned error: %v\n", nutrient.LegID, nutrient.Error)
		}
		b.Abdomen.Mutex.Unlock()
	}

	// Ensure legs have finished executing cleanly
	b.NS.WaitGroup.Wait()

	// --- STEP 4: Synthesize Final Response ---
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
	contextText, err := b.RankAndFilterFacts(ctx, prompt, rawFacts)
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

	finalSynthesis, err := provider.GenerateContent(ctx, synthesisPrompt)
	if err != nil {
		fmt.Printf("[Brain Error] Selected provider %s failed synthesis: %v. Attempting Gemini fallback...\n", provider.Name(), err)
		if b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type:    "BRAIN_STATE",
				Payload: fmt.Sprintf("Provider %s failed synthesis, falling back to Gemini...", provider.Name()),
			})
		}
		fallbackProvider, ok := b.GetRouter("gemini")
		if !ok {
			return "", fmt.Errorf("failed to generate final synthesis and no fallback available: %w", err)
		}
		finalSynthesis, err = fallbackProvider.GenerateContent(ctx, synthesisPrompt)
		if err != nil {
			return "", fmt.Errorf("fallback failed to generate final synthesis: %w", err)
		}
	}

	// Save to Vault
	vaultPath, err := saveVaultMemory(prompt, contextText, finalSynthesis)
	if err != nil {
		fmt.Printf("Warning: failed to save vault memory: %v\n", err)
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
	fmt.Printf("[Brain] Processing %d local files\n", len(filePaths))

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

	// --- STEP 3: Dispatch Queries to Nervous System ---
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

	// --- STEP 4: Wait for Nutrients and Store in Abdomen ---
	// Wait for exactly as many chunks as we dispatched
	expected := len(allChunks)
	for i := 0; i < expected; i++ {
		nutrient := <-b.NS.NutrientChannel

		b.Abdomen.Mutex.Lock()
		if nutrient.Error == nil && nutrient.Content != "" {
			title, summary, err := b.summarizeNode(ctx, nutrient.Content)

			if err != nil || title == "" || strings.Contains(strings.ToLower(summary), "security access") || strings.Contains(strings.ToLower(summary), "failed to extract") {
				fmt.Printf("[Brain info] Skipping node for Leg %d due to low quality content or extraction failure.\n", nutrient.LegID)
			} else {
				memory := fmt.Sprintf("Source: %s\nContent: %s", nutrient.SourceURL, nutrient.Content)
				b.Abdomen.MemoryContext = append(b.Abdomen.MemoryContext, memory)

				node := models.MemoryNode{
					ID:        fmt.Sprintf("node-%d-%d", time.Now().UnixNano(), i),
					Title:     title,
					Summary:   summary,
					FullText:  nutrient.Content,
					SourceURL: nutrient.SourceURL,
				}

				if b.NS.Broadcast != nil {
					b.NS.Broadcast(models.WSMessage{
						Type: "MEMORY_NODE_GATHERED",
						Payload: map[string]interface{}{
							"node":  node,
							"total": len(b.Abdomen.MemoryContext),
						},
					})
				}
			}
		} else if nutrient.Error != nil {
			fmt.Printf("[Brain Warning] Leg %d returned error: %v\n", nutrient.LegID, nutrient.Error)
		}
		b.Abdomen.Mutex.Unlock()
	}

	b.NS.WaitGroup.Wait()

	// --- STEP 4: Synthesize Final Response ---
	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Synthesizing Final Response",
		})
	}

	b.Abdomen.Mutex.RLock()
	contextText := strings.Join(b.Abdomen.MemoryContext, "\n\n")
	b.Abdomen.Mutex.RUnlock()

	b.Model.ResponseMIMEType = "text/plain"

	currentDate := time.Now().Format("Monday, January 2, 2006")
	b.Model.SystemInstruction = genai.NewUserContent(genai.Text(
		fmt.Sprintf("You are an expert intelligence analyst compiling a final report. Today's current date is %s. Contextualize all findings chronologically based on this date.", currentDate),
	))

	synthesisPrompt := fmt.Sprintf(
		"Based on the following facts gathered from local files, provide a comprehensive summary of the documents' contents.\n\nLocal Files: %s\n\nGathered Facts:\n%s",
		strings.Join(filePaths, ", "), contextText,
	)

	finalResp, err := b.Model.GenerateContent(ctx, genai.Text(synthesisPrompt))
	if err != nil {
		return "", fmt.Errorf("failed to generate final synthesis: %w", err)
	}

	finalSynthesis := fmt.Sprintf("%v", finalResp.Candidates[0].Content.Parts[0])

	// Save to Vault
	var vaultPrefix string
	if len(filePaths) == 1 {
		vaultPrefix = "local_file_" + filepath.Base(filePaths[0])
	} else {
		vaultPrefix = "local_files_multiple"
	}
	vaultPath, err := saveVaultMemory(vaultPrefix, contextText, finalSynthesis)
	if err != nil {
		fmt.Printf("Warning: failed to save vault memory: %v\n", err)
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
			},
		})
	}

	return finalSynthesis, nil
}

// saveVaultMemory writes the memory to a properly formatted, timestamped vault file
func saveVaultMemory(prompt, rawData, summary string) (string, error) {
	now := time.Now()
	dateDir := fmt.Sprintf("./abdomen_vault/%s", now.Format("2006-01-02"))
	if err := os.MkdirAll(dateDir, 0755); err != nil {
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

	filename := fmt.Sprintf("%s_%s.md", now.Format("15-04-05"), string(topicRunes))
	filepath := dateDir + "/" + filename

	content := fmt.Sprintf("# Crawler Result Vault\n\n## Final Summary\n%s\n\n## Raw Digested Facts\n%s\n", summary, rawData)
	err := os.WriteFile(filepath, []byte(content), 0644)
	return filepath, err
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
	if err := provider.GenerateJSON(ctx, fullPrompt, &res); err != nil {
		fmt.Printf("[Brain Error] summarizeNode provider %s failed: %v. Attempting Gemini fallback...\n", provider.Name(), err)
		if b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type:    "BRAIN_STATE",
				Payload: fmt.Sprintf("Provider %s failed, falling back to active provider...", provider.Name()),
			})
		}
		fallbackProvider, ok := b.GetRouter("gemini")
		if !ok || fallbackProvider.GenerateJSON(ctx, fullPrompt, &res) != nil {
			fmt.Printf("[Brain Error] summarizeNode fallback failed or disabled\n")
			return "", "", err
		}
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
	if err := provider.GenerateJSON(ctx, fullPrompt, &connections); err != nil {
		fmt.Printf("[Brain Error] Connection analysis %s failed: %v. Attempting Gemini fallback...\n", provider.Name(), err)
		if b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type:    "BRAIN_STATE",
				Payload: fmt.Sprintf("Provider %s failed, falling back to active provider...", provider.Name()),
			})
		}
		fallbackProvider, ok := b.GetRouter("gemini")
		if !ok || fallbackProvider.GenerateJSON(ctx, fullPrompt, &connections) != nil {
			fmt.Printf("[Brain Error] Connection analysis fallback failed\n")
			return nil, err
		}
	}

	for i := range connections {
		connections[i].Tag = SanitizeTag(connections[i].Tag)
	}

	fmt.Printf("[Brain] Analysis complete. Found %d relationships.\n", len(connections))
	return connections, nil
}

// AnalyzeWithPersonas runs multi-agent persona analysis on the gathered findings
func (b *Brain) AnalyzeWithPersonas(ctx context.Context, nodes []models.MemoryNode) ([]PersonaInsight, error) {
	fmt.Printf("[Brain] Running multi-agent persona analysis with %d personas...\n", len(GetDefaultPersonas()))

	// Build findings text from all nodes - include ID so AI can reference them
	findingsText := ""
	for _, node := range nodes {
		findingsText += fmt.Sprintf("[NodeID: %s]\nSource: %s\nTitle: %s\nSummary: %s\nFull Text: %s\n\n",
			node.ID, node.SourceURL, node.Title, node.Summary, node.FullText)
	}

	personas := GetDefaultPersonas()
	insightsChan := make(chan PersonaInsight, len(personas))

	// Run each persona analysis in parallel
	for _, persona := range personas {
		go func(p Persona) {
			insight, err := b.runPersonaAnalysis(ctx, p, findingsText)
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
	return insights, nil
}

// runPersonaAnalysis executes a single persona's analysis
func (b *Brain) runPersonaAnalysis(ctx context.Context, persona Persona, findings string) (PersonaInsight, error) {
	prompt := BuildPersonaPrompt(persona, findings)

	// Get the appropriate model provider
	provider, ok := b.GetRouter(persona.ModelPref)
	if !ok {
		// Fall back to gemini if preferred model not available
		provider, _ = b.GetRouter("gemini")
	}

	// Safe Fallback: If gemini is also missing, pick any available provider
	if provider == nil {
		b.routerMu.RLock()
		for _, p := range b.ModelRouter {
			provider = p
			break
		}
		b.routerMu.RUnlock()

		if provider == nil {
			return PersonaInsight{PersonaName: persona.Name, Confidence: 0}, fmt.Errorf("no model providers available to run persona analysis")
		}
		fmt.Printf("[Brain Warning] Preferred model '%s' and 'gemini' unavailable. Using '%s' for Persona '%s'\n", persona.ModelPref, provider.Name(), persona.Name)
	}

	fmt.Printf("[Brain] Running persona %s with model %s\n", persona.Name, provider.Name())

	var response PersonaJSONResponse
	err := provider.GenerateJSON(ctx, prompt, &response)
	if err != nil {
		return PersonaInsight{}, fmt.Errorf("failed to generate persona analysis: %w", err)
	}

	return PersonaInsight{
		PersonaName:    persona.Name,
		Perspective:    persona.Perspective,
		KeyFindings:    response.KeyFindings,
		Connections:    response.Connections,
		Questions:      response.Questions,
		Confidence:     response.Confidence,
		FullAnalysis:   response.FullAnalysis,
		NodeIDs:        response.NodeIDs,
		TimelineEvents: response.TimelineEvents,
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
	if err := provider.GenerateJSON(ctx, fullPrompt, &connections); err != nil {
		fmt.Printf("[Brain Error] Persona synthesis %s failed: %v. Attempting Gemini fallback...\n", provider.Name(), err)
		if b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type:    "BRAIN_STATE",
				Payload: fmt.Sprintf("Provider %s failed, falling back to active provider...", provider.Name()),
			})
		}
		fallbackProvider, ok := b.GetRouter("gemini")
		if !ok || fallbackProvider.GenerateJSON(ctx, fullPrompt, &connections) != nil {
			fmt.Printf("[Brain Error] Persona synthesis fallback failed\n")
			return nil, err
		}
	}

	for i := range connections {
		connections[i].Tag = SanitizeTag(connections[i].Tag)
	}

	fmt.Printf("[Brain] Synthesis complete. Found %d final relationships.\n", len(connections))
	return connections, nil
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
