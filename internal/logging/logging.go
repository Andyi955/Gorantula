package logging

import (
	"log/slog"
	"os"
	"strings"
)

// Configure installs the process-wide logger used by the backend.
func Configure() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: parseLevel(os.Getenv("GORANTULA_LOG_LEVEL")),
	})))
}

func Logger(component string) *slog.Logger {
	component = strings.TrimSpace(component)
	if component == "" {
		return slog.Default()
	}
	return slog.Default().With("component", component)
}

func parseLevel(value string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
