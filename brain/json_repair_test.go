package brain

import (
	"encoding/json"
	"testing"
)

func TestParseJSONResponseRepairsRawControlCharacters(t *testing.T) {
	// A model emitting a literal newline inside a JSON string is invalid JSON;
	// the parser must repair it rather than discard the whole turn.
	content := "{\"action\":\"finish\",\"interpretation\":\"What we found:\nline two\tvalue\r\nline three\"}"
	var out struct {
		Action         string `json:"action"`
		Interpretation string `json:"interpretation"`
	}
	if err := parseJSONResponse(content, &out); err != nil {
		t.Fatalf("parseJSONResponse: %v", err)
	}
	if out.Action != "finish" {
		t.Errorf("action = %q", out.Action)
	}
	if out.Interpretation != "What we found:\nline two\tvalue\r\nline three" {
		t.Errorf("interpretation = %q", out.Interpretation)
	}
}

func TestEscapeRawJSONControlCharsLeavesValidJSONAlone(t *testing.T) {
	valid := `{"summary":"one\ntwo","concerns":["a","b"]}`
	if got := escapeRawJSONControlChars(valid); got != valid {
		t.Errorf("already-escaped content changed: %q", got)
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(escapeRawJSONControlChars(valid)), &out); err != nil {
		t.Fatalf("variant must stay valid JSON: %v", err)
	}
}
