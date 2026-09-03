package brain

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/Andyi955/Gorantula/models"
)

const vaultRootDir = "abdomen_vault"

// MergeNodesIntoBoardState persists gathered evidence nodes into the vault's
// board_state.json so the Detective Board can load them on mount even when
// MEMORY_NODE_GATHERED broadcasts were missed - with pipeline parallelism
// the broadcasts fire while the board is not mounted (the operator is still
// on Spider View), and without this the latest investigation loads empty
// until the operator switches cases and back.
//
// Nodes are merged by ID: existing board content (nodes, edges, positions)
// is preserved, only unseen node IDs are appended.
func MergeNodesIntoBoardState(root, vaultID string, nodes []models.MemoryNode) error {
	if len(nodes) == 0 {
		return nil
	}
	store := models.NewInvestigationStore(root)
	board := map[string]interface{}{
		"mode":                      "strict-grid",
		"nodes":                     []interface{}{},
		"edges":                     []interface{}{},
		"pendingIntegrationNodeIds": []string{},
	}
	raw, loadErr := store.LoadJSON(vaultID, models.InvestigationBoardFilename)
	rebuild := false
	if loadErr != nil {
		// Missing file: fresh board. Invalid json (a legacy partial write):
		// rebuild from the gathered nodes instead of failing the crawl.
		if errors.Is(loadErr, models.ErrInvestigationNotFound) || strings.Contains(loadErr.Error(), "contains invalid json") {
			rebuild = true
		} else {
			return loadErr
		}
	}
	if !rebuild {
		if unmarshalErr := json.Unmarshal(raw, &board); unmarshalErr != nil {
			rebuild = true
		}
	}
	if rebuild {
		board = map[string]interface{}{
			"mode":                      "strict-grid",
			"nodes":                     []interface{}{},
			"edges":                     []interface{}{},
			"pendingIntegrationNodeIds": []string{},
		}
	}

	existingNodes, _ := board["nodes"].([]interface{})
	existingIDs := make(map[string]struct{}, len(existingNodes))
	for _, entry := range existingNodes {
		entryMap, ok := entry.(map[string]interface{})
		if !ok {
			continue
		}
		if id, ok := entryMap["id"].(string); ok {
			existingIDs[id] = struct{}{}
		}
	}

	appended := 0
	for _, node := range nodes {
		if node.ID == "" {
			continue
		}
		if _, seen := existingIDs[node.ID]; seen {
			continue
		}
		existingNodes = append(existingNodes, boardNodeEntry(node, len(existingNodes)))
		existingIDs[node.ID] = struct{}{}
		appended++
	}
	board["nodes"] = existingNodes

	if appended == 0 {
		return nil
	}

	data, err := json.Marshal(board)
	if err != nil {
		return err
	}
	if err := store.SaveJSON(vaultID, models.InvestigationBoardFilename, data); err != nil {
		return err
	}
	brainLog("pipeline").Info("persisted gathered nodes to board state", "vault", vaultID, "appended", appended, "total", len(existingNodes))
	return nil
}

// boardNodeEntry builds a board node in the Detective Board's persisted
// ReactFlow shape - matching what the frontend autosave writes so the load
// path cannot tell them apart. Positions stage the new nodes in a loose
// grid; the connect layout (relationships or manual reconnect) rearranges
// them.
func boardNodeEntry(node models.MemoryNode, index int) map[string]interface{} {
	frame := map[string]interface{}{
		"width":  576,
		"height": 288,
	}
	data := map[string]interface{}{
		"id":         node.ID,
		"title":      node.Title,
		"summary":    node.Summary,
		"fullText":   node.FullText,
		"sourceURL":  node.SourceURL,
		"expanded":   false,
		"boardMode":  "strict-grid",
		"confidence": node.Confidence,
	}
	for _, image := range node.Images {
		data["images"] = image
		break
	}
	return map[string]interface{}{
		"id":     node.ID,
		"type":   "custom",
		"zIndex": 100,
		"style":  frame,
		"data":   data,
		"position": map[string]interface{}{
			"x": 140 + float64(index%4)*600,
			"y": 140 + float64(index/4)*340,
		},
		"sourcePosition": "right",
		"targetPosition": "left",
	}
}
