package logging

import (
	"log/slog"
	"testing"
)

func TestParseLevel(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  slog.Level
	}{
		{name: "default", value: "", want: slog.LevelInfo},
		{name: "debug", value: "debug", want: slog.LevelDebug},
		{name: "warn", value: "warn", want: slog.LevelWarn},
		{name: "warning", value: "warning", want: slog.LevelWarn},
		{name: "error", value: "error", want: slog.LevelError},
		{name: "trim and case", value: " WARN ", want: slog.LevelWarn},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseLevel(tt.value); got != tt.want {
				t.Fatalf("parseLevel(%q) = %v, want %v", tt.value, got, tt.want)
			}
		})
	}
}
