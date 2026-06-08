package main

import (
	"os"

	"github.com/Andyi955/Gorantula/internal/app"
	"github.com/Andyi955/Gorantula/internal/logging"
)

func main() {
	logging.Configure()
	if err := app.Run(); err != nil {
		logging.Logger("startup").Error("gorantula stopped", "err", err)
		os.Exit(1)
	}
}
