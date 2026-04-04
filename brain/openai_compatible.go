package brain

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// OpenAIMessage represents a chat message
type OpenAIMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

type OpenAIImageURL struct {
	URL string `json:"url"`
}

type OpenAIContentPart struct {
	Type     string          `json:"type"`
	Text     string          `json:"text,omitempty"`
	ImageURL *OpenAIImageURL `json:"image_url,omitempty"`
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
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// OpenAICompatibleProvider integrates OpenAI-like APIs (DeepSeek, Qwen, GLM, Anthropic via standard translation, etc.)
type OpenAICompatibleProvider struct {
	NameID     string
	APIKey     string
	BaseURL    string
	Model      string
	HTTPClient *http.Client
	brain      *Brain
}

func (p *OpenAICompatibleProvider) Name() string {
	return p.NameID
}

func (p *OpenAICompatibleProvider) SupportsMedia() bool {
	return false
}

func (p *OpenAICompatibleProvider) SupportsImageReview() bool {
	return true
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

	content, usage, err := p.doRequest(ctx, request)
	if err != nil {
		return "", err
	}
	p.recordTokenUsage(ctx, "GenerateContent", prompt, content, usage)
	return content, nil
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

	content, usage, err := p.doRequest(ctx, request)
	if err != nil {
		return err
	}
	p.recordTokenUsage(ctx, "GenerateJSON", prompt, content, usage)

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

func (p *OpenAICompatibleProvider) ReviewImageJSON(ctx context.Context, prompt, mimeType string, imageData []byte, response interface{}) error {
	if !p.SupportsImageReview() {
		return fmt.Errorf("provider %q does not support image review", p.Name())
	}

	dataURL := fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(imageData))
	request := OpenAIChatRequest{
		Model: p.Model,
		Messages: []OpenAIMessage{
			{
				Role: "user",
				Content: []OpenAIContentPart{
					{Type: "text", Text: prompt + "\n\nCRITICAL: Respond ONLY with valid JSON."},
					{Type: "image_url", ImageURL: &OpenAIImageURL{URL: dataURL}},
				},
			},
		},
		Temperature: 0.1,
		MaxTokens:   2048,
	}

	content, usage, err := p.doRequest(ctx, request)
	if err != nil {
		return err
	}
	p.recordTokenUsage(ctx, "ReviewImageJSON", prompt, content, usage)

	return parseJSONResponse(content, response)
}

func (p *OpenAICompatibleProvider) doRequest(ctx context.Context, request OpenAIChatRequest) (string, *llmTokenUsage, error) {
	jsonData, err := json.Marshal(request)
	if err != nil {
		return "", nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/chat/completions", p.BaseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", nil, fmt.Errorf("failed to create request: %w", err)
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
		return "", nil, fmt.Errorf("failed to send request %s: %w", p.NameID, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("%s API returned status %d: %s", p.NameID, resp.StatusCode, string(body))
	}

	var chatResp OpenAIChatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		return "", nil, fmt.Errorf("failed to parse response from %s: %w, response: %s", p.NameID, err, string(body))
	}

	if len(chatResp.Choices) == 0 {
		return "", nil, fmt.Errorf("no choices returned from %s: %s", p.NameID, string(body))
	}

	return chatResp.Choices[0].Message.Content, extractOpenAICompatibleTokenUsage(chatResp), nil
}

func (p *OpenAICompatibleProvider) recordTokenUsage(ctx context.Context, fallbackOperation, prompt, completion string, usage *llmTokenUsage) {
	if p == nil || p.brain == nil {
		return
	}
	p.brain.recordProviderTokenUsage(ctx, p.Name(), fallbackOperation, prompt, completion, usage)
}

func extractOpenAICompatibleTokenUsage(resp OpenAIChatResponse) *llmTokenUsage {
	if resp.Usage.PromptTokens == 0 && resp.Usage.CompletionTokens == 0 && resp.Usage.TotalTokens == 0 {
		return nil
	}

	return &llmTokenUsage{
		PromptTokens:     resp.Usage.PromptTokens,
		CompletionTokens: resp.Usage.CompletionTokens,
		TotalTokens:      resp.Usage.TotalTokens,
	}
}
