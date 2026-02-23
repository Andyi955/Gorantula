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
	Client  *genai.Client
	Model   *genai.GenerativeModel
	NS      *nervous_system.NervousSystem
	Abdomen *models.Abdomen
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

	return &Brain{
		Client:  client,
		Model:   model,
		NS:      ns,
		Abdomen: abdomen,
	}, nil
}

// ProcessPrompt runs the entire lifecycle for a given user prompt
func (b *Brain) ProcessPrompt(ctx context.Context, prompt string) (string, error) {
	// --- STEP 1: Break down into 8 queries ---
	if b.NS.Broadcast != nil {
		b.NS.Broadcast(models.WSMessage{
			Type:    "BRAIN_STATE",
			Payload: "Thinking (Generating sub-queries)",
		})
	}

	b.Model.ResponseMIMEType = "application/json"
	// Ensure we only retrieve JSON from Gemini
	b.Model.SystemInstruction = genai.NewUserContent(genai.Text(
		"You are the central Brain of a web scraper. Break the user's prompt into exactly 8 distinct search queries. Return ONLY a JSON object with a 'queries' array of strings.",
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
			memory := fmt.Sprintf("Source: %s\nContent: %s", nutrient.SourceURL, nutrient.Content)
			b.Abdomen.MemoryContext = append(b.Abdomen.MemoryContext, memory)

			// Generate a 2-sentence summary and title for the node
			title, summary, _ := b.summarizeNode(ctx, nutrient.Content)
			if title == "" {
				title = fmt.Sprintf("Discovery %d", i)
			}

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
	b.Model.SystemInstruction = nil

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
	topicBytes := []byte(topic)
	for i, c := range topicBytes {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
			topicBytes[i] = '-'
		}
	}

	filename := fmt.Sprintf("%s_%s.md", now.Format("15-04-05"), string(topicBytes))
	filepath := dateDir + "/" + filename

	content := fmt.Sprintf("# Crawler Result Vault\n\n## Final Summary\n%s\n\n## Raw Digested Facts\n%s\n", summary, rawData)
	err := os.WriteFile(filepath, []byte(content), 0644)
	return filepath, err
}

func (b *Brain) summarizeNode(ctx context.Context, content string) (string, string, error) {
	// Create a temporary model instance to avoid clobbering global instructions during concurrent leg processing
	tempModel := b.Client.GenerativeModel("gemini-3-flash-preview")
	tempModel.ResponseMIMEType = "application/json"
	tempModel.SystemInstruction = genai.NewUserContent(genai.Text(
		"You are a summarizer. Provide a short Title (max 5 words) and exactly 2 sentences of Summary for the provided text. Return ONLY JSON with 'title' and 'summary' fields.",
	))

	resp, err := tempModel.GenerateContent(ctx, genai.Text(content))
	if err != nil {
		return "", "", err
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", "", fmt.Errorf("empty summary response")
	}

	jsonText := fmt.Sprintf("%v", resp.Candidates[0].Content.Parts[0])
	var res struct {
		Title   string `json:"title"`
		Summary string `json:"summary"`
	}
	if err := json.Unmarshal([]byte(jsonText), &res); err != nil {
		return "", "", err
	}
	return res.Title, res.Summary, nil
}

func (b *Brain) AnalyzeConnections(ctx context.Context, nodes []models.MemoryNode) ([]models.BoardConnection, error) {
	combinedText := ""
	for _, node := range nodes {
		combinedText += fmt.Sprintf("ID: %s\nTitle: %s\nSummary: %s\n---\n", node.ID, node.Title, node.Summary)
	}

	tempModel := b.Client.GenerativeModel("gemini-3-flash-preview")
	tempModel.ResponseMIMEType = "application/json"

	// Set temperature to 0.2 for analytical precision
	config := b.Model.GenerationConfig
	config.Temperature = genai.Ptr(float32(0.2))
	tempModel.GenerationConfig = config

	tempModel.SystemInstruction = genai.NewUserContent(genai.Text(
		"Analyze these pieces of research evidence. Find hidden logical connections between them. " +
			"Return ONLY a JSON array of objects with: 'source' (ID), 'target' (ID), 'tag' (a 1-2 word uppercase relationship label, e.g., 'OPPOSES', 'SUPPORTS', 'CAUSAL'), " +
			"and 'reasoning' (a detailed 1-sentence explanation). Only connect the 5 strongest relationships.",
	))

	resp, err := tempModel.GenerateContent(ctx, genai.Text(combinedText))
	if err != nil {
		return nil, err
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("empty connection response")
	}

	jsonText := fmt.Sprintf("%v", resp.Candidates[0].Content.Parts[0])
	var connections []models.BoardConnection
	if err := json.Unmarshal([]byte(jsonText), &connections); err != nil {
		return nil, err
	}
	return connections, nil
}
