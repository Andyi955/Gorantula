package config

import (
	"fmt"
	"os"
	"strings"
)

func ListenAddress() string {
	host := strings.TrimSpace(os.Getenv("GORANTULA_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}

	port := strings.TrimSpace(os.Getenv("GORANTULA_PORT"))
	if port == "" {
		port = "8080"
	}

	return fmt.Sprintf("%s:%s", host, port)
}
