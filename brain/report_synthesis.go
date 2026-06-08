package brain

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/Andyi955/Gorantula/models"
)

// RankResult encapsulates the relevance score for a fact (Generation 2)
type RankResult struct {
	Score  int    `json:"score"`
	Reason string `json:"reason"`
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
	brainLog("synthesis").Info("analyzing evidence connections", "nodes", len(nodes))
	combinedText := ""
	for _, node := range nodes {
		brainLog("synthesis").Debug("connection analysis node", "node", node.ID, "title", node.Title)
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

	brainLog("synthesis").Info("connection analysis complete", "relationships", len(connections))
	return connections, nil
}

// SynthesizePersonaInsights combines all persona insights into final connections
func (b *Brain) SynthesizePersonaInsights(ctx context.Context, nodes []models.MemoryNode, insights []PersonaInsight) ([]models.BoardConnection, error) {
	brainLog("synthesis").Info("synthesizing persona insights", "nodes", len(nodes), "insights", len(insights))

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

	brainLog("synthesis").Info("persona synthesis complete", "relationships", len(connections))
	return connections, nil
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

	brainLog("synthesis").Info("ranking facts for relevance", "facts", len(facts))

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

	brainLog("synthesis").Info("fact ranking complete", "retained", len(filteredFacts), "facts", len(facts))
	return strings.Join(filteredFacts, "\n\n"), nil
}
