package brain

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/generative-ai-go/genai"
)

// 300s: large JSON generations under provider load can exceed two minutes;
// a client timeout shorter than the provider's real latency shows up as
// empty or aborted responses instead of an honest timeout error.
const defaultOpenAICompatibleTimeout = 300 * time.Second

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
	Model       string           `json:"model"`
	Messages    []MiniMaxMessage `json:"messages"`
	Temperature float32          `json:"temperature,omitempty"`
	MaxTokens   int              `json:"max_tokens,omitempty"`
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
		APIKey:  apiKey,
		BaseURL: "https://api.minimax.io/v1",
		HTTPClient: &http.Client{
			Timeout: 60 * time.Second,
		},
		Model: envOrDefault("MINIMAX_MODEL", DefaultMiniMaxModel),
	}, nil
}

// GenerateChatCompletion sends a chat completion request to MiniMax
func (m *MiniMaxClient) GenerateChatCompletion(ctx context.Context, messages []MiniMaxMessage, temperature float32, maxTokens int) (string, *llmTokenUsage, error) {
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
		return "", nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Create request
	url := fmt.Sprintf("%s/text/chatcompletion_v2", m.BaseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", m.APIKey))

	// Send request
	resp, err := m.HTTPClient.Do(req)
	if err != nil {
		return "", nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Check status code
	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("MiniMax API returned status %d: %s", resp.StatusCode, string(body))
	}

	// Parse response
	var chatResp MiniMaxChatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		// Try to parse as a simpler format - maybe it's a direct text response
		fmt.Printf("[MiniMax] Response parse error: %v\nResponse body: %s\n", err, string(body))
		return "", nil, fmt.Errorf("failed to parse response: %w, response: %s", err, string(body))
	}

	// Extract content
	if len(chatResp.Choices) == 0 {
		// Check if there's base_resp or other fields
		fmt.Printf("[MiniMax] Empty choices. Full response: %s\n", string(body))
		return "", nil, fmt.Errorf("no choices returned from MiniMax")
	}

	return chatResp.Choices[0].Message.Content, extractMiniMaxTokenUsage(chatResp), nil
}

// GenerateText sends a simple text prompt to MiniMax and returns the response
func (m *MiniMaxClient) GenerateText(ctx context.Context, systemPrompt, userPrompt string, temperature float32) (string, *llmTokenUsage, error) {
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
	SupportsMedia() bool
	SupportsImageReview() bool
	ReviewImageJSON(ctx context.Context, prompt, mimeType string, imageData []byte, response interface{}) error
	Name() string
}

// GeminiProvider wraps the Gemini client for the ModelProvider interface
type GeminiProvider struct {
	brain *Brain
}

func (g *GeminiProvider) Name() string {
	return "gemini"
}

func (g *GeminiProvider) SupportsMedia() bool {
	return true
}

func (g *GeminiProvider) SupportsImageReview() bool {
	return true
}

func (g *GeminiProvider) GenerateContent(ctx context.Context, prompt string) (string, error) {
	g.brain.modelMu.Lock()
	defer g.brain.modelMu.Unlock()

	content, usage, err := g.generateContentLocked(ctx, prompt, genai.Text(prompt))
	if err != nil {
		return "", err
	}
	g.brain.recordProviderTokenUsage(ctx, g.Name(), "GenerateContent", prompt, content, usage)
	return content, nil
}

func (g *GeminiProvider) generateContentLocked(ctx context.Context, prompt string, parts ...genai.Part) (string, *llmTokenUsage, error) {
	resp, err := g.brain.Model.GenerateContent(ctx, parts...)
	if err != nil {
		return "", nil, err
	}
	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", nil, fmt.Errorf("empty response from Gemini")
	}
	return fmt.Sprintf("%v", resp.Candidates[0].Content.Parts[0]), extractGeminiTokenUsage(resp), nil
}

func (g *GeminiProvider) GenerateJSON(ctx context.Context, prompt string, response interface{}) error {
	g.brain.modelMu.Lock()
	defer g.brain.modelMu.Unlock()

	g.brain.Model.ResponseMIMEType = "application/json"
	defer func() { g.brain.Model.ResponseMIMEType = "text/plain" }()

	content, usage, err := g.generateContentLocked(ctx, prompt, genai.Text(prompt))
	if err != nil {
		return err
	}
	g.brain.recordProviderTokenUsage(ctx, g.Name(), "GenerateJSON", prompt, content, usage)

	return parseJSONResponse(content, response)
}

func (g *GeminiProvider) ReviewImageJSON(ctx context.Context, prompt, mimeType string, imageData []byte, response interface{}) error {
	g.brain.modelMu.Lock()
	defer g.brain.modelMu.Unlock()

	g.brain.Model.ResponseMIMEType = "application/json"
	defer func() { g.brain.Model.ResponseMIMEType = "text/plain" }()

	content, usage, err := g.generateContentLocked(
		ctx,
		prompt,
		genai.Text(prompt),
		genai.Blob{MIMEType: mimeType, Data: imageData},
	)
	if err != nil {
		return err
	}
	g.brain.recordProviderTokenUsage(ctx, g.Name(), "ReviewImageJSON", prompt, content, usage)

	return parseJSONResponse(content, response)
}

// MiniMaxProvider wraps the MiniMax client for the ModelProvider interface
type MiniMaxProvider struct {
	client *MiniMaxClient
	brain  *Brain
}

func (m *MiniMaxProvider) Name() string {
	return "minimax"
}

func (m *MiniMaxProvider) SupportsMedia() bool {
	return false
}

func (m *MiniMaxProvider) SupportsImageReview() bool {
	return false
}

func (m *MiniMaxProvider) GenerateContent(ctx context.Context, prompt string) (string, error) {
	content, usage, err := m.client.GenerateText(ctx, "", prompt, 0.7)
	if err != nil {
		return "", err
	}
	m.recordTokenUsage(ctx, "GenerateContent", prompt, content, usage)
	return content, nil
}

func (m *MiniMaxProvider) GenerateJSON(ctx context.Context, prompt string, response interface{}) error {
	content, usage, err := m.client.GenerateText(ctx, "", prompt, 0.0)
	if err != nil {
		return err
	}
	m.recordTokenUsage(ctx, "GenerateJSON", prompt, content, usage)

	return parseJSONResponse(content, response)
}

func (m *MiniMaxProvider) ReviewImageJSON(_ context.Context, _, _ string, _ []byte, _ interface{}) error {
	return fmt.Errorf("provider %q does not support image review", m.Name())
}

func (m *MiniMaxProvider) recordTokenUsage(ctx context.Context, fallbackOperation, prompt, completion string, usage *llmTokenUsage) {
	if m == nil || m.brain == nil {
		return
	}
	m.brain.recordProviderTokenUsage(ctx, m.Name(), fallbackOperation, prompt, completion, usage)
}

// parseJSONResponse handles common LLM response cleaning and JSON parsing
func parseJSONResponse(content string, response interface{}) error {
	cleaned := strings.TrimSpace(cleanMarkdownJSON(content))
	candidates := []string{cleaned}
	if extracted, err := extractJSONValue(cleaned); err == nil && extracted != cleaned {
		candidates = append(candidates, extracted)
	}

	var lastErr error
	for _, candidate := range candidates {
		for _, variant := range uniqueJSONParseVariants(candidate) {
			if err := json.Unmarshal([]byte(variant), response); err == nil {
				return nil
			} else {
				lastErr = err
			}
		}
	}

	if lastErr != nil {
		return fmt.Errorf("failed to parse JSON response: %w, original content: %s", lastErr, content)
	}
	return fmt.Errorf("failed to parse JSON response: empty content")
}

// extractJSONObject finds the first valid-looking JSON object in a string by tracking brace depth
func extractJSONObject(content string) (string, error) {
	return extractJSONValueWithDelimiters(content, '{', '}')
}

func extractJSONValue(content string) (string, error) {
	objectStart := strings.IndexRune(content, '{')
	arrayStart := strings.IndexRune(content, '[')
	switch {
	case objectStart == -1 && arrayStart == -1:
		return "", fmt.Errorf("no JSON object or array found")
	case arrayStart == -1 || (objectStart != -1 && objectStart < arrayStart):
		return extractJSONValueWithDelimiters(content, '{', '}')
	default:
		return extractJSONValueWithDelimiters(content, '[', ']')
	}
}

func extractJSONValueWithDelimiters(content string, open, close rune) (string, error) {
	start := -1
	end := -1
	depth := 0
	inString := false
	escaped := false
	for i, c := range content {
		if escaped {
			escaped = false
			continue
		}
		if c == '\\' && inString {
			escaped = true
			continue
		}
		if c == '"' {
			inString = !inString
			continue
		}
		if inString {
			continue
		}
		if c == open {
			if start == -1 {
				start = i
			}
			depth++
		} else if c == close {
			depth--
			if depth == 0 && start != -1 {
				end = i + 1
				break
			}
		}
	}

	if start != -1 && end != -1 && depth == 0 {
		return content[start:end], nil
	}

	return "", fmt.Errorf("no balanced JSON value found")
}

func uniqueJSONParseVariants(content string) []string {
	trimmed := strings.TrimSpace(content)
	repaired := removeTrailingJSONCommas(trimmed)
	if repaired == trimmed {
		return []string{trimmed}
	}
	return []string{trimmed, repaired}
}

func removeTrailingJSONCommas(content string) string {
	var builder strings.Builder
	builder.Grow(len(content))
	inString := false
	escaped := false

	for i, c := range content {
		if escaped {
			builder.WriteRune(c)
			escaped = false
			continue
		}
		if c == '\\' && inString {
			builder.WriteRune(c)
			escaped = true
			continue
		}
		if c == '"' {
			builder.WriteRune(c)
			inString = !inString
			continue
		}
		if !inString && c == ',' {
			for _, next := range content[i+1:] {
				if next == ' ' || next == '\n' || next == '\r' || next == '\t' {
					continue
				}
				if next == '}' || next == ']' {
					goto skipComma
				}
				break
			}
		}
		builder.WriteRune(c)
	skipComma:
	}

	return builder.String()
}

// NewModelRouter creates a model router with the available providers
func NewModelRouter(brain *Brain) (map[string]ModelProvider, error) {
	router := make(map[string]ModelProvider)

	// Add Gemini provider
	if brain != nil && brain.Model != nil && providerEnabled("GEMINI_ENABLED") {
		router["gemini"] = &GeminiProvider{brain: brain}
	}

	// Add MiniMax provider if available
	if providerEnabled("MINIMAX_ENABLED") && strings.TrimSpace(os.Getenv("MINIMAX_API_KEY")) != "" {
		minimax, err := NewMiniMaxClient()
		if err != nil {
			fmt.Printf("[Brain] Warning: MiniMax not available: %v\n", err)
		} else {
			router["minimax"] = &MiniMaxProvider{client: minimax, brain: brain}
		}
	}

	httpClient := &http.Client{Timeout: defaultOpenAICompatibleTimeout}
	if key := os.Getenv("OPENAI_API_KEY"); key != "" && providerEnabled("OPENAI_ENABLED") {
		router["openai"] = &OpenAICompatibleProvider{
			NameID:     "openai",
			APIKey:     key,
			BaseURL:    "https://api.openai.com/v1",
			Model:      envOrDefault("OPENAI_MODEL", DefaultOpenAIModel),
			HTTPClient: httpClient,
			brain:      brain,
		}
	}

	if key := os.Getenv("ANTHROPIC_API_KEY"); key != "" && providerEnabled("ANTHROPIC_ENABLED") {
		router["anthropic"] = &OpenAICompatibleProvider{
			NameID:     "anthropic",
			APIKey:     key,
			BaseURL:    "https://api.anthropic.com/v1",
			Model:      envOrDefault("ANTHROPIC_MODEL", DefaultAnthropicModel),
			HTTPClient: httpClient,
			brain:      brain,
		}
	}

	if key := os.Getenv("DEEPSEEK_API_KEY"); key != "" && providerEnabled("DEEPSEEK_ENABLED") {
		router["deepseek"] = &OpenAICompatibleProvider{
			NameID:       "deepseek",
			APIKey:       key,
			BaseURL:      "https://api.deepseek.com/v1",
			Model:        envOrDefault("DEEPSEEK_MODEL", DefaultDeepSeekModel),
			HTTPClient:   httpClient,
			brain:        brain,
			// DeepSeek V4 thinks by default at high effort and the hidden
			// reasoning burns the answer's token budget (empty responses
			// with finish_reason=length). Default: thinking off. Opt back
			// in with DEEPSEEK_THINKING=low|high|max.
			ThinkingMode: envOrDefault("DEEPSEEK_THINKING", "disabled"),
		}
	}

	if key := os.Getenv("DASHSCOPE_API_KEY"); key != "" && providerEnabled("DASHSCOPE_ENABLED") {
		router["qwen"] = &OpenAICompatibleProvider{
			NameID:     "qwen",
			APIKey:     key,
			BaseURL:    "https://dashscope.aliyuncs.com/compatible-mode/v1",
			Model:      envOrDefault("DASHSCOPE_MODEL", DefaultDashScopeModel),
			HTTPClient: httpClient,
			brain:      brain,
		}
	}

	if key := os.Getenv("ZHIPUAI_API_KEY"); key != "" && providerEnabled("ZHIPUAI_ENABLED") {
		router["zhipuai"] = &OpenAICompatibleProvider{
			NameID:     "zhipuai",
			APIKey:     key,
			BaseURL:    "https://open.bigmodel.cn/api/paas/v4",
			Model:      envOrDefault("ZHIPUAI_MODEL", DefaultZhipuAIModel),
			HTTPClient: httpClient,
			brain:      brain,
		}
	}

	if key := os.Getenv("MOONSHOT_API_KEY"); key != "" && providerEnabled("MOONSHOT_ENABLED") {
		router["moonshot"] = &OpenAICompatibleProvider{
			NameID:     "moonshot",
			APIKey:     key,
			BaseURL:    "https://api.moonshot.ai/v1",
			Model:      envOrDefault("MOONSHOT_MODEL", DefaultMoonshotModel),
			HTTPClient: httpClient,
			brain:      brain,
		}
	}

	if host := os.Getenv("OLLAMA_HOST"); host != "" && providerEnabled("OLLAMA_ENABLED") {
		router["ollama"] = &OpenAICompatibleProvider{
			NameID:     "ollama",
			BaseURL:    host + "/v1",
			Model:      envOrDefault("OLLAMA_MODEL", DefaultOllamaModel),
			HTTPClient: httpClient,
			brain:      brain,
		}
	}

	lmStudioBaseURL := envOrDefault("LMSTUDIO_BASE_URL", "http://localhost:1234/v1")
	if token := os.Getenv("LM_API_TOKEN"); providerEnabled("LMSTUDIO_ENABLED") && (token != "" || strings.TrimSpace(os.Getenv("LMSTUDIO_BASE_URL")) != "") {
		router["lmstudio"] = &OpenAICompatibleProvider{
			NameID:     "lmstudio",
			APIKey:     token,
			BaseURL:    lmStudioBaseURL,
			Model:      envOrDefault("LMSTUDIO_MODEL", DefaultLMStudioModel),
			HTTPClient: httpClient,
			brain:      brain,
		}
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

func extractGeminiTokenUsage(resp *genai.GenerateContentResponse) *llmTokenUsage {
	if resp == nil || resp.UsageMetadata == nil {
		return nil
	}

	return &llmTokenUsage{
		PromptTokens:     int(resp.UsageMetadata.PromptTokenCount),
		CompletionTokens: int(resp.UsageMetadata.CandidatesTokenCount),
		TotalTokens:      int(resp.UsageMetadata.TotalTokenCount),
	}
}

func extractMiniMaxTokenUsage(resp MiniMaxChatResponse) *llmTokenUsage {
	if resp.Usage.PromptTokens == 0 && resp.Usage.CompletionTokens == 0 && resp.Usage.TotalTokens == 0 {
		return nil
	}

	return &llmTokenUsage{
		PromptTokens:     resp.Usage.PromptTokens,
		CompletionTokens: resp.Usage.CompletionTokens,
		TotalTokens:      resp.Usage.TotalTokens,
	}
}
