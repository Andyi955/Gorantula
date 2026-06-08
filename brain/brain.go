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
		Client:        client,
		Model:         model, // Legacy ref, kept for backward compatibility if needed temporarily
		NS:            ns,
		Abdomen:       abdomen,
		tokenUsage:    newTokenUsageTracker(),
		AnalysisCache: NewAnalysisCache(defaultAnalysisCacheDir()),
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

func (b *Brain) generateJSONWithFallbackProvider(ctx context.Context, operation string, provider ModelProvider, prompt string, target interface{}) (ModelProvider, error) {
	if provider == nil {
		return nil, fmt.Errorf("no model providers available")
	}
	if err := provider.GenerateJSON(ctx, prompt, target); err != nil {
		fmt.Printf("[Brain Error] %s provider %s failed: %v. Attempting generic provider fallback...\n", operation, provider.Name(), err)
		fallbackProvider, ok := b.fallbackProviderAfter(provider)
		if !ok {
			return nil, err
		}
		if fallbackErr := fallbackProvider.GenerateJSON(ctx, prompt, target); fallbackErr != nil {
			fmt.Printf("[Brain Error] %s fallback provider %s failed: %v\n", operation, fallbackProvider.Name(), fallbackErr)
			return nil, err
		}
		fmt.Printf("[Brain] %s recovered using fallback provider %s\n", operation, fallbackProvider.Name())
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
