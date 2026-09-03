package brain

import (
	"os"
	"strings"
	"testing"
)

func TestGetDefaultPersonas(t *testing.T) {
	personas := GetDefaultPersonas()

	expectedCount := 7
	if len(personas) != expectedCount {
		t.Errorf("GetDefaultPersonas() returned %d personas; want %d", len(personas), expectedCount)
	}

	// Verify unique names
	names := make(map[string]bool)
	for _, p := range personas {
		if names[p.Name] {
			t.Errorf("Duplicate persona name found: %s", p.Name)
		}
		names[p.Name] = true

		if p.Name == "" || p.Expertise == "" || p.Perspective == "" || p.SystemPrompt == "" {
			t.Errorf("Persona %s has empty required fields", p.Name)
		}
	}
}

func TestGetDefaultPersonasUsesConfiguredProvider(t *testing.T) {
	original := os.Getenv("DEFAULT_PERSONA_MODEL")
	t.Cleanup(func() {
		if original == "" {
			os.Unsetenv("DEFAULT_PERSONA_MODEL")
			return
		}
		os.Setenv("DEFAULT_PERSONA_MODEL", original)
	})

	os.Setenv("DEFAULT_PERSONA_MODEL", "deepseek")

	personas := GetDefaultPersonas()
	for _, persona := range personas {
		if persona.ModelPref != "deepseek" {
			t.Fatalf("expected persona %s to use deepseek, got %s", persona.Name, persona.ModelPref)
		}
	}
}

func TestGetDefaultPersonasUsesDeepSeekByDefault(t *testing.T) {
	original := os.Getenv("DEFAULT_PERSONA_MODEL")
	t.Cleanup(func() {
		if original == "" {
			os.Unsetenv("DEFAULT_PERSONA_MODEL")
			return
		}
		os.Setenv("DEFAULT_PERSONA_MODEL", original)
	})

	os.Unsetenv("DEFAULT_PERSONA_MODEL")

	personas := GetDefaultPersonas()
	for _, persona := range personas {
		if persona.ModelPref != "deepseek" {
			t.Fatalf("expected persona %s to default to deepseek, got %s", persona.Name, persona.ModelPref)
		}
	}
}

func TestBuildPersonaPrompt(t *testing.T) {
	persona := Persona{
		Name:         "Tester",
		Expertise:    "Testing",
		Perspective:  "Testing things",
		Questions:    "Does it work?",
		SystemPrompt: "You are a tester.",
	}
	findings := "[NodeID: node-1]\nSource: https://example.com\nTitle: Ground Truth\nSummary: Ground truth summary.\nFull Text Excerpt: Ground truth detail."

	prompt := BuildPersonaPrompt(persona, findings)

	tests := []struct {
		name     string
		contains string
	}{
		{"Contains System Prompt", "You are a tester."},
		{"Contains Findings", "Full Text Excerpt: Ground truth detail."},
		{"Contains Expertise", "Testing"},
		{"Contains Perspective", "Testing things"},
		{"Contains Questions", "Does it work?"},
		{"Contains Summary First Guidance", "Treat omitted text as unavailable evidence rather than implied support"},
		{"Contains JSON Structure hint", "\"keyFindings\": [\"list of short strings answering your assigned role's prompt."},
		{"Contains Exact Node ID Rule", "CRITICAL: The nodeIDs field MUST contain the EXACT node ID strings"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !strings.Contains(prompt, tt.contains) {
				t.Errorf("BuildPersonaPrompt() prompt does not contain %q", tt.contains)
			}
		})
	}
}

func TestBuildIncrementalPersonaPrompt(t *testing.T) {
	persona := Persona{
		Name:         "Tester",
		Expertise:    "Testing",
		Perspective:  "Testing things",
		Questions:    "Does it work?",
		SystemPrompt: "You are a tester.",
	}

	prompt := BuildIncrementalPersonaPrompt(
		persona,
		"[NodeID: node-new]\nTitle: New Lead\nSummary: Fresh intel\nFull Text: Fresh intel full text",
		"[ContextNodeID: node-old]\nTitle: Existing Lead\nSummary: Existing summary",
		[]string{"node-new"},
	)

	tests := []struct {
		name     string
		contains string
	}{
		{"Contains Pending Header", "PENDING NODE IDS:"},
		{"Contains Pending ID", "node-new"},
		{"Contains Full Detail Section", "NEW EVIDENCE (full detail):"},
		{"Contains Compact Context Section", "EXISTING BOARD CONTEXT (compact summaries only):"},
		{"Contains Pending Constraint", "Every proposed connection MUST include at least one node from the pending node ID list."},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !strings.Contains(prompt, tt.contains) {
				t.Errorf("BuildIncrementalPersonaPrompt() prompt does not contain %q", tt.contains)
			}
		})
	}
}

func TestPersonaConnectionsToleratesObjectArray(t *testing.T) {
	// The exact shape the Skeptic kept returning: connection objects where
	// the schema asks for plain strings. Previously this hard-failed the
	// whole persona ("cannot unmarshal object into ... of type string").
	payload := `{
		"keyFindings": ["cost claims conflict"],
		"connections": [
			{"source": "node-1", "target": "node-2", "tag": "COST_CLAIM_CONFLICT", "reasoning": "claims disagree on cost."},
			{"reasoning": "second note without ids"},
			"a plain string",
			""
		]
	}`

	var response PersonaJSONResponse
	if err := parseJSONResponse(payload, &response); err != nil {
		t.Fatalf("expected object-shaped connections to parse, got error: %v", err)
	}

	want := []string{
		"node-1 -> node-2 [COST_CLAIM_CONFLICT]: claims disagree on cost.",
		"second note without ids",
		"a plain string",
	}
	if len(response.Connections) != len(want) {
		t.Fatalf("expected %d flattened connections, got %d: %v", len(want), len(response.Connections), response.Connections)
	}
	for i, expected := range want {
		if response.Connections[i] != expected {
			t.Fatalf("connection %d: expected %q, got %q", i, expected, response.Connections[i])
		}
	}
	if response.KeyFindings == nil || response.KeyFindings[0] != "cost claims conflict" {
		t.Fatalf("expected sibling fields to parse normally, got %v", response.KeyFindings)
	}
}

func TestPersonaConnectionsToleratesStringAndNull(t *testing.T) {
	var fromString PersonaJSONResponse
	if err := parseJSONResponse(`{"connections": "one summary"}`, &fromString); err != nil {
		t.Fatalf("expected bare string connections to parse, got error: %v", err)
	}
	if len(fromString.Connections) != 1 || fromString.Connections[0] != "one summary" {
		t.Fatalf("expected [one summary], got %v", fromString.Connections)
	}

	var fromNull PersonaJSONResponse
	if err := parseJSONResponse(`{"connections": null}`, &fromNull); err != nil {
		t.Fatalf("expected null connections to parse, got error: %v", err)
	}
	if len(fromNull.Connections) != 0 {
		t.Fatalf("expected no connections from null, got %v", fromNull.Connections)
	}

	var fromObject PersonaJSONResponse
	if err := parseJSONResponse(`{"connections": {"source": "a", "target": "b", "reasoning": "same event"}}`, &fromObject); err != nil {
		t.Fatalf("expected single object connections to parse, got error: %v", err)
	}
	if len(fromObject.Connections) != 1 || fromObject.Connections[0] != "a -> b: same event" {
		t.Fatalf("expected flattened single object, got %v", fromObject.Connections)
	}
}

func TestPersonaJSONResponseSkepticSchemaDriftEndToEnd(t *testing.T) {
	// Full payload in the drifted shape, through the same parse path the
	// provider uses, to prove the Skeptic recovers instead of failing.
	payload := `{
		"keyFindings": ["duplicate funding figures"],
		"observations": ["two sources cite different rounds"],
		"hypotheses": [],
		"connections": [
			{"source": "node-9", "target": "node-4", "tag": "COST_CLAIM_CONFLICT", "reasoning": "figures conflict", "confidence": 0.7}
		],
		"proposedConnections": [
			{"source": "node-9", "target": "node-4", "tag": "COST_CLAIM_CONFLICT", "reasoning": "figures conflict", "confidence": 0.7}
		],
		"questions": ["which figure is verified?"],
		"confidence": 0.8,
		"fullAnalysis": "Found a discrepancy.",
		"nodeIDs": ["node-9", "node-4"]
	}`

	var response PersonaJSONResponse
	if err := parseJSONResponse(payload, &response); err != nil {
		t.Fatalf("expected drifted schema to parse, got error: %v", err)
	}
	if response.Confidence != 0.8 {
		t.Fatalf("expected confidence 0.8, got %v", response.Confidence)
	}
	if len(response.ProposedConnections) != 1 || response.ProposedConnections[0].Tag != "COST_CLAIM_CONFLICT" {
		t.Fatalf("expected proposedConnections to parse, got %v", response.ProposedConnections)
	}
	if len(response.Connections) != 1 || response.Connections[0] != "node-9 -> node-4 [COST_CLAIM_CONFLICT]: figures conflict" {
		t.Fatalf("expected flattened connections, got %v", response.Connections)
	}
}
