package brain

import (
	"log/slog"

	"github.com/Andyi955/Gorantula/internal/logging"
)

func brainLog(component string) *slog.Logger {
	return logging.Logger("brain." + component)
}
