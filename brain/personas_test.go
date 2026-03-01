package brain

import (
	"strings"
	"testing"
)

func TestGetDefaultPersonas(t *testing.T) {
	personas := GetDefaultPersonas()

	expectedCount := 6
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

func TestBuildPersonaPrompt(t *testing.T) {
	persona := Persona{
		Name:         "Tester",
		Expertise:    "Testing",
		Perspective:  "Testing things",
		Questions:    "Does it work?",
		SystemPrompt: "You are a tester.",
	}
	findings := "Ground truth findings."

	prompt := BuildPersonaPrompt(persona, findings)

	tests := []struct {
		name     string
		contains string
	}{
		{"Contains System Prompt", "You are a tester."},
		{"Contains Findings", "Ground truth findings."},
		{"Contains Expertise", "Testing"},
		{"Contains Perspective", "Testing things"},
		{"Contains Questions", "Does it work?"},
		{"Contains JSON Structure hint", "\"keyFindings\": [\"list of important discoveries\"]"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !strings.Contains(prompt, tt.contains) {
				t.Errorf("BuildPersonaPrompt() prompt does not contain %q", tt.contains)
			}
		})
	}
}
