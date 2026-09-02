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
