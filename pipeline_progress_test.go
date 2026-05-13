package main

import "testing"

func TestExtractPipelineRunMetadataUsesProvidedRunAndVault(t *testing.T) {
	msg := map[string]interface{}{
		"runId":   "run-123",
		"vaultId": "inv-123",
	}

	meta := extractPipelineRunMetadata(msg, "fallback-vault", "web")

	if meta.RunID != "run-123" {
		t.Fatalf("RunID = %q, want run-123", meta.RunID)
	}
	if meta.VaultID != "inv-123" {
		t.Fatalf("VaultID = %q, want inv-123", meta.VaultID)
	}
	if meta.Mode != "web" {
		t.Fatalf("Mode = %q, want web", meta.Mode)
	}
}

func TestExtractPipelineRunMetadataFallsBackSafely(t *testing.T) {
	meta := extractPipelineRunMetadata(map[string]interface{}{}, "fallback-vault", "local")

	if meta.RunID == "" {
		t.Fatal("expected generated RunID")
	}
	if meta.VaultID != "fallback-vault" {
		t.Fatalf("VaultID = %q, want fallback-vault", meta.VaultID)
	}
	if meta.Mode != "local" {
		t.Fatalf("Mode = %q, want local", meta.Mode)
	}
}
