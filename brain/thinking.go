package brain

import (
	"context"
	"strings"
)

// Thinking override: a per-run thinking mode stamped onto the scan context.
// Only the stages that benefit from reasoning - query planning (the very
// start) and the final report synthesis - receive it. Structured JSON
// extraction (personas, relationship synthesis, fact ranking) always runs
// with the provider default, because reasoning tokens share the output
// budget with the answer and burned budgets are what produced empty
// finish_reason=length responses on DeepSeek V4.

type thinkingOverrideContextKey struct{}

// WithThinkingOverride stamps a thinking mode ("off", "low", "high") onto
// the context. Empty or unknown modes are ignored so the provider default
// applies.
func WithThinkingOverride(ctx context.Context, mode string) context.Context {
	normalized := normalizeThinkingMode(mode)
	if normalized == "" {
		return ctx
	}
	return context.WithValue(ctx, thinkingOverrideContextKey{}, normalized)
}

func thinkingOverrideFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if mode, ok := ctx.Value(thinkingOverrideContextKey{}).(string); ok {
		return mode
	}
	return ""
}

// normalizeThinkingMode collapses the UI and provider vocabulary into the
// two levels Gorantula exposes (low/high) plus off. Medium maps to low:
// providers disagree on medium, and low is the conservative choice.
func normalizeThinkingMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "off", "disabled", "none":
		return "off"
	case "low", "minimal", "medium":
		return "low"
	case "high", "max", "xhigh":
		return "high"
	default:
		return ""
	}
}
