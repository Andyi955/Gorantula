package synthesis

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"spider-agent/brain"
	"spider-agent/models"
)

type persistedBoardStateForSynthesis struct {
	Nodes []persistedBoardNodeForSynthesis `json:"nodes"`
}

type persistedBoardNodeForSynthesis struct {
	ID   string                             `json:"id"`
	Data persistedBoardNodeDataForSynthesis `json:"data"`
}

type persistedBoardNodeDataForSynthesis struct {
	Title     string                   `json:"title"`
	Summary   string                   `json:"summary"`
	FullText  string                   `json:"fullText"`
	SourceURL string                   `json:"sourceURL"`
	Images    []models.MemoryNodeImage `json:"images,omitempty"`
}

func MemoryNodesFromPersistedBoard(raw json.RawMessage) []models.MemoryNode {
	var board persistedBoardStateForSynthesis
	if err := json.Unmarshal(raw, &board); err != nil {
		return nil
	}

	nodes := make([]models.MemoryNode, 0, len(board.Nodes))
	for _, boardNode := range board.Nodes {
		nodeID := strings.TrimSpace(boardNode.ID)
		if nodeID == "" {
			continue
		}

		title := strings.TrimSpace(boardNode.Data.Title)
		summary := strings.TrimSpace(boardNode.Data.Summary)
		fullText := strings.TrimSpace(boardNode.Data.FullText)
		if title == "" {
			title = nodeID
		}
		if fullText == "" {
			fullText = summary
		}

		nodes = append(nodes, models.MemoryNode{
			ID:        nodeID,
			Title:     title,
			Summary:   summary,
			FullText:  fullText,
			SourceURL: strings.TrimSpace(boardNode.Data.SourceURL),
			Images:    append([]models.MemoryNodeImage(nil), boardNode.Data.Images...),
		})
	}
	return nodes
}

func SyncIndexWithActiveVaults(engine *brain.SynthesisEngine, store *models.InvestigationStore, activeVaults map[string]bool) {
	if engine == nil || store == nil {
		return
	}

	log.Printf("[WS] SYNC_VAULTS running PurgeOrphans for stale index entries...")
	engine.PurgeOrphans(activeVaults)

	indexed := 0
	skipped := 0
	for vaultID := range activeVaults {
		record, err := store.LoadMetadata(vaultID)
		if err == nil && record.Kind == "merged-child" {
			skipped++
			continue
		}

		raw, err := store.LoadJSON(vaultID, models.InvestigationBoardFilename)
		if err != nil {
			skipped++
			continue
		}

		engine.IndexVault(vaultID, MemoryNodesFromPersistedBoard(raw))
		indexed++
	}

	log.Printf("[WS] SYNC_VAULTS backfilled synthesis index for %d active boards (%d skipped)", indexed, skipped)
}

func PersonaAnalysisCompletionDetail(successCount, totalCount int) string {
	if totalCount > 0 && successCount < totalCount {
		return fmt.Sprintf("Partial persona analysis completed (%d/%d insight sets)", successCount, totalCount)
	}
	return fmt.Sprintf("Generated %d persona insight sets", successCount)
}
