package brain

import (
	"fmt"
	"os"
	"regexp"
	"strings"
)

type PersonaConnectionPolicy string

const (
	PersonaConnectionPolicySupportOnly PersonaConnectionPolicy = "support_only"
	PersonaConnectionPolicyConnector   PersonaConnectionPolicy = "connector"
	PersonaConnectionPolicyTemporal    PersonaConnectionPolicy = "temporal"
	PersonaConnectionPolicySkeptic     PersonaConnectionPolicy = "skeptic"
)

const (
	personaDefaultKeyFindingLimit       = 8
	personaEntityKeyFindingLimit        = 20
	personaQuestionLimit                = 5
	personaConnectionStringLimit        = 6
	personaTimelineEventLimit           = 12
	personaDefaultProposalLimit         = 5
	personaTimelineProposalLimit        = 4
	personaSkepticProposalLimit         = 4
	personaFullAnalysisRuneLimit        = 700
	personaEvidenceNodeIDReferenceLimit = 6
)

var personaPromptNodeIDPattern = regexp.MustCompile(`\[(?:NodeID|ContextNodeID):\s*([^\]\s]+)\]`)

// Persona represents an AI agent with a specific perspective for analyzing investigation findings
type Persona struct {
	Name             string                  `json:"name"`
	Expertise        string                  `json:"expertise"`        // Area of focus (e.g., "timeline analysis", "entity extraction")
	Perspective      string                  `json:"perspective"`      // How they approach analysis
	Questions        string                  `json:"questions"`        // Questions they specifically ask
	ModelPref        string                  `json:"modelPref"`        // Preferred provider route ID (for example gemini, openai, deepseek)
	SystemPrompt     string                  `json:"systemPrompt"`     // Custom system instructions for this persona
	ConnectionPolicy PersonaConnectionPolicy `json:"connectionPolicy"` // Whether and how this persona may propose relationships
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
	PersonaName         string                      `json:"personaName"`
	Perspective         string                      `json:"perspective"`
	KeyFindings         []string                    `json:"keyFindings"`    // List of important discoveries
	Connections         []string                    `json:"connections"`    // Connections this persona sees
	Observations        []string                    `json:"observations"`   // Direct evidence-grounded observations
	Hypotheses          []string                    `json:"hypotheses"`     // Optional inferences that remain grounded
	Questions           []string                    `json:"questions"`      // Follow-up questions raised
	Confidence          float32                     `json:"confidence"`     // 0.0-1.0 confidence score
	FullAnalysis        string                      `json:"fullAnalysis"`   // Full text analysis
	NodeIDs             []string                    `json:"nodeIDs"`        // Node IDs this persona contributed insights to
	TimelineEvents      []TimelineEvent             `json:"timelineEvents"` // Chronological events extracted
	ProposedConnections []PersonaConnectionProposal `json:"proposedConnections"`
}

// GetDefaultPersonas returns a set of distinct personas for multi-agent collaboration
func GetDefaultPersonas() []Persona {
	prefModel := os.Getenv("DEFAULT_PERSONA_MODEL")

	defaultModel := "deepseek"
	if prefModel != "" {
		defaultModel = prefModel
	}

	return []Persona{
		{
			Name:             "Skeptic",
			Expertise:        "Critical Analysis",
			Perspective:      "Questions assumptions, identifies gaps, duplicate evidence, contradictions, and weak sourcing",
			Questions:        "What doesn't add up? Which claims conflict, duplicate each other, or lack support?",
			ModelPref:        defaultModel,
			ConnectionPolicy: PersonaConnectionPolicySkeptic,
			SystemPrompt:     "You are a skeptical evidence auditor. Find contradictions, duplicate content, inconsistent numbers, weak sourcing, and unsupported claims. Only propose relationships when they identify duplicate content, contradictions, inconsistencies, or corroboration.",
		},
		{
			Name:             "Connector",
			Expertise:        "Relationship Mapping",
			Perspective:      "Finds direct, evidence-grounded relationships between board nodes without forcing weak thematic links",
			Questions:        "Which exact nodes have a direct relationship? What evidence supports the link? What concise tag describes it?",
			ModelPref:        defaultModel,
			ConnectionPolicy: PersonaConnectionPolicyConnector,
			SystemPrompt:     "You are the primary relationship mapper. Your role is to propose only direct, evidence-grounded board relationships using exact node IDs. Prefer literal relationships over broad themes.",
		},
		{
			Name:             "Timeline Analyst",
			Expertise:        "Temporal Analysis",
			Perspective:      "Chronologically orders explicit dated events and distinguishes sequence from causality",
			Questions:        "When did this happen? Which dates are explicit? Which events clearly precede or follow others?",
			ModelPref:        defaultModel,
			ConnectionPolicy: PersonaConnectionPolicyTemporal,
			SystemPrompt:     "You are a timeline specialist. Extract explicit dated events and sequence information. Only propose relationships for clear temporal ordering, same event windows, or timeline discrepancies supported by the evidence.",
		},
		{
			Name:             "Entity Mapper",
			Expertise:        "Entity Mapping",
			Perspective:      "Identifies only the exact names of key people, organizations, products, locations, and sources mentioned",
			Questions:        "Which exact entities are repeatedly or centrally mentioned?",
			ModelPref:        defaultModel,
			ConnectionPolicy: PersonaConnectionPolicySupportOnly,
			SystemPrompt:     "You are a strict entity mapping specialist. Return exact entity names only in keyFindings: people, organizations, products, locations, and sources. Do not write sentences or create relationships.",
		},
		{
			Name:             "Context Brief",
			Expertise:        "Background Context",
			Perspective:      "Explains terms, institutions, and historical context needed to read the evidence without adding unsupported facts",
			Questions:        "What terms need explanation? What background makes the evidence easier to interpret?",
			ModelPref:        defaultModel,
			ConnectionPolicy: PersonaConnectionPolicySupportOnly,
			SystemPrompt:     "You are a context brief writer. Explain jargon and background only when grounded in the evidence shown. Do not propose board relationships.",
		},
		{
			Name:             "Implications Mapper",
			Expertise:        "Impact Analysis",
			Perspective:      "Maps evidence-grounded consequences and risks without turning implications into board edges",
			Questions:        "What practical consequences are directly supported? What risks are plausible but still uncertain?",
			ModelPref:        defaultModel,
			ConnectionPolicy: PersonaConnectionPolicySupportOnly,
			SystemPrompt:     "You are an implications analyst. Identify grounded consequences, risks, and downstream questions. Keep implications proportional to the evidence and do not propose board relationships.",
		},
		{
			Name:             "Evidence Triage",
			Expertise:        "Evidence Prioritization",
			Perspective:      "Identifies the strongest, most concrete findings and separates them from generic restatements",
			Questions:        "Which findings are strongest? Which exact nodes support them? Which claims should the board prioritize?",
			ModelPref:        defaultModel,
			ConnectionPolicy: PersonaConnectionPolicySupportOnly,
			SystemPrompt:     "You are an evidence triage analyst. Select only high-signal, strongly supported findings and note their node IDs. Reject generic summaries, obvious restatements, and weak speculation. Do not propose board relationships.",
		},
	}
}

// BuildPersonaPrompt creates a prompt for a specific persona to analyze the given findings
func BuildPersonaPrompt(persona Persona, findings string) string {
	connectionsSchema, proposedConnectionsSchema := personaRelationshipJSONSchema(persona)
	return fmt.Sprintf(`%s

You are analyzing the following investigation findings:

---

%s

---

These findings are summary-first. Some nodes may include a bounded "Full Text Excerpt" instead of the complete source body.
Treat omitted text as unavailable evidence rather than implied support, and work only from the material shown.

Your expertise: %s
Your perspective: %s

Specifically, consider these questions:
%s

Relationship output policy:
%s

Provide your analysis in JSON format with the following structure:
{
  "keyFindings": ["list of short strings answering your prompt. IF you are Entity Mapper, these MUST BE EXACT NOUN ENTITIES ONLY (e.g., 'SpaceX') with no descriptions."],
  "observations": ["direct evidence-grounded observations tied to exact node IDs"],
  "hypotheses": ["optional grounded hypotheses or interpretations; omit weak speculation"],
  "connections": %s,
  "proposedConnections": %s,
  "questions": ["follow-up questions this raises"],
  "confidence": 0.0-1.0,
  "fullAnalysis": "Short grounded summary, maximum 5 sentences",
  "nodeIDs": ["list of node IDs (e.g., 'node-12345') that this analysis directly relates to"],
  "timelineEvents": [
    {
      "timestamp": "extracted date/time (e.g. 2026-02-24, 2025, or Unknown)",
      "event": "description of what happened",
      "sourceNodeId": "the EXACT node ID where this event was found"
    }
  ]
}

Connection object shape, only when the relationship output policy allows proposals:
[
    {
      "source": "exact node id",
      "target": "exact node id",
      "tag": "CONTENT_SPECIFIC_UPPERCASE_TAG",
      "reasoning": "one sober sentence grounded in evidence",
      "evidenceNodeIDs": ["exact-node-id-1", "exact-node-id-2"],
      "confidence": 0.0
    }
]

CRITICAL: The nodeIDs field MUST contain the EXACT node ID strings from the [NodeID: xxx] markers in the input above. Do NOT use titles, entity names, or make up IDs. Use only IDs like: node-1772294753812066795-0
CRITICAL: Every proposed connection MUST use exact source/target node IDs and exact evidenceNodeIDs. If you cannot ground a relationship directly in the evidence, omit it.
CRITICAL: Separate direct observations from hypotheses. Do not frame speculation as fact. Avoid strategic or future-looking claims unless they are explicitly present in the node text.
Respond ONLY with the JSON.`, persona.SystemPrompt, findings, persona.Expertise, persona.Perspective, persona.Questions, personaRelationshipPromptPolicy(persona), connectionsSchema, proposedConnectionsSchema)
}

func BuildIncrementalPersonaPrompt(persona Persona, pendingFindings string, contextFindings string, pendingNodeIDs []string) string {
	connectionsSchema, proposedConnectionsSchema := personaRelationshipJSONSchema(persona)
	return fmt.Sprintf(`%s

You are analyzing new evidence that must be integrated into an existing investigation board.

PENDING NODE IDS:
%s

NEW EVIDENCE (full detail):
---
%s
---

EXISTING BOARD CONTEXT (compact summaries only):
---
%s
---

Your expertise: %s
Your perspective: %s

Specifically, consider these questions:
%s

Relationship output policy:
%s

Provide your analysis in JSON format with the following structure:
{
  "keyFindings": ["list of short strings answering your prompt. IF you are Entity Mapper, these MUST BE EXACT NOUN ENTITIES ONLY (e.g., 'SpaceX') with no descriptions."],
  "observations": ["direct evidence-grounded observations tied to exact node IDs"],
  "hypotheses": ["optional grounded hypotheses or interpretations; omit weak speculation"],
  "connections": %s,
  "proposedConnections": %s,
  "questions": ["follow-up questions this raises"],
  "confidence": 0.0-1.0,
  "fullAnalysis": "Short grounded summary, maximum 5 sentences",
  "nodeIDs": ["list of node IDs (e.g., 'node-12345') that this analysis directly relates to"],
  "timelineEvents": [
    {
      "timestamp": "extracted date/time (e.g. 2026-02-24, 2025, or Unknown)",
      "event": "description of what happened",
      "sourceNodeId": "the EXACT node ID where this event was found"
    }
  ]
}

Connection object shape, only when the relationship output policy allows proposals:
[
    {
      "source": "exact node id",
      "target": "exact node id",
      "tag": "UPPERCASE_TAG",
      "reasoning": "one sober sentence grounded in evidence",
      "evidenceNodeIDs": ["exact-node-id-1", "exact-node-id-2"],
      "confidence": 0.0
    }
]

CRITICAL: Every proposed connection MUST include at least one node from the pending node ID list.
CRITICAL: Focus on relationships between pending nodes and the existing board, plus pending-to-pending links.
CRITICAL: The nodeIDs field MUST contain the EXACT node ID strings from the input above. Do NOT use titles, entity names, or make up IDs.
CRITICAL: Every proposed connection MUST use exact source/target node IDs and exact evidenceNodeIDs. If you cannot ground a relationship directly in the evidence, omit it.
CRITICAL: Separate direct observations from hypotheses. Do not frame speculation as fact. Avoid strategic or future-looking claims unless they are explicitly present in the node text.
Respond ONLY with the JSON.`, persona.SystemPrompt, strings.Join(pendingNodeIDs, ", "), pendingFindings, contextFindings, persona.Expertise, persona.Perspective, persona.Questions, personaRelationshipPromptPolicy(persona), connectionsSchema, proposedConnectionsSchema)
}

// PersonaJSONResponse represents the expected JSON structure from persona analysis
type PersonaJSONResponse struct {
	KeyFindings         []string                    `json:"keyFindings"`
	Observations        []string                    `json:"observations"`
	Hypotheses          []string                    `json:"hypotheses"`
	Connections         []string                    `json:"connections"`
	ProposedConnections []PersonaConnectionProposal `json:"proposedConnections"`
	Questions           []string                    `json:"questions"`
	Confidence          float32                     `json:"confidence"`
	FullAnalysis        string                      `json:"fullAnalysis"`
	NodeIDs             []string                    `json:"nodeIDs"` // Which node IDs this persona's insights apply to
	TimelineEvents      []TimelineEvent             `json:"timelineEvents"`
}

func (p Persona) EffectiveConnectionPolicy() PersonaConnectionPolicy {
	if p.ConnectionPolicy != "" {
		return p.ConnectionPolicy
	}
	return personaConnectionPolicyForName(p.Name)
}

func personaConnectionPolicyForName(name string) PersonaConnectionPolicy {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "connector":
		return PersonaConnectionPolicyConnector
	case "timeline analyst":
		return PersonaConnectionPolicyTemporal
	case "skeptic":
		return PersonaConnectionPolicySkeptic
	case "entity mapper", "entity hunter", "context brief", "context provider", "implications mapper", "evidence triage", "discovery":
		return PersonaConnectionPolicySupportOnly
	default:
		return PersonaConnectionPolicySupportOnly
	}
}

func personaRelationshipJSONSchema(persona Persona) (string, string) {
	if persona.EffectiveConnectionPolicy() == PersonaConnectionPolicySupportOnly {
		return "[]", "[]"
	}
	return `["short text summaries of allowed relationships"]`, `[
    {
      "source": "exact node id",
      "target": "exact node id",
      "tag": "UPPERCASE_TAG",
      "reasoning": "one sober sentence grounded in evidence",
      "evidenceNodeIDs": ["exact-node-id-1", "exact-node-id-2"],
      "confidence": 0.0
    }
  ]`
}

func personaRelationshipPromptPolicy(persona Persona) string {
	switch persona.EffectiveConnectionPolicy() {
	case PersonaConnectionPolicyConnector:
		return "Connector is the primary relationship proposer. You may fill connections and proposedConnections, but only for direct, evidence-grounded node relationships using exact node IDs. " + relationshipSpecificTagInstruction
	case PersonaConnectionPolicyTemporal:
		return "Timeline Analyst may fill connections and proposedConnections only for explicit temporal relationships. Use content-specific temporal tags such as CONTRACT_PRECEDES_LAUNCH or GBT_MILESTONE_DUPLICATE, not PRECEDES, FOLLOWS, TIMELINE_SEQUENCE, or SAME_EVENT_WINDOW. Do not infer broad causality from chronology. " + relationshipSpecificTagInstruction
	case PersonaConnectionPolicySkeptic:
		return "Skeptic may fill connections and proposedConnections only for duplicate, contradiction, inconsistency, discrepancy, conflict, or corroboration findings. Use content-specific skeptic tags such as COST_CLAIM_CONFLICT or GBT_MILESTONE_DUPLICATE, not DUPLICATE_CONTENT, CONTRADICTS, INCONSISTENCY, DISCREPANCY, CONFLICTS_WITH, or CORROBORATES. " + relationshipSpecificTagInstruction
	default:
		return "This persona is support-only. Put useful work in keyFindings, observations, hypotheses, questions, or timelineEvents. You MUST return empty relationship fields: \"connections\": [] and \"proposedConnections\": []."
	}
}

func buildPersonaInsight(persona Persona, prompt string, response PersonaJSONResponse) PersonaInsight {
	insight := PersonaInsight{
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
	}
	return applyPersonaOutputPolicy(persona, prompt, insight)
}

func applyPersonaOutputPolicy(persona Persona, prompt string, insight PersonaInsight) PersonaInsight {
	insight.KeyFindings = capPersonaKeyFindings(persona, insight.KeyFindings)
	insight.Observations = capStringSliceUnique(insight.Observations, personaDefaultKeyFindingLimit)
	insight.Hypotheses = capStringSliceUnique(insight.Hypotheses, personaDefaultKeyFindingLimit)
	insight.Questions = capStringSliceUnique(insight.Questions, personaQuestionLimit)
	insight.NodeIDs = filterKnownPersonaNodeIDs(insight.NodeIDs, extractPersonaPromptNodeIDSet(prompt))
	insight.TimelineEvents = capTimelineEvents(filterKnownTimelineEvents(insight.TimelineEvents, extractPersonaPromptNodeIDSet(prompt)), personaTimelineEventLimit)
	insight.FullAnalysis = capRunes(strings.TrimSpace(insight.FullAnalysis), personaFullAnalysisRuneLimit)

	if persona.EffectiveConnectionPolicy() == PersonaConnectionPolicySupportOnly {
		insight.Connections = nil
		insight.ProposedConnections = nil
		return insight
	}

	insight.Connections = capStringSliceUnique(insight.Connections, personaConnectionStringLimit)
	insight.ProposedConnections = filterPersonaConnectionProposals(persona, prompt, insight.ProposedConnections)
	return insight
}

func capPersonaKeyFindings(persona Persona, values []string) []string {
	limit := personaDefaultKeyFindingLimit
	if strings.EqualFold(strings.TrimSpace(persona.Name), "Entity Mapper") || strings.EqualFold(strings.TrimSpace(persona.Name), "Entity Hunter") {
		limit = personaEntityKeyFindingLimit
		return capEntityKeyFindings(values, limit)
	}
	return capStringSliceUnique(values, limit)
}

func capEntityKeyFindings(values []string, limit int) []string {
	result := make([]string, 0, limit)
	seen := make(map[string]struct{})
	for _, value := range values {
		value = strings.TrimSpace(strings.Trim(value, "-•* \t\r\n"))
		if value == "" || len(strings.Fields(value)) > 5 {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
		if len(result) >= limit {
			break
		}
	}
	return result
}

func capStringSliceUnique(values []string, limit int) []string {
	if limit <= 0 {
		return nil
	}
	result := make([]string, 0, minInt(len(values), limit))
	seen := make(map[string]struct{})
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
		if len(result) >= limit {
			break
		}
	}
	return result
}

func capRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return strings.TrimSpace(string(runes[:limit]))
}

func extractPersonaPromptNodeIDSet(prompt string) map[string]struct{} {
	matches := personaPromptNodeIDPattern.FindAllStringSubmatch(prompt, -1)
	if len(matches) == 0 {
		return nil
	}
	nodeIDs := make(map[string]struct{}, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		nodeID := strings.TrimSpace(match[1])
		if nodeID == "" {
			continue
		}
		nodeIDs[nodeID] = struct{}{}
	}
	return nodeIDs
}

func filterKnownPersonaNodeIDs(values []string, validNodeIDs map[string]struct{}) []string {
	if len(validNodeIDs) == 0 {
		return capStringSliceUnique(values, personaDefaultKeyFindingLimit)
	}
	result := make([]string, 0, minInt(len(values), personaDefaultKeyFindingLimit))
	seen := make(map[string]struct{})
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := validNodeIDs[value]; !ok {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
		if len(result) >= personaDefaultKeyFindingLimit {
			break
		}
	}
	return result
}

func filterKnownTimelineEvents(events []TimelineEvent, validNodeIDs map[string]struct{}) []TimelineEvent {
	if len(validNodeIDs) == 0 {
		return events
	}
	filtered := make([]TimelineEvent, 0, len(events))
	for _, event := range events {
		event.SourceNodeID = strings.TrimSpace(event.SourceNodeID)
		if event.SourceNodeID == "" {
			continue
		}
		if _, ok := validNodeIDs[event.SourceNodeID]; !ok {
			continue
		}
		event.Timestamp = strings.TrimSpace(event.Timestamp)
		event.Event = strings.TrimSpace(event.Event)
		if event.Event == "" {
			continue
		}
		filtered = append(filtered, event)
	}
	return filtered
}

func capTimelineEvents(events []TimelineEvent, limit int) []TimelineEvent {
	if len(events) <= limit {
		return events
	}
	return append([]TimelineEvent(nil), events[:limit]...)
}

func filterPersonaConnectionProposals(persona Persona, prompt string, proposals []PersonaConnectionProposal) []PersonaConnectionProposal {
	limit := personaProposalLimit(persona)
	if limit <= 0 {
		return nil
	}
	validNodeIDs := extractPersonaPromptNodeIDSet(prompt)
	filtered := make([]PersonaConnectionProposal, 0, minInt(len(proposals), limit))
	seen := make(map[string]struct{})
	for _, proposal := range proposals {
		proposal.Source = strings.TrimSpace(proposal.Source)
		proposal.Target = strings.TrimSpace(proposal.Target)
		proposal.Tag = SanitizeTag(proposal.Tag)
		proposal.Reasoning = strings.TrimSpace(proposal.Reasoning)
		if proposal.Source == "" || proposal.Target == "" || proposal.Source == proposal.Target || proposal.Reasoning == "" {
			continue
		}
		if !personaAllowsProposalTag(persona.EffectiveConnectionPolicy(), proposal.Tag) {
			continue
		}
		if len(validNodeIDs) > 0 {
			if _, ok := validNodeIDs[proposal.Source]; !ok {
				continue
			}
			if _, ok := validNodeIDs[proposal.Target]; !ok {
				continue
			}
			if !allEvidenceNodeIDsKnown(proposal.EvidenceNodeIDs, validNodeIDs) {
				continue
			}
		}
		proposal.EvidenceNodeIDs = capStringSliceUnique(proposal.EvidenceNodeIDs, personaEvidenceNodeIDReferenceLimit)
		key := strings.ToLower(proposal.Source + "|" + proposal.Target + "|" + proposal.Tag)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		filtered = append(filtered, proposal)
		if len(filtered) >= limit {
			break
		}
	}
	return filtered
}

func allEvidenceNodeIDsKnown(evidenceNodeIDs []string, validNodeIDs map[string]struct{}) bool {
	for _, nodeID := range evidenceNodeIDs {
		nodeID = strings.TrimSpace(nodeID)
		if nodeID == "" {
			continue
		}
		if _, ok := validNodeIDs[nodeID]; !ok {
			return false
		}
	}
	return true
}

func personaProposalLimit(persona Persona) int {
	switch persona.EffectiveConnectionPolicy() {
	case PersonaConnectionPolicyConnector:
		return personaDefaultProposalLimit
	case PersonaConnectionPolicyTemporal:
		return personaTimelineProposalLimit
	case PersonaConnectionPolicySkeptic:
		return personaSkepticProposalLimit
	default:
		return 0
	}
}

func personaAllowsProposalTag(policy PersonaConnectionPolicy, tag string) bool {
	tag = strings.ToUpper(strings.TrimSpace(tag))
	if tag == "" || isCategoryOnlyRelationshipTag(tag) {
		return false
	}
	switch policy {
	case PersonaConnectionPolicyConnector:
		return true
	case PersonaConnectionPolicyTemporal:
		return strings.Contains(tag, "TIME") ||
			strings.Contains(tag, "TEMPORAL") ||
			strings.Contains(tag, "SEQUENCE") ||
			strings.Contains(tag, "PRECEDES") ||
			strings.Contains(tag, "FOLLOWS") ||
			strings.Contains(tag, "SAME_EVENT")
	case PersonaConnectionPolicySkeptic:
		return strings.Contains(tag, "DUPLICATE") ||
			strings.Contains(tag, "DUPLICATES") ||
			strings.Contains(tag, "CONTRADICT") ||
			strings.Contains(tag, "INCONSIST") ||
			strings.Contains(tag, "CORROBORAT") ||
			strings.Contains(tag, "DISCREPANCY") ||
			strings.Contains(tag, "CONFLICT")
	default:
		return false
	}
}
