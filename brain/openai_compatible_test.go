package brain

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAICompatibleProvider_GenerateContent(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-api-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var reqBody map[string]interface{}
		json.NewDecoder(r.Body).Decode(&reqBody)

		if reqBody["model"] != "test-model" {
			t.Errorf("Expected model 'test-model', got %v", reqBody["model"])
		}

		resp := map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"message": map[string]interface{}{
						"content": "This is a mock response",
					},
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer mockServer.Close()

	provider := &OpenAICompatibleProvider{
		NameID:     "test",
		APIKey:     "test-api-key",
		BaseURL:    mockServer.URL,
		Model:      "test-model",
		HTTPClient: mockServer.Client(),
	}

	ctx := context.Background()
	result, err := provider.GenerateContent(ctx, "Hello")

	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if result != "This is a mock response" {
		t.Errorf("Expected 'This is a mock response', got '%s'", result)
	}
}

func TestOpenAICompatibleProvider_GenerateJSON(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"message": map[string]interface{}{
						"content": "```json\n{\"key\": \"value\"}\n```",
					},
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer mockServer.Close()

	provider := &OpenAICompatibleProvider{
		NameID:     "test",
		APIKey:     "test-api-key",
		BaseURL:    mockServer.URL,
		Model:      "test-model",
		HTTPClient: mockServer.Client(),
	}
	ctx := context.Background()

	var result struct {
		Key string `json:"key"`
	}
	err := provider.GenerateJSON(ctx, "Give me JSON", &result)

	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if result.Key != "value" {
		t.Errorf("Expected 'value', got '%s'", result.Key)
	}
}

func TestOpenAICompatibleProvider_GenerateContent_Error(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer mockServer.Close()

	provider := &OpenAICompatibleProvider{
		NameID:     "test",
		APIKey:     "test-api-key",
		BaseURL:    mockServer.URL,
		Model:      "test-model",
		HTTPClient: mockServer.Client(),
	}

	ctx := context.Background()
	_, err := provider.GenerateContent(ctx, "Hello")

	if err == nil {
		t.Fatal("Expected an error for a 500 response, but got nil")
	}
	if !strings.Contains(err.Error(), "returned status 500") {
		t.Errorf("Expected error to contain 'returned status 500', got: %v", err)
	}
}
