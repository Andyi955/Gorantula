package app

import (
	"log/slog"

	"spider-agent/internal/logging"
)

func appLog(component string) *slog.Logger {
	return logging.Logger("app." + component)
}
