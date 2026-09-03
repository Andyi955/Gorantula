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

// OpenAIThinking controls reasoning ("thinking") mode on providers that
// support it, e.g. DeepSeek V4 where thinking is enabled by default at
// high effort and the hidden chain-of-thought burns the same max_tokens
// budget as the visible answer.
type OpenAIThinking struct {
	Type string `json:"type"` // "enabled" or "disabled"
}

// OpenAIChatRequest represents the request structure for OpenAI compatible APIs
type OpenAIChatRequest struct {
	Model           string          `json:"model"`
	Messages        []OpenAIMessage `json:"messages"`
	Temperature     float32         `json:"temperature,omitempty"`
	MaxTokens       int             `json:"max_tokens,omitempty"`
	Thinking        *OpenAIThinking `json:"thinking,omitempty"`
	ReasoningEffort string          `json:"reasoning_effort,omitempty"`
	EnableThinking  *bool           `json:"enable_thinking,omitempty"`
}

// OpenAIChatResponse represents the response structure
type OpenAIChatResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Message struct {
			Role             string `json:"role"`
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content,omitempty"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens            int `json:"prompt_tokens"`
		CompletionTokens        int `json:"completion_tokens"`
		TotalTokens             int `json:"total_tokens"`
		CompletionTokensDetails struct {
			ReasoningTokens int `json:"reasoning_tokens"`
		} `json:"completion_tokens_details"`
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
	// ThinkingMode controls reasoning tokens on DeepSeek V4 models:
	// "disabled" (the default) sends thinking:{type:disabled}; "low",
	// "high", or "max" enables thinking at that effort. Ignored for
	// non-DeepSeek providers.
	ThinkingMode string
}

// Provider identity checks: thinking fields are only sent to providers with
// a documented control - unknown fields can hard-fail strict APIs.
func (p *OpenAICompatibleProvider) isDeepSeekHost() bool {
	return p != nil && (strings.EqualFold(p.NameID, "deepseek") || strings.Contains(strings.ToLower(p.BaseURL), "deepseek"))
}

func (p *OpenAICompatibleProvider) isZhipuHost() bool {
	return p != nil && (strings.EqualFold(p.NameID, "zhipuai") || strings.Contains(strings.ToLower(p.BaseURL), "bigmodel"))
}

func (p *OpenAICompatibleProvider) isQwenHost() bool {
	return p != nil && (strings.EqualFold(p.NameID, "qwen") || strings.Contains(strings.ToLower(p.BaseURL), "dashscope"))
}

func (p *OpenAICompatibleProvider) isOpenAIHost() bool {
	return p != nil && (strings.EqualFold(p.NameID, "openai") || strings.Contains(strings.ToLower(p.BaseURL), "api.openai.com"))
}

func (p *OpenAICompatibleProvider) isAnthropicHost() bool {
	return p != nil && (strings.EqualFold(p.NameID, "anthropic") || strings.Contains(strings.ToLower(p.BaseURL), "anthropic"))
}

// applyThinkingControl translates a thinking mode into the requesting
// provider's documented wire format. The mode comes from the run context
// (Spider View's per-scan reasoning toggle) or the provider default
// (DEEPSEEK_THINKING).
//
// When reasoning is enabled, max_tokens doubles: reasoning tokens share
// the output budget with the answer, and a starved budget is exactly what
// produced empty finish_reason=length responses on DeepSeek V4.
func (p *OpenAICompatibleProvider) applyThinkingControl(ctx context.Context, request *OpenAIChatRequest) {
	if p == nil || request == nil {
		return
	}
	mode := normalizeThinkingMode(thinkingOverrideFromContext(ctx))
	if mode == "" {
		mode = normalizeThinkingMode(p.ThinkingMode)
	}

	if mode == "" {
		// Provider default: only DeepSeek needs an explicit off - it thinks
		// at high effort by default, which burns the answer's token budget.
		// Everyone else keeps their native default.
		if p.isDeepSeekHost() {
			request.Thinking = &OpenAIThinking{Type: "disabled"}
		}
		return
	}

	if mode == "off" {
		switch {
		case p.isDeepSeekHost() || p.isZhipuHost():
			request.Thinking = &OpenAIThinking{Type: "disabled"}
		case p.isQwenHost():
			off := false
			request.EnableThinking = &off
		case p.isOpenAIHost() || p.isAnthropicHost():
			// Reasoning models cannot fully stop; omitting the field is the
			// only safe "off" (non-reasoning models never think anyway).
		}
		return
	}

	// mode is low|high: enable reasoning where documented.
	switch {
	case p.isDeepSeekHost():
		request.Thinking = &OpenAIThinking{Type: "enabled"}
		request.ReasoningEffort = effortForProvider(mode)
	case p.isZhipuHost():
		request.Thinking = &OpenAIThinking{Type: "enabled"}
	case p.isQwenHost():
		on := true
		request.EnableThinking = &on
	case p.isOpenAIHost():
		request.ReasoningEffort = effortForProvider(mode)
	case p.isAnthropicHost():
		request.ReasoningEffort = effortForProvider(mode)
		// Anthropic's thinking mode rejects temperature values other than 1.
		request.Temperature = 1
	default:
		return
	}
	if request.MaxTokens > 0 && request.MaxTokens < 16384 {
		request.MaxTokens = 16384
	}
}

// effortForProvider maps the two exposed levels; providers without a
// medium get low for the gentle setting and their documented strong level
// for high.
func effortForProvider(mode string) string {
	if mode == "high" {
		return "high"
	}
	return "low"
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
	p.applyThinkingControl(ctx, &request)

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
	p.applyThinkingControl(ctx, &request)

	content, usage, err := p.doRequest(ctx, request)
	if err != nil {
		return err
	}
	p.recordTokenUsage(ctx, "GenerateJSON", prompt, content, usage)

	return parseJSONResponse(content, response)
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
	p.applyThinkingControl(ctx, &request)

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
	}
	if p.NameID == "anthropic" {
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

	// Surface the provider's finish reason: DeepSeek (and friends) return
	// HTTP 200 with EMPTY content and finish_reason "content_filter" when
	// their safety filter blanks a response. Without this check the caller
	// only sees a cryptic "unexpected end of JSON input" - and retries on a
	// prompt the provider will filter again.
	finishReason := strings.TrimSpace(chatResp.Choices[0].FinishReason)
	reasoningTokens := chatResp.Usage.CompletionTokensDetails.ReasoningTokens
	reasoningChars := len(chatResp.Choices[0].Message.ReasoningContent)
	if finishReason != "" && finishReason != "stop" && finishReason != "end_turn" {
		brainLog("providers").Warn(
			"provider finished abnormally",
			"provider", p.NameID,
			"finish_reason", finishReason,
			"prompt_tokens", chatResp.Usage.PromptTokens,
			"completion_tokens", chatResp.Usage.CompletionTokens,
			"reasoning_tokens", reasoningTokens,
			"reasoning_chars", reasoningChars,
		)
	}
	if finishReason == "content_filter" {
		return "", nil, fmt.Errorf("%s content filter blocked this response (finish_reason=content_filter); the topic or wording likely tripped the provider's safety filter", p.NameID)
	}

	if strings.TrimSpace(chatResp.Choices[0].Message.Content) == "" {
		if reasoningTokens > 0 || reasoningChars > 0 {
			// The model burned its output budget on hidden chain-of-thought
			// and never wrote the visible answer.
			brainLog("providers").Warn(
				"empty content after reasoning burn",
				"provider", p.NameID,
				"finish_reason", finishReason,
				"completion_tokens", chatResp.Usage.CompletionTokens,
				"reasoning_tokens", reasoningTokens,
				"reasoning_chars", reasoningChars,
			)
		}
		return "", nil, fmt.Errorf("%s returned an empty response (finish_reason=%q, %d completion tokens, %d reasoning tokens); often the model exhausted its output budget on hidden reasoning", p.NameID, finishReason, chatResp.Usage.CompletionTokens, reasoningTokens)
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
