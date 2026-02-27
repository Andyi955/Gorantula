package brain

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/google/generative-ai-go/genai"
)

// MiniMaxClient handles communication with the MiniMax API
type MiniMaxClient struct {
	APIKey     string
	BaseURL    string
	HTTPClient *http.Client
	Model      string
}

// MiniMaxMessage represents a chat message
type MiniMaxMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// MiniMaxChatRequest represents the request structure for MiniMax chat API
type MiniMaxChatRequest struct {
	Model      string            `json:"model"`
	Messages   []MiniMaxMessage `json:"messages"`
	Temperature float32          `json:"temperature,omitempty"`
	MaxTokens  int               `json:"max_tokens,omitempty"`
}

// MiniMaxChatResponse represents the response structure from MiniMax chat API
type MiniMaxChatResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Index   int `json:"index"`
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

// NewMiniMaxClient creates a new MiniMax API client
func NewMiniMaxClient() (*MiniMaxClient, error) {
	apiKey := os.Getenv("MINIMAX_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("MINIMAX_API_KEY environment variable not set")
	}

	return &MiniMaxClient{
		APIKey: apiKey,
		BaseURL: "https://api.minimax.chat/v1",
		HTTPClient: &http.Client{
			Timeout: 60 * time.Second,
		},
		Model: "MiniMax-M2.5-HighSpeed", // Default to the high-speed model
	}, nil
}

// GenerateChatCompletion sends a chat completion request to MiniMax
func (m *MiniMaxClient) GenerateChatCompletion(ctx context.Context, messages []MiniMaxMessage, temperature float32, maxTokens int) (string, error) {
	// Convert messages to MiniMax format
	mmMessages := make([]MiniMaxMessage, len(messages))
	copy(mmMessages, messages)

	request := MiniMaxChatRequest{
		Model:       m.Model,
		Messages:    mmMessages,
		Temperature: temperature,
		MaxTokens:   maxTokens,
	}

	// Marshal request
	jsonData, err := json.Marshal(request)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	// Create request
	url := fmt.Sprintf("%s/text/chatcompletion_v2", m.BaseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", m.APIKey))

	// Send request
	resp, err := m.HTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	// Check status code
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("MiniMax API returned status %d: %s", resp.StatusCode, string(body))
	}

	// Parse response
	var chatResp MiniMaxChatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		// Try to parse as a simpler format - maybe it's a direct text response
		fmt.Printf("[MiniMax] Response parse error: %v\nResponse body: %s\n", err, string(body))
		return "", fmt.Errorf("failed to parse response: %w, response: %s", err, string(body))
	}

	// Extract content
	if len(chatResp.Choices) == 0 {
		// Check if there's base_resp or other fields
		fmt.Printf("[MiniMax] Empty choices. Full response: %s\n", string(body))
		return "", fmt.Errorf("no choices returned from MiniMax")
	}

	return chatResp.Choices[0].Message.Content, nil
}

// GenerateText sends a simple text prompt to MiniMax and returns the response
func (m *MiniMaxClient) GenerateText(ctx context.Context, systemPrompt, userPrompt string, temperature float32) (string, error) {
	messages := []MiniMaxMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userPrompt},
	}

	return m.GenerateChatCompletion(ctx, messages, temperature, 4096)
}

// ModelProvider interface defines the contract for AI model providers
type ModelProvider interface {
	GenerateContent(ctx context.Context, prompt string) (string, error)
	GenerateJSON(ctx context.Context, prompt string, response interface{}) error
	Name() string
}

// GeminiProvider wraps the Gemini client for the ModelProvider interface
type GeminiProvider struct {
	brain *Brain
}

func (g *GeminiProvider) Name() string {
	return "gemini"
}

func (g *GeminiProvider) GenerateContent(ctx context.Context, prompt string) (string, error) {
	resp, err := g.brain.Model.GenerateContent(ctx, genai.Text(prompt))
	if err != nil {
		return "", err
	}
	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("empty response from Gemini")
	}
	return fmt.Sprintf("%v", resp.Candidates[0].Content.Parts[0]), nil
}

func (g *GeminiProvider) GenerateJSON(ctx context.Context, prompt string, response interface{}) error {
	g.brain.Model.ResponseMIMEType = "application/json"
	defer func() { g.brain.Model.ResponseMIMEType = "text/plain" }()

	content, err := g.GenerateContent(ctx, prompt)
	if err != nil {
		return err
	}

	// Clean markdown wrapper if present
	content = cleanMarkdownJSON(content)

	// Try direct parse first
	if err := json.Unmarshal([]byte(content), response); err == nil {
		return nil
	}

	// If that fails, try to find JSON object in the content
	fmt.Printf("[Gemini] JSON parse failed, trying to fix. Content: %s\n", content)
	start := -1
	end := -1
	depth := 0
	for i, c := range content {
		if c == '{' {
			if start == -1 {
				start = i
			}
			depth++
		} else if c == '}' {
			depth--
			if depth == 0 && start != -1 {
				end = i + 1
				break
			}
		}
	}

	if start != -1 && end != -1 {
		jsonStr := content[start:end]
		return json.Unmarshal([]byte(jsonStr), response)
	}

	return fmt.Errorf("could not parse JSON from response: %s", content)
}

// MiniMaxProvider wraps the MiniMax client for the ModelProvider interface
type MiniMaxProvider struct {
	client *MiniMaxClient
}

func (m *MiniMaxProvider) Name() string {
	return "minimax"
}

func (m *MiniMaxProvider) GenerateContent(ctx context.Context, prompt string) (string, error) {
	return m.client.GenerateText(ctx, "", prompt, 0.7)
}

func (m *MiniMaxProvider) GenerateJSON(ctx context.Context, prompt string, response interface{}) error {
	content, err := m.client.GenerateText(ctx, "", prompt, 0.0)
	if err != nil {
		return err
	}

	// Clean markdown wrapper if present
	content = cleanMarkdownJSON(content)

	// Try direct parse first
	if err := json.Unmarshal([]byte(content), response); err == nil {
		return nil
	}

	// If that fails, try to handle common issues:
	// 1. Response might be wrapped in quotes
	// 2. Response might be an array format
	fmt.Printf("[MiniMax] JSON parse failed, trying to fix. Content: %s\n", content)

	// Try to find JSON object in the content
	start := -1
	end := -1
	depth := 0
	for i, c := range content {
		if c == '{' {
			if start == -1 {
				start = i
			}
			depth++
		} else if c == '}' {
			depth--
			if depth == 0 && start != -1 {
				end = i + 1
				break
			}
		}
	}

	if start != -1 && end != -1 {
		jsonStr := content[start:end]
		return json.Unmarshal([]byte(jsonStr), response)
	}

	return fmt.Errorf("could not parse JSON from response: %s", content)
}

// NewModelRouter creates a model router with the available providers
func NewModelRouter(brain *Brain) (map[string]ModelProvider, error) {
	router := make(map[string]ModelProvider)

	// Add Gemini provider
	router["gemini"] = &GeminiProvider{brain: brain}

	// Add MiniMax provider if available
	minimax, err := NewMiniMaxClient()
	if err != nil {
		fmt.Printf("[Brain] Warning: MiniMax not available: %v\n", err)
	} else {
		router["minimax"] = &MiniMaxProvider{client: minimax}
	}

	return router, nil
}

// cleanMarkdownJSON removes markdown code block wrappers from JSON
func cleanMarkdownJSON(content string) string {
	// Remove ```json and ``` wrappers
	content = removeMarkdownWrapper(content, "json")
	content = removeMarkdownWrapper(content, "")
	return content
}

func removeMarkdownWrapper(content, lang string) string {
	if lang != "" {
		content = removePrefix(content, "```"+lang+"\n")
		content = removeSuffix(content, "\n```")
	}
	// Also try without language
	content = removePrefix(content, "```\n")
	content = removeSuffix(content, "\n```")
	return content
}

func removePrefix(s, prefix string) string {
	if len(s) >= len(prefix) && s[:len(prefix)] == prefix {
		return s[len(prefix):]
	}
	return s
}

func removeSuffix(s, suffix string) string {
	if len(s) >= len(suffix) && s[len(s)-len(suffix):] == suffix {
		return s[:len(s)-len(suffix)]
	}
	return s
}
