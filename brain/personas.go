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

type PersonaConnectionProposal struct {
	Source          string   `json:"source"`
	Target          string   `json:"target"`
	Tag             string   `json:"tag"`
	Reasoning       string   `json:"reasoning"`
	EvidenceNodeIDs []string `json:"evidenceNodeIDs"`
	Confidence      float32  `json:"confidence"`
}

// PersonaInsight represents the analysis output from a single persona
type PersonaInsight struct {
	PersonaName         string                    `json:"personaName"`
	Perspective         string                    `json:"perspective"`
	KeyFindings         []string                  `json:"keyFindings"`    // List of important discoveries
	Connections         []string                  `json:"connections"`    // Connections this persona sees
	Observations        []string                  `json:"observations"`   // Direct evidence-grounded observations
	Hypotheses          []string                  `json:"hypotheses"`     // Optional inferences that remain grounded
	Questions           []string                  `json:"questions"`      // Follow-up questions raised
	Confidence          float32                   `json:"confidence"`     // 0.0-1.0 confidence score
	FullAnalysis        string                    `json:"fullAnalysis"`   // Full text analysis
	NodeIDs             []string                  `json:"nodeIDs"`        // Node IDs this persona contributed insights to
	TimelineEvents      []TimelineEvent           `json:"timelineEvents"` // Chronological events extracted
	ProposedConnections []PersonaConnectionProposal `json:"proposedConnections"`
}

// GetDefaultPersonas returns a set of distinct personas for multi-agent collaboration
func GetDefaultPersonas() []Persona {
	prefModel := os.Getenv("DEFAULT_PERSONA_MODEL")

	defaultModel := "gemini"
	if prefModel != "" {
		defaultModel = prefModel
	}

	return []Persona{
		{
			Name:         "Skeptic",
			Expertise:    "Critical Analysis",
			Perspective:  "Questions assumptions, identifies gaps, and looks for contradictions in the evidence",
			Questions:    "What doesn't add up? What sources might be unreliable? What information is missing?",
			ModelPref:    defaultModel,
			SystemPrompt: "You are a skeptical analyst. Your role is to find flaws, inconsistencies, and gaps in the evidence. Question every claim. Look for what doesn't add up.",
		},
		{
			Name:         "Connector",
			Expertise:    "Pattern Recognition",
			Perspective:  "Finds hidden links between different pieces of information and identifies overarching themes",
			Questions:    "How do these facts relate? What common threads connect these entities? What patterns emerge?",
			ModelPref:    defaultModel,
			SystemPrompt: "You are a pattern recognition specialist. Your role is to find connections between disparate facts. Look for hidden links, shared themes, and relationships between entities.",
		},
		{
			Name:         "Timeline Analyst",
			Expertise:    "Temporal Analysis",
			Perspective:  "Chronologically orders events, identifies causality, and spots temporal patterns",
			Questions:    "When did this happen? What led to this? What's the sequence of events?",
			ModelPref:    defaultModel,
			SystemPrompt: "You are a timeline specialist. Your role is to order events chronologically, identify cause-and-effect relationships, and spot temporal patterns. Extract ALL events with their corresponding timestamps.",
		},
		{
			Name:         "Entity Hunter",
			Expertise:    "Entity Extraction",
			Perspective:  "Identifies only the exact names of key people, organizations, and locations mentioned",
			Questions:    "Who are the key players? What organizations are involved? Where is this happening?",
			ModelPref:    defaultModel,
			SystemPrompt: "You are a strict entity extraction expert. YOUR ONLY ROLE is to identify the RAW NAMES of key people, organizations, and locations. YOU MUST return ONLY the short exact noun phrases (e.g., 'Elon Musk', 'SpaceX', 'White House'). DO NOT EVER return full sentences, descriptions, or explanations. Each finding MUST strictly be a single entity name of maximum 3-4 words.",
		},
		{
			Name:         "Context Provider",
			Expertise:    "Background Research",
			Perspective:  "Provides historical context, explains jargon, and fills in knowledge gaps",
			Questions:    "What background information is needed? What terms need explanation? What historical context applies?",
			ModelPref:    defaultModel,
			SystemPrompt: "You are a context specialist. Your role is to provide historical background, explain technical terms, and fill in knowledge gaps to help understand the evidence.",
		},
		{
			Name:         "Implications Mapper",
			Expertise:    "Impact Analysis",
			Perspective:  "Evaluates consequences, predicts outcomes, and assesses broader implications",
			Questions:    "What happens next? What are the implications? What could go wrong or right?",
			ModelPref:    defaultModel,
			SystemPrompt: "You are an implications analyst. Your role is to evaluate consequences, predict potential outcomes, and assess the broader implications of the findings.",
		},
		{
			Name:         "Discovery",
			Expertise:    "Breakthrough Detection",
			Perspective:  "Identifies only the most novel, consequential, and strongly supported discoveries hiding across the evidence",
			Questions:    "What conclusion here is genuinely new? Why would it matter if true? Which exact evidence nodes make it compelling enough to act on?",
			ModelPref:    defaultModel,
			SystemPrompt: "You are a breakthrough discovery analyst. Your role is to identify only high-signal discoveries or compelling hypotheses that are strongly grounded in the evidence. Reject generic summaries, obvious restatements, and weak speculation.",
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
  "keyFindings": ["list of short strings answering your prompt. IF you are Entity Hunter, these MUST BE EXACT NOUN ENTITIES ONLY (e.g., 'SpaceX') with no descriptions."],
  "observations": ["direct evidence-grounded observations tied to exact node IDs"],
  "hypotheses": ["optional grounded hypotheses or interpretations; omit weak speculation"],
  "connections": ["connections you identify between facts"],
  "proposedConnections": [
    {
      "source": "exact node id",
      "target": "exact node id",
      "tag": "UPPERCASE_TAG",
      "reasoning": "one sober sentence grounded in evidence",
      "evidenceNodeIDs": ["exact-node-id-1", "exact-node-id-2"],
      "confidence": 0.0
    }
  ],
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
CRITICAL: Every proposed connection MUST use exact source/target node IDs and exact evidenceNodeIDs. If you cannot ground a relationship directly in the evidence, omit it.
CRITICAL: Separate direct observations from hypotheses. Do not frame speculation as fact. Avoid strategic or future-looking claims unless they are explicitly present in the node text.
Respond ONLY with the JSON.`, persona.SystemPrompt, findings, persona.Expertise, persona.Perspective, persona.Questions)
}

// PersonaJSONResponse represents the expected JSON structure from persona analysis
type PersonaJSONResponse struct {
	KeyFindings         []string                  `json:"keyFindings"`
	Observations        []string                  `json:"observations"`
	Hypotheses          []string                  `json:"hypotheses"`
	Connections         []string                  `json:"connections"`
	ProposedConnections []PersonaConnectionProposal `json:"proposedConnections"`
	Questions           []string                  `json:"questions"`
	Confidence          float32                   `json:"confidence"`
	FullAnalysis        string                    `json:"fullAnalysis"`
	NodeIDs             []string                  `json:"nodeIDs"` // Which node IDs this persona's insights apply to
	TimelineEvents      []TimelineEvent           `json:"timelineEvents"`
}
