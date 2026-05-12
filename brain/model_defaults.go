package brain

import (
	"os"
	"strings"
)

const (
	DefaultGeminiModel    = "gemini-2.5-flash"
	DefaultOpenAIModel    = "gpt-5.4-mini"
	DefaultAnthropicModel = "claude-sonnet-4-6"
	DefaultDeepSeekModel  = "deepseek-v4-flash"
	DefaultDashScopeModel = "qwen3.6-plus"
	DefaultZhipuAIModel   = "glm-5-turbo"
	DefaultMoonshotModel  = "kimi-k2.6"
	DefaultMiniMaxModel   = "MiniMax-M2.7-highspeed"
	DefaultOllamaModel    = "qwen3-coder"
	DefaultLMStudioModel  = "qwen3.6"
)

func envOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}
