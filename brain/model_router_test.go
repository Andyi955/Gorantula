package brain

import "testing"

func TestNewModelRouter_UsesRecommendedDefaults(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "openai-key")
	t.Setenv("ANTHROPIC_API_KEY", "anthropic-key")
	t.Setenv("DEEPSEEK_API_KEY", "deepseek-key")
	t.Setenv("DASHSCOPE_API_KEY", "dashscope-key")
	t.Setenv("ZHIPUAI_API_KEY", "zhipu-key")
	t.Setenv("MOONSHOT_API_KEY", "moonshot-key")
	t.Setenv("MINIMAX_API_KEY", "minimax-key")
	t.Setenv("OLLAMA_HOST", "http://localhost:11434")
	t.Setenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1")

	router, err := NewModelRouter(&Brain{})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if _, exists := router["gemini"]; exists {
		t.Fatal("did not expect gemini to register without an initialized Gemini client")
	}

	openai := router["openai"].(*OpenAICompatibleProvider)
	if openai.Model != DefaultOpenAIModel {
		t.Fatalf("expected openai model %q, got %q", DefaultOpenAIModel, openai.Model)
	}

	anthropic := router["anthropic"].(*OpenAICompatibleProvider)
	if anthropic.Model != DefaultAnthropicModel || anthropic.BaseURL != "https://api.anthropic.com/v1" {
		t.Fatalf("unexpected anthropic config: %#v", anthropic)
	}

	deepseek := router["deepseek"].(*OpenAICompatibleProvider)
	if deepseek.Model != DefaultDeepSeekModel {
		t.Fatalf("expected deepseek model %q, got %q", DefaultDeepSeekModel, deepseek.Model)
	}

	qwen := router["qwen"].(*OpenAICompatibleProvider)
	if qwen.Model != DefaultDashScopeModel {
		t.Fatalf("expected qwen model %q, got %q", DefaultDashScopeModel, qwen.Model)
	}

	zhipu := router["zhipuai"].(*OpenAICompatibleProvider)
	if zhipu.Model != DefaultZhipuAIModel {
		t.Fatalf("expected zhipu model %q, got %q", DefaultZhipuAIModel, zhipu.Model)
	}

	moonshot := router["moonshot"].(*OpenAICompatibleProvider)
	if moonshot.Model != DefaultMoonshotModel || moonshot.BaseURL != "https://api.moonshot.ai/v1" {
		t.Fatalf("unexpected moonshot config: %#v", moonshot)
	}

	minimax := router["minimax"].(*MiniMaxProvider)
	if minimax.client.Model != DefaultMiniMaxModel || minimax.client.BaseURL != "https://api.minimax.io/v1" {
		t.Fatalf("unexpected minimax config: %#v", minimax.client)
	}

	ollama := router["ollama"].(*OpenAICompatibleProvider)
	if ollama.Model != DefaultOllamaModel {
		t.Fatalf("expected ollama model %q, got %q", DefaultOllamaModel, ollama.Model)
	}

	lmstudio := router["lmstudio"].(*OpenAICompatibleProvider)
	if lmstudio.Model != DefaultLMStudioModel || lmstudio.BaseURL != "http://localhost:1234/v1" {
		t.Fatalf("unexpected lmstudio config: %#v", lmstudio)
	}
}

func TestNewModelRouter_UsesExplicitModelOverrides(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "openai-key")
	t.Setenv("OPENAI_MODEL", "gpt-5.5")
	t.Setenv("DEEPSEEK_API_KEY", "deepseek-key")
	t.Setenv("DEEPSEEK_MODEL", "deepseek-v4-pro")
	t.Setenv("OLLAMA_HOST", "http://localhost:11434")
	t.Setenv("OLLAMA_MODEL", "deepseek-r1")
	t.Setenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1")
	t.Setenv("LMSTUDIO_MODEL", "glm-4.7")

	router, err := NewModelRouter(&Brain{})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if got := router["openai"].(*OpenAICompatibleProvider).Model; got != "gpt-5.5" {
		t.Fatalf("expected openai override, got %q", got)
	}
	if got := router["deepseek"].(*OpenAICompatibleProvider).Model; got != "deepseek-v4-pro" {
		t.Fatalf("expected deepseek override, got %q", got)
	}
	if got := router["ollama"].(*OpenAICompatibleProvider).Model; got != "deepseek-r1" {
		t.Fatalf("expected ollama override, got %q", got)
	}
	if got := router["lmstudio"].(*OpenAICompatibleProvider).Model; got != "glm-4.7" {
		t.Fatalf("expected lmstudio override, got %q", got)
	}
}

func TestGetSearchProviderFallsBackWhenGeminiIsUnavailable(t *testing.T) {
	t.Setenv("DEFAULT_SEARCH_MODEL", "")

	brain := &Brain{
		ModelRouter: map[string]ModelProvider{
			"openai": &OpenAICompatibleProvider{NameID: "openai"},
		},
	}

	provider := brain.GetSearchProvider()
	if provider == nil {
		t.Fatal("expected a fallback provider")
	}
	if provider.Name() != "openai" {
		t.Fatalf("expected openai fallback, got %q", provider.Name())
	}
}
