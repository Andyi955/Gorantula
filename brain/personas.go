package brain

import (
	"fmt"
	"os"
)

// Persona represents an AI agent with a specific perspective for analyzing investigation findings
type Persona struct {
	Name         string `json:"name"`
	Expertise    string `json:"expertise"`    // Area of focus (e.g., "timeline analysis", "entity extraction")
	Perspective  string `json:"perspective"`  // How they approach analysis
	Questions    string `json:"questions"`    // Questions they specifically ask
	ModelPref    string `json:"modelPref"`    // Preferred model (gemini or minimax)
	SystemPrompt string `json:"systemPrompt"` // Custom system instructions for this persona
}

// TimelineEvent represents a chronological event extracted by the Timeline Analyst
type TimelineEvent struct {
	Timestamp    string `json:"timestamp"`    // The date/time of the event
	Event        string `json:"event"`        // Description of the event
	SourceNodeID string `json:"sourceNodeId"` // The node ID where this event was found
}

// PersonaInsight represents the analysis output from a single persona
type PersonaInsight struct {
	PersonaName    string          `json:"personaName"`
	Perspective    string          `json:"perspective"`
	KeyFindings    []string        `json:"keyFindings"`    // List of important discoveries
	Connections    []string        `json:"connections"`    // Connections this persona sees
	Questions      []string        `json:"questions"`      // Follow-up questions raised
	Confidence     float32         `json:"confidence"`     // 0.0-1.0 confidence score
	FullAnalysis   string          `json:"fullAnalysis"`   // Full text analysis
	NodeIDs        []string        `json:"nodeIDs"`        // Node IDs this persona contributed insights to
	TimelineEvents []TimelineEvent `json:"timelineEvents"` // Chronological events extracted
}

// GetDefaultPersonas returns a set of 6 distinct personas for multi-agent collaboration
func GetDefaultPersonas() []Persona {
	prefModel := os.Getenv("DEFAULT_PERSONA_MODEL")

	// Default behavior if not set
	defaultGemini := "gemini"
	defaultMiniMax := "minimax"

	if prefModel != "" {
		defaultGemini = prefModel
		defaultMiniMax = prefModel
	}

	return []Persona{
		{
			Name:         "Skeptic",
			Expertise:    "Critical Analysis",
			Perspective:  "Questions assumptions, identifies gaps, and looks for contradictions in the evidence",
			Questions:    "What doesn't add up? What sources might be unreliable? What information is missing?",
			ModelPref:    defaultGemini,
			SystemPrompt: "You are a skeptical analyst. Your role is to find flaws, inconsistencies, and gaps in the evidence. Question every claim. Look for what doesn't add up.",
		},
		{
			Name:         "Connector",
			Expertise:    "Pattern Recognition",
			Perspective:  "Finds hidden links between different pieces of information and identifies overarching themes",
			Questions:    "How do these facts relate? What common threads connect these entities? What patterns emerge?",
			ModelPref:    defaultMiniMax,
			SystemPrompt: "You are a pattern recognition specialist. Your role is to find connections between disparate facts. Look for hidden links, shared themes, and relationships between entities.",
		},
		{
			Name:         "Timeline Analyst",
			Expertise:    "Temporal Analysis",
			Perspective:  "Chronologically orders events, identifies causality, and spots temporal patterns",
			Questions:    "When did this happen? What led to this? What's the sequence of events?",
			ModelPref:    defaultGemini,
			SystemPrompt: "You are a timeline specialist. Your role is to order events chronologically, identify cause-and-effect relationships, and spot temporal patterns. Extract ALL events with their corresponding timestamps.",
		},
		{
			Name:         "Entity Hunter",
			Expertise:    "Entity Extraction",
			Perspective:  "Identifies and profiles key people, organizations, and locations mentioned in the data",
			Questions:    "Who are the key players? What organizations are involved? Where is this happening?",
			ModelPref:    defaultMiniMax,
			SystemPrompt: "You are an entity extraction expert. Your role is to identify and profile all key people, organizations, locations, and dates mentioned in the evidence.",
		},
		{
			Name:         "Context Provider",
			Expertise:    "Background Research",
			Perspective:  "Provides historical context, explains jargon, and fills in knowledge gaps",
			Questions:    "What background information is needed? What terms need explanation? What historical context applies?",
			ModelPref:    defaultGemini,
			SystemPrompt: "You are a context specialist. Your role is to provide historical background, explain technical terms, and fill in knowledge gaps to help understand the evidence.",
		},
		{
			Name:         "Implications Mapper",
			Expertise:    "Impact Analysis",
			Perspective:  "Evaluates consequences, predicts outcomes, and assesses broader implications",
			Questions:    "What happens next? What are the implications? What could go wrong or right?",
			ModelPref:    defaultMiniMax,
			SystemPrompt: "You are an implications analyst. Your role is to evaluate consequences, predict potential outcomes, and assess the broader implications of the findings.",
		},
	}
}

// BuildPersonaPrompt creates a prompt for a specific persona to analyze the given findings
func BuildPersonaPrompt(persona Persona, findings string) string {
	return fmt.Sprintf(`%s

You are analyzing the following investigation findings:

---

%s

---

Your expertise: %s
Your perspective: %s

Specifically, consider these questions:
%s

Provide your analysis in JSON format with the following structure:
{
  "keyFindings": ["list of important discoveries"],
  "connections": ["connections you identify between facts"],
  "questions": ["follow-up questions this raises"],
  "confidence": 0.0-1.0,
  "fullAnalysis": "Your detailed analysis (2-3 paragraphs)",
  "nodeIDs": ["list of node IDs (e.g., 'node-12345') that this analysis directly relates to"],
  "timelineEvents": [
    {
      "timestamp": "extracted date/time (e.g. 2026-02-24, 2025, or Unknown)",
      "event": "description of what happened",
      "sourceNodeId": "the EXACT node ID where this event was found"
    }
  ]
}

CRITICAL: The nodeIDs field MUST contain the EXACT node ID strings from the [NodeID: xxx] markers in the input above. Do NOT use titles, entity names, or make up IDs. Use only IDs like: node-1772294753812066795-0
Respond ONLY with the JSON.`, persona.SystemPrompt, findings, persona.Expertise, persona.Perspective, persona.Questions)
}

// PersonaJSONResponse represents the expected JSON structure from persona analysis
type PersonaJSONResponse struct {
	KeyFindings    []string        `json:"keyFindings"`
	Connections    []string        `json:"connections"`
	Questions      []string        `json:"questions"`
	Confidence     float32         `json:"confidence"`
	FullAnalysis   string          `json:"fullAnalysis"`
	NodeIDs        []string        `json:"nodeIDs"` // Which node IDs this persona's insights apply to
	TimelineEvents []TimelineEvent `json:"timelineEvents"`
}
