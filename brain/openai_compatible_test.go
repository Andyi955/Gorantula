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

func TestOpenAICompatibleProvider_ReviewImageJSON(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
			t.Fatalf("failed to decode request: %v", err)
		}

		rawMessages, ok := reqBody["messages"]
		if !ok {
			t.Fatalf("expected messages field in request body, got %#v", reqBody)
		}
		messages, ok := rawMessages.([]interface{})
		if !ok {
			t.Fatalf("expected messages to be an array, got %T", rawMessages)
		}
		if len(messages) == 0 {
			t.Fatal("expected at least one message")
		}

		firstMessage, ok := messages[0].(map[string]interface{})
		if !ok {
			t.Fatalf("expected first message to be an object, got %T", messages[0])
		}
		rawContent, ok := firstMessage["content"]
		if !ok {
			t.Fatalf("expected content field in first message, got %#v", firstMessage)
		}
		content, ok := rawContent.([]interface{})
		if !ok {
			t.Fatalf("expected content to be an array, got %T", rawContent)
		}
		if len(content) != 2 {
			t.Fatalf("expected multimodal content parts, got %d", len(content))
		}

		imagePart, ok := content[1].(map[string]interface{})
		if !ok {
			t.Fatalf("expected second content part to be an object, got %T", content[1])
		}
		rawImageURL, ok := imagePart["image_url"]
		if !ok {
			t.Fatalf("expected image_url field in image content part, got %#v", imagePart)
		}
		imageURLMap, ok := rawImageURL.(map[string]interface{})
		if !ok {
			t.Fatalf("expected image_url to be an object, got %T", rawImageURL)
		}
		rawURL, ok := imageURLMap["url"]
		if !ok {
			t.Fatalf("expected url field inside image_url, got %#v", imageURLMap)
		}
		imageURL, ok := rawURL.(string)
		if !ok {
			t.Fatalf("expected image url to be a string, got %T", rawURL)
		}
		if !strings.HasPrefix(imageURL, "data:image/png;base64,") {
			t.Fatalf("expected image data url payload, got %q", imageURL)
		}

		resp := map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"message": map[string]interface{}{
						"content": "{\"keep\":true,\"reason\":\"Relevant chart\",\"caption\":\"Key chart\"}",
					},
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer mockServer.Close()

	provider := &OpenAICompatibleProvider{
		NameID:     "lmstudio",
		APIKey:     "token",
		BaseURL:    mockServer.URL,
		Model:      "vision-model",
		HTTPClient: mockServer.Client(),
	}

	var result struct {
		Keep    bool   `json:"keep"`
		Reason  string `json:"reason"`
		Caption string `json:"caption"`
	}
	err := provider.ReviewImageJSON(context.Background(), "Review this image", "image/png", []byte("fake-image"), &result)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !result.Keep || result.Caption != "Key chart" {
		t.Fatalf("unexpected review result: %#v", result)
	}
}

func TestOpenAICompatibleProvider_GenerateContent_TracksUsage(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"message": map[string]interface{}{
						"content": "Tracked response",
					},
				},
			},
			"usage": map[string]interface{}{
				"prompt_tokens":     31,
				"completion_tokens": 12,
				"total_tokens":      43,
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer mockServer.Close()

	brain := &Brain{}
	provider := &OpenAICompatibleProvider{
		NameID:     "test",
		APIKey:     "test-api-key",
		BaseURL:    mockServer.URL,
		Model:      "test-model",
		HTTPClient: mockServer.Client(),
		brain:      brain,
	}

	ctx := withTokenUsageTracking(context.Background(), "scope-openai-usage", "test_usage")
	result, err := provider.GenerateContent(ctx, "Hello")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if result != "Tracked response" {
		t.Fatalf("expected tracked response, got %q", result)
	}

	summary := brain.summarizeTokenUsageScope("scope-openai-usage")
	if summary.CallCount != 1 {
		t.Fatalf("expected 1 tracked call, got %d", summary.CallCount)
	}
	if summary.PromptTokens != 31 || summary.CompletionTokens != 12 || summary.TotalTokens != 43 {
		t.Fatalf("unexpected token usage summary: %#v", summary)
	}
	if summary.EstimatedCallCount != 0 || summary.ReportedCallCount != 1 {
		t.Fatalf("expected reported usage only, got %#v", summary)
	}
	if summary.ProviderTotals["test"] != 43 {
		t.Fatalf("expected provider total of 43, got %d", summary.ProviderTotals["test"])
	}
}
