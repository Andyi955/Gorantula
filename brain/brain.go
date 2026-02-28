package brain

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"spider-agent/models"
	"spider-agent/nervous_system"

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

// SubQueries encapsulates the JSON response expected from Gemini
type SubQueries struct {
	Queries []string `json:"queries"`
}

// Brain controls the LLM generation and orchestration of the Nervous System
type Brain struct {
	Client     *genai.Client
	Model      *genai.GenerativeModel
	NS         *nervous_system.NervousSystem
	Abdomen    *models.Abdomen
	ModelRouter map[string]ModelProvider
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

	// Assuming 'gemini-3.0-flash' model string as per future specs (2026)
	model := client.GenerativeModel("gemini-3-flash-preview")

	brain := &Brain{
		Client:  client,
		Model:   model,
		NS:      ns,
		Abdomen: abdomen,
	}

	// Initialize model router with available providers
	router, err := NewModelRouter(brain)
	if err != nil {
		fmt.Printf("[Brain] Warning: Failed to initialize model router: %v\n", err)
	} else {
		brain.ModelRouter = router
		fmt.Printf("[Brain] Model router initialized with providers: ")
		for name := range router {
			fmt.Printf("%s ", name)
		}
		fmt.Println()
	}

	return brain, nil
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

	// Ensure we only retrieve JSON from Gemini
	b.Model.SystemInstruction = genai.NewUserContent(genai.Text(
		fmt.Sprintf("You are the central Brain of a web scraper. Today's current date is %s. Break the user's prompt into exactly 8 distinct search queries that cover varied research angles. "+
			"Use the current date to contextualize time-sensitive queries if applicable. "+
			"Example angles: technical specifications, competitive landscape, historical context, future predictions, public sentiment/rumors, financial/market impact, recent news, and expert reviews. "+
			"Return ONLY a JSON object with a 'queries' array of strings.", currentDate),
	))

	resp, err := b.Model.GenerateContent(ctx, genai.Text(prompt))
	if err != nil {
		return "", fmt.Errorf("failed to generate sub-queries: %w", err)
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("empty response from Gemini")
	}

	jsonText := fmt.Sprintf("%v", resp.Candidates[0].Content.Parts[0])
	var subQ SubQueries
	if err := json.Unmarshal([]byte(jsonText), &subQ); err != nil {
		return "", fmt.Errorf("failed to parse sub-queries JSON: %w", err)
	}

	// Make sure we have exactly 8 queries
	if len(subQ.Queries) == 0 {
		return "", fmt.Errorf("gemini returned 0 queries")
	}
	for len(subQ.Queries) < 8 {
		subQ.Queries = append(subQ.Queries, subQ.Queries[0])
	}
	if len(subQ.Queries) > 8 {
		subQ.Queries = subQ.Queries[:8]
	}

	// --- STEP 2: Dispatch Queries to Nervous System ---
	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Instructing Legs",
		})
	}
	// Ensure channels are fresh for this run
	b.NS.NerveChannel = make(chan models.NerveSignal, 8)
	b.NS.NutrientChannel = make(chan models.NutrientFlow, 8)

	for i, q := range subQ.Queries {
		b.NS.NerveChannel <- models.NerveSignal{
			TargetQuery: q,
			LegID:       i,
		}
	}
	// Important: close nerveChannel so workers eventually exit
	close(b.NS.NerveChannel)

	// Start 8 working Goroutines (The Legs)
	b.NS.StartLegs()

	// --- STEP 3: Wait for 8 Nutrients and Store in Abdomen ---
	for i := 0; i < 8; i++ {
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
	contextText := strings.Join(b.Abdomen.MemoryContext, "\n\n")
	b.Abdomen.Mutex.RUnlock()

	// Reset MIME type and system instructions for clear text response
	b.Model.ResponseMIMEType = "text/plain"

	currentDate = time.Now().Format("Monday, January 2, 2006")
	b.Model.SystemInstruction = genai.NewUserContent(genai.Text(
		fmt.Sprintf("You are an expert intelligence analyst compiling a final report. Today's current date is %s. Contextualize all findings chronologically based on this date.", currentDate),
	))

	synthesisPrompt := fmt.Sprintf(
		"Based on the following facts gathered by your scraping legs, provide a comprehensive answer to the user's original query.\n\nUser Query: %s\n\nGathered Facts:\n%s",
		prompt, contextText,
	)

	finalResp, err := b.Model.GenerateContent(ctx, genai.Text(synthesisPrompt))
	if err != nil {
		return "", fmt.Errorf("failed to generate final synthesis: %w", err)
	}

	finalSynthesis := fmt.Sprintf("%v", finalResp.Candidates[0].Content.Parts[0])

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
	// Create a temporary model instance to avoid clobbering global instructions during concurrent leg processing
	tempModel := b.Client.GenerativeModel("gemini-3-flash-preview")
	tempModel.ResponseMIMEType = "application/json"
	currentDate := time.Now().Format("Monday, January 2, 2006")
	tempModel.SystemInstruction = genai.NewUserContent(genai.Text(
		fmt.Sprintf("You are a Senior Strategic Intelligence Officer. Today's current date is %s. Provide a professional 'INTEL_DOSSIER' style summary. "+
			"1. Title: Short, punchy, high-impact (max 5 words). "+
			"2. Summary: Exactly 2 sentences. Contextualize 'recent' or 'upcoming' based on today's current date. "+
			"3. REQUIRED TAGGING: Wrap critical entities like this: [PERSON:Elon Musk], [ORG:OpenAI], [LOC:London], [DATE:2026-02-24]. "+
			"4. IMPORTANT: Return ONLY a valid JSON object with 'title' and 'summary' keys. No text. No markdown. "+
			"CRITICAL: If the text is a security block or indicates bot detection, return ONLY {}.", currentDate),
	))

	resp, err := tempModel.GenerateContent(ctx, genai.Text(content))
	if err != nil {
		return "", "", err
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", "", fmt.Errorf("empty summary response")
	}

	jsonText := fmt.Sprintf("%v", resp.Candidates[0].Content.Parts[0])

	// Clean up markdown formatting if the model wrapped the response
	jsonText = strings.TrimPrefix(jsonText, "```json")
	jsonText = strings.TrimPrefix(jsonText, "```")
	jsonText = strings.TrimSuffix(jsonText, "```")
	jsonText = strings.TrimSpace(jsonText)

	var res struct {
		Title   string `json:"title"`
		Summary string `json:"summary"`
	}
	if err := json.Unmarshal([]byte(jsonText), &res); err != nil {
		fmt.Printf("[Brain Error] summarizeNode failed to parse JSON: %v\nRaw text: %s\n", err, jsonText)
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

	tempModel := b.Client.GenerativeModel("gemini-3-flash-preview")
	tempModel.ResponseMIMEType = "application/json"

	// Set temperature to 0.2 for analytical precision
	config := b.Model.GenerationConfig
	config.Temperature = genai.Ptr(float32(0.2))
	tempModel.GenerationConfig = config

	currentDate := time.Now().Format("Monday, January 2, 2006")
	tempModel.SystemInstruction = genai.NewUserContent(genai.Text(
		fmt.Sprintf("You are a Senior Counter-Intelligence Analyst. Today's current date is %s. Conduct a rigorous cross-examination of these intelligence nodes. "+
			"1. Map the logical infrastructure of the case. Seek contradictions (OPPOSES) and strategic dependencies (EXPANDS/DEPENDS) chronologically if needed. "+
			"2. Only connect evidence with high clinical confidence. "+
			"3. Tags MUST be one of: SUPPORTS, OPPOSES, EXPANDS, DEPENDS, RELATED. "+
			"4. CRITICAL: Use the node IDs from the mapping above - NOT titles! "+
			"5. IMPORTANT: YOU MUST RETURN ONLY A VALID JSON ARRAY OF OBJECTS. NO TEXT. NO MARKDOWN. Elements must be: 'source', 'target', 'tag', 'reasoning'. "+
			"Connect the 6 strongest relationships.", currentDate),
	))

	resp, err := tempModel.GenerateContent(ctx, genai.Text(combinedText))
	if err != nil {
		fmt.Printf("[Brain Error] Connection analysis failed: %v\n", err)
		return nil, err
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("empty connection response")
	}

	jsonText := fmt.Sprintf("%v", resp.Candidates[0].Content.Parts[0])

	// Clean up markdown formatting if the model wrapped the response
	jsonText = strings.TrimPrefix(jsonText, "```json")
	jsonText = strings.TrimPrefix(jsonText, "```")
	jsonText = strings.TrimSuffix(jsonText, "```")
	jsonText = strings.TrimSpace(jsonText)

	var connections []models.BoardConnection
	if err := json.Unmarshal([]byte(jsonText), &connections); err != nil {
		fmt.Printf("[Brain Error] Failed to parse connections JSON: %v\nRaw text: %s\n", err, jsonText)
		return nil, err
	}
	fmt.Printf("[Brain] Analysis complete. Found %d relationships.\n", len(connections))
	return connections, nil
}

// AnalyzeWithPersonas runs multi-agent persona analysis on the gathered findings
func (b *Brain) AnalyzeWithPersonas(ctx context.Context, nodes []models.MemoryNode) ([]PersonaInsight, error) {
	fmt.Printf("[Brain] Running multi-agent persona analysis with %d personas...\n", len(GetDefaultPersonas()))

	// Build findings text from all nodes
	findingsText := ""
	for _, node := range nodes {
		findingsText += fmt.Sprintf("Source: %s\nTitle: %s\nSummary: %s\nFull Text: %s\n\n",
			node.SourceURL, node.Title, node.Summary, node.FullText)
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
	provider, ok := b.ModelRouter[persona.ModelPref]
	if !ok {
		// Fall back to gemini if preferred model not available
		provider = b.ModelRouter["gemini"]
		if provider == nil {
			return PersonaInsight{}, fmt.Errorf("no model provider available")
		}
	}

	fmt.Printf("[Brain] Running persona %s with model %s\n", persona.Name, provider.Name())

	var response PersonaJSONResponse
	err := provider.GenerateJSON(ctx, prompt, &response)
	if err != nil {
		return PersonaInsight{}, fmt.Errorf("failed to generate persona analysis: %w", err)
	}

	return PersonaInsight{
		PersonaName:   persona.Name,
		Perspective:  persona.Perspective,
		KeyFindings:   response.KeyFindings,
		Connections:   response.Connections,
		Questions:     response.Questions,
		Confidence:    response.Confidence,
		FullAnalysis: response.FullAnalysis,
		NodeIDs:       response.NodeIDs,
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
		insightsSummary += fmt.Sprintf("Key Findings:\n")
		for _, f := range insight.KeyFindings {
			insightsSummary += fmt.Sprintf("  - %s\n", f)
		}
		insightsSummary += fmt.Sprintf("Connections:\n")
		for _, c := range insight.Connections {
			insightsSummary += fmt.Sprintf("  - %s\n", c)
		}
		insightsSummary += fmt.Sprintf("Questions:\n")
		for _, q := range insight.Questions {
			insightsSummary += fmt.Sprintf("  - %s\n", q)
		}
		insightsSummary += fmt.Sprintf("Analysis: %s\n", insight.FullAnalysis)
	}

	// Add node ID mapping so AI knows which IDs to use
	insightsSummary += buildNodeMapping(nodes)

	// Now synthesize using the insights
	tempModel := b.Client.GenerativeModel("gemini-3-flash-preview")
	tempModel.ResponseMIMEType = "application/json"

	config := b.Model.GenerationConfig
	config.Temperature = genai.Ptr(float32(0.2))
	tempModel.GenerationConfig = config

	currentDate := time.Now().Format("Monday, January 2, 2006")
	tempModel.SystemInstruction = genai.NewUserContent(genai.Text(
		fmt.Sprintf("You are a Senior Counter-Intelligence Analyst coordinating a team of 6 specialists. Today's current date is %s. "+
			"Synthesize the insights from all specialists into the 6 strongest relationships between evidence nodes. "+
			"Each specialist provided: key findings, connections they identified, and follow-up questions. "+
			"Prioritize connections that multiple specialists agree on. "+
			"Tags MUST be one of: SUPPORTS, OPPOSES, EXPANDS, DEPENDS, RELATED. "+
			"CRITICAL: Use the node IDs from the mapping above - NOT titles! "+
			"YOU MUST RETURN ONLY A VALID JSON ARRAY OF OBJECTS. NO TEXT. NO MARKDOWN. Elements must be: 'source', 'target', 'tag', 'reasoning'. "+
			"The 'reasoning' should mention which specialists supported this connection.", currentDate),
	))

	resp, err := tempModel.GenerateContent(ctx, genai.Text(insightsSummary))
	if err != nil {
		fmt.Printf("[Brain Error] Persona synthesis failed: %v\n", err)
		return nil, err
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("empty synthesis response")
	}

	jsonText := fmt.Sprintf("%v", resp.Candidates[0].Content.Parts[0])
	jsonText = strings.TrimPrefix(jsonText, "```json")
	jsonText = strings.TrimPrefix(jsonText, "```")
	jsonText = strings.TrimSuffix(jsonText, "```")
	jsonText = strings.TrimSpace(jsonText)

	var connections []models.BoardConnection
	if err := json.Unmarshal([]byte(jsonText), &connections); err != nil {
		fmt.Printf("[Brain Error] Failed to parse synthesis JSON: %v\nRaw text: %s\n", err, jsonText)
		return nil, err
	}

	fmt.Printf("[Brain] Synthesis complete. Found %d final relationships.\n", len(connections))
	return connections, nil
}
