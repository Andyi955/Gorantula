package config

import "testing"

func TestBackendListenAddressDefaultsToLoopback(t *testing.T) {
	t.Setenv("GORANTULA_HOST", "")
	t.Setenv("GORANTULA_PORT", "")

	if got := ListenAddress(); got != "127.0.0.1:8080" {
		t.Fatalf("expected loopback default address, got %q", got)
	}
}

func TestBackendListenAddressAllowsExplicitHostAndPort(t *testing.T) {
	t.Setenv("GORANTULA_HOST", "0.0.0.0")
	t.Setenv("GORANTULA_PORT", "9090")

	if got := ListenAddress(); got != "0.0.0.0:9090" {
		t.Fatalf("expected explicit address, got %q", got)
	}
}
