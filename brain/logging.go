package brain

import (
	"log/slog"

	"spider-agent/internal/logging"
)

func brainLog(component string) *slog.Logger {
	return logging.Logger("brain." + component)
}
