package app

import (
	"log/slog"

	"github.com/Andyi955/Gorantula/internal/logging"
)

func appLog(component string) *slog.Logger {
	return logging.Logger("app." + component)
}
