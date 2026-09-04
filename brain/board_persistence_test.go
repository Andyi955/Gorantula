package brain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func TestMergeNodesIntoBoardStatePersistsAndDedupes(t *testing.T) {
	root := t.TempDir()
	vaultID := "inv-boardmerge"

	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "First", Summary: "First summary", FullText: "First full text", SourceURL: "https://example.com/1"},
		{ID: "node-2", Title: "Second", Summary: "Second summary", FullText: "Second full text", SourceURL: "https://example.com/2"},
	}
	if err := MergeNodesIntoBoardState(root, vaultID, nodes); err != nil {
		t.Fatalf("first merge failed: %v", err)
	}

	// Second merge with one duplicate and one new node: dedupe by ID.
	nodes = append(nodes, models.MemoryNode{ID: "node-3", Title: "Third", Summary: "Third summary", FullText: "Third full text", SourceURL: "https://example.com/3"})
	if err := MergeNodesIntoBoardState(root, vaultID, nodes); err != nil {
		t.Fatalf("second merge failed: %v", err)
	}

	raw, err := os.ReadFile(filepath.Join(root, vaultID, "board_state.json"))
	if err != nil {
		t.Fatalf("board state missing: %v", err)
	}
	var board struct {
		Mode  string `json:"mode"`
		Nodes []struct {
			ID    string `json:"id"`
			Type  string `json:"type"`
			Style struct {
				Width  float64 `json:"width"`
				Height float64 `json:"height"`
			} `json:"style"`
			Data struct {
				ID        string `json:"id"`
				Title     string `json:"title"`
				Summary   string `json:"summary"`
				FullText  string `json:"fullText"`
				SourceURL string `json:"sourceURL"`
			} `json:"data"`
			Position struct {
				X float64 `json:"x"`
				Y float64 `json:"y"`
			} `json:"position"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(raw, &board); err != nil {
		t.Fatalf("board state is not valid json: %v", err)
	}
	if board.Mode != "strict-grid" {
		t.Fatalf("expected strict-grid mode, got %q", board.Mode)
	}
	if len(board.Nodes) != 3 {
		t.Fatalf("expected 3 deduplicated nodes, got %d", len(board.Nodes))
	}
	first := board.Nodes[0]
	if first.Type != "custom" || first.Data.Title != "First" || first.Data.SourceURL != "https://example.com/1" {
		t.Fatalf("expected persisted node payload to match the board shape, got %#v", first)
	}
	if first.Position.X == 0 && first.Position.Y == 0 {
		t.Fatalf("expected a staged position, got %#v", first.Position)
	}
	if first.Style.Width == 0 || first.Style.Height == 0 {
		t.Fatalf("expected a node frame, got %#v", first.Style)
	}

	// Corrupt-file recovery: garbage board state gets rebuilt, not failed.
	if err := os.WriteFile(filepath.Join(root, vaultID, "board_state.json"), []byte("{corrupt"), 0644); err != nil {
		t.Fatalf("writing corrupt fixture failed: %v", err)
	}
	if err := MergeNodesIntoBoardState(root, vaultID, nodes); err != nil {
		t.Fatalf("merge over corrupt file failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, vaultID, "board_state.json")); err != nil {
		t.Fatalf("board state missing after corrupt recovery: %v", err)
	}
}
