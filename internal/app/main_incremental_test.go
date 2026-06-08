package app

import (
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func TestFilterConnectionsByPendingNodeIDs(t *testing.T) {
	connections := []models.BoardConnection{
		{Source: "node-a", Target: "node-b", Tag: "KEEP"},
		{Source: "node-b", Target: "node-c", Tag: "PENDING_TARGET"},
		{Source: "node-d", Target: "node-e", Tag: "DROP"},
	}

	filtered := filterConnectionsByPendingNodeIDs(connections, []string{"node-c", "node-a"})

	if len(filtered) != 2 {
		t.Fatalf("expected 2 filtered connections, got %d", len(filtered))
	}
	if filtered[0].Tag != "KEEP" || filtered[1].Tag != "PENDING_TARGET" {
		t.Fatalf("unexpected filtered connections: %+v", filtered)
	}
}
