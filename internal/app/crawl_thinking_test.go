package app

import "testing"

func TestExtractThinkingPreference(t *testing.T) {
	tests := []struct {
		name string
		msg  map[string]interface{}
		want string
	}{
		{name: "missing key", msg: map[string]interface{}{}, want: ""},
		{name: "enabled", msg: map[string]interface{}{"deepReasoning": true}, want: "low"},
		{name: "disabled", msg: map[string]interface{}{"deepReasoning": false}, want: ""},
		{name: "non-bool ignored", msg: map[string]interface{}{"deepReasoning": "true"}, want: ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := extractThinkingPreference(test.msg); got != test.want {
				t.Fatalf("extractThinkingPreference() = %q, want %q", got, test.want)
			}
		})
	}
}
