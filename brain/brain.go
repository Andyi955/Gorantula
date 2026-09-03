package brain

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Andyi955/Gorantula/models"
	"github.com/Andyi955/Gorantula/nervous_system"

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

// SubQueries encapsulates the JSON response expected from the planning model.
type SubQueries struct {
	Queries []string `json:"queries"`
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
	Client        *genai.Client
	Model         *genai.GenerativeModel
	NS            *nervous_system.NervousSystem
	Abdomen       *models.Abdomen
	ModelRouter   map[string]ModelProvider
	routerMu      sync.RWMutex
	modelMu       sync.Mutex
	tokenUsageMu  sync.Mutex
	tokenUsage    *tokenUsageTracker
	AnalysisCache *AnalysisCache
	Synthesis     *SynthesisEngine
	// nodesReadyHook, when set, fires the moment a web crawl's evidence
	// nodes are summarized - before fact ranking and report generation.
	// The app layer uses it to start the persona/relationship/discovery
	// pipeline in parallel with the report (pipeline parallelism).
	nodesReadyHook func(vaultID string, nodes []models.MemoryNode, runID string)
	nodesReadyMu   sync.Mutex
}

// SetNodesReadyHook wires the parallel pipeline trigger. Called at most once
// per crawl, synchronously during gathering - implementations must return
// quickly (spawn internally if needed).
func (b *Brain) SetNodesReadyHook(hook func(vaultID string, nodes []models.MemoryNode, runID string)) {
	b.nodesReadyMu.Lock()
	defer b.nodesReadyMu.Unlock()
	b.nodesReadyHook = hook
}

func (b *Brain) notifyNodesReady(vaultID string, nodes []models.MemoryNode, runID string) {
	b.nodesReadyMu.Lock()
	hook := b.nodesReadyHook
	b.nodesReadyMu.Unlock()
	if hook == nil {
		return
	}
	hook(vaultID, nodes, runID)
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
	brainLog("providers").Info("model providers reloaded", "available", len(router))
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
		Client:        client,
		Model:         model, // Legacy ref, kept for backward compatibility if needed temporarily
		NS:            ns,
		Abdomen:       abdomen,
		tokenUsage:    newTokenUsageTracker(),
		AnalysisCache: NewAnalysisCache(defaultAnalysisCacheDir()),
	}

	router, err := NewModelRouter(brain)
	if err != nil {
		brainLog("providers").Warn("failed to initialize model router", "err", err)
	} else {
		brain.ModelRouter = router
	}

	alertChan := make(chan SynthesisAlert, 20)
	brain.Synthesis = NewSynthesisEngine("./abdomen_vault", alertChan)
	go func() {
		for alert := range alertChan {
			brainLog("synthesis").Info(
				"broadcasting synthesis alert",
				"alert_key", alert.AlertKey,
				"current_vault", alert.CurrentVaultID,
				"entity", alert.Entity,
				"connected_cases", alert.ConnectedCases,
			)
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

func (b *Brain) generateJSONWithFallbackProvider(ctx context.Context, operation string, provider ModelProvider, prompt string, target interface{}) (ModelProvider, error) {
	if provider == nil {
		return nil, fmt.Errorf("no model providers available")
	}
	if err := provider.GenerateJSON(ctx, prompt, target); err != nil {
		brainLog("providers").Warn("provider json generation failed; trying fallback", "operation", operation, "provider", provider.Name(), "err", err)
		fallbackProvider, ok := b.fallbackProviderAfter(provider)
		if !ok {
			return nil, err
		}
		if fallbackErr := fallbackProvider.GenerateJSON(ctx, prompt, target); fallbackErr != nil {
			brainLog("providers").Error("fallback provider json generation failed", "operation", operation, "provider", provider.Name(), "fallback_provider", fallbackProvider.Name(), "err", fallbackErr)
			return nil, err
		}
		brainLog("providers").Info("provider json generation recovered using fallback", "operation", operation, "provider", provider.Name(), "fallback_provider", fallbackProvider.Name())
		return fallbackProvider, nil
	}
	return provider, nil
}

func (b *Brain) generateJSONWithFallback(ctx context.Context, operation string, provider ModelProvider, prompt string, target interface{}) error {
	_, err := b.generateJSONWithFallbackProvider(ctx, operation, provider, prompt, target)
	return err
}

func (b *Brain) generateContentWithFallback(ctx context.Context, operation string, provider ModelProvider, prompt string) (string, error) {
	if provider == nil {
		return "", fmt.Errorf("no model providers available")
	}
	generationStartedAt := time.Now()
	content, err := provider.GenerateContent(ctx, prompt)
	tracePipelineSpan(pipelineTraceRecord{
		Span:        "report/" + operation,
		Provider:    provider.Name(),
		PromptChars: len(prompt),
		DurationMs:  time.Since(generationStartedAt).Milliseconds(),
		Thinking:    traceThinking(ctx),
		Error:       errorSummaryOrNil(err),
	})
	if err == nil {
		return content, nil
	}
	brainLog("providers").Warn("provider content generation failed; trying fallback", "operation", operation, "provider", provider.Name(), "err", err)
	fallbackProvider, ok := b.fallbackProviderAfter(provider)
	if !ok {
		return "", err
	}
	content, fallbackErr := fallbackProvider.GenerateContent(ctx, prompt)
	if fallbackErr != nil {
		brainLog("providers").Error("fallback provider content generation failed", "operation", operation, "provider", provider.Name(), "fallback_provider", fallbackProvider.Name(), "err", fallbackErr)
		return "", err
	}
	brainLog("providers").Info("provider content generation recovered using fallback", "operation", operation, "provider", provider.Name(), "fallback_provider", fallbackProvider.Name())
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
			brainLog("providers").Warn("preferred search provider unavailable; using fallback", "preferred_provider", pref, "fallback_provider", p.Name())
			return p
		}
	}

	return provider
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
	normalizedContent := normalizeCacheText(content)
	contentHash := hashString(normalizedContent)
	promptHash := hashString(systemInstruction + "\n\nContent to summarize:\n" + normalizedContent)
	if b.AnalysisCache != nil {
		if title, summary, ok := b.AnalysisCache.getNodeSummary(providerCacheIdentity(provider), contentHash, promptHash); ok {
			return title, summary, nil
		}
	}
	var res struct {
		Title   string `json:"title"`
		Summary string `json:"summary"`
	}
	actualProvider, err := b.generateJSONWithFallbackProvider(ctx, "node summary", provider, fullPrompt, &res)
	if err != nil {
		if b.NS != nil && b.NS.Broadcast != nil {
			b.NS.Broadcast(models.WSMessage{
				Type:    "BRAIN_STATE",
				Payload: fmt.Sprintf("Provider %s failed while summarizing a node.", provider.Name()),
			})
		}
		return "", "", err
	}
	if b.AnalysisCache != nil {
		b.AnalysisCache.saveNodeSummary(providerCacheIdentity(actualProvider), contentHash, promptHash, res.Title, res.Summary)
	}
	return res.Title, res.Summary, nil
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
