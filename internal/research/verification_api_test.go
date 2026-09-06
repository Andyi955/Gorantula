package research

import (
	"testing"
)

func TestDecodeJSONToleratesUnknownFields(t *testing.T) {
	type action struct {
		Action  string `json:"action"`
		Details string `json:"details"`
	}
	// A model adds an extra field; the decoder must ignore it, not fail.
	if err := decodeJSON([]byte(`{"action":"call","details":"x","proposition":"unexpected"}`), &action{}); err != nil {
		t.Fatalf("lenient decode rejected unknown field: %v", err)
	}
}
func TestDecodeJSONRejectsMultipleObjects(t *testing.T) {
	type action struct {
		Action string `json:"action"`
	}
	if err := decodeJSON([]byte(`{"action":"call"}{"action":"finish"}`), &action{}); err == nil {
		t.Fatal("lenient decode accepted multiple objects")
	}
}
func TestDecodeJSONRejectsMalformed(t *testing.T) {
	type action struct {
		Action string `json:"action"`
	}
	if err := decodeJSON([]byte(`{"action":`), &action{}); err == nil {
		t.Fatal("lenient decode accepted malformed JSON")
	}
}
