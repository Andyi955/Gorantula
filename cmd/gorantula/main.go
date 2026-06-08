package main

import (
	"os"

	"spider-agent/internal/app"
	"spider-agent/internal/logging"
)

func main() {
	logging.Configure()
	if err := app.Run(); err != nil {
		logging.Logger("startup").Error("gorantula stopped", "err", err)
		os.Exit(1)
	}
}
