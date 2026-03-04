package brain

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// OpenAIMessage represents a chat message
type OpenAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// OpenAIChatRequest represents the request structure for OpenAI compatible APIs
type OpenAIChatRequest struct {
	Model       string          `json:"model"`
	Messages    []OpenAIMessage `json:"messages"`
	Temperature float32         `json:"temperature,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
}

// OpenAIChatResponse represents the response structure
type OpenAIChatResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
}

// OpenAICompatibleProvider integrates OpenAI-like APIs (DeepSeek, Qwen, GLM, Anthropic via standard translation, etc.)
type OpenAICompatibleProvider struct {
	NameID     string
	APIKey     string
	BaseURL    string
	Model      string
	HTTPClient *http.Client
}

func (p *OpenAICompatibleProvider) Name() string {
	return p.NameID
}

func (p *OpenAICompatibleProvider) GenerateContent(ctx context.Context, prompt string) (string, error) {
	messages := []OpenAIMessage{
		{Role: "user", Content: prompt},
	}

	request := OpenAIChatRequest{
		Model:       p.Model,
		Messages:    messages,
		Temperature: 0.7,
		MaxTokens:   8192,
	}

	return p.doRequest(ctx, request)
}

func (p *OpenAICompatibleProvider) GenerateJSON(ctx context.Context, prompt string, response interface{}) error {
	messages := []OpenAIMessage{
		{Role: "user", Content: prompt + "\n\nCRITICAL: Respond ONLY with valid JSON."},
	}

	request := OpenAIChatRequest{
		Model:       p.Model,
		Messages:    messages,
		Temperature: 0.1,
		MaxTokens:   8192,
	}

	content, err := p.doRequest(ctx, request)
	if err != nil {
		return err
	}

	// Clean markdown JSON if wrapped
	content = strings.TrimSpace(content)
	if strings.HasPrefix(content, "```json") {
		content = strings.TrimPrefix(content, "```json")
		content = strings.TrimSuffix(content, "```")
	} else if strings.HasPrefix(content, "```") {
		content = strings.TrimPrefix(content, "```")
		content = strings.TrimSuffix(content, "```")
	}
	content = strings.TrimSpace(content)

	return json.Unmarshal([]byte(content), response)
}

func (p *OpenAICompatibleProvider) doRequest(ctx context.Context, request OpenAIChatRequest) (string, error) {
	jsonData, err := json.Marshal(request)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/chat/completions", p.BaseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if p.APIKey != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", p.APIKey))
	} else if p.NameID == "anthropic" {
		req.Header.Set("x-api-key", p.APIKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	}

	resp, err := p.HTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request %s: %w", p.NameID, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%s API returned status %d: %s", p.NameID, resp.StatusCode, string(body))
	}

	var chatResp OpenAIChatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		return "", fmt.Errorf("failed to parse response from %s: %w, response: %s", p.NameID, err, string(body))
	}

	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("no choices returned from %s: %s", p.NameID, string(body))
	}

	return chatResp.Choices[0].Message.Content, nil
}
