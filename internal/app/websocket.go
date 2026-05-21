package app

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"spider-agent/brain"
	"spider-agent/internal/investigations"
	"spider-agent/internal/pipeline"
	"spider-agent/internal/synthesis"
	"spider-agent/models"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all for local dev
	},
}

var (
	clients   = make(map[*websocket.Conn]bool)
	clientsMu sync.Mutex
)

func broadcast(msg models.WSMessage) {
	clientsMu.Lock()
	defer clientsMu.Unlock()

	for client := range clients {
		err := client.WriteJSON(msg)
		if err != nil {
			log.Printf("error: %v", err)
			client.Close()
			delete(clients, client)
		}
	}
}

func handleConnections(w http.ResponseWriter, r *http.Request, br *brain.Brain) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}
	defer ws.Close()

	clientsMu.Lock()
	clients[ws] = true
	clientsMu.Unlock()

	for {
		var msg map[string]interface{}
		err := ws.ReadJSON(&msg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("error reading json: %v", err)
			}
			clientsMu.Lock()
			delete(clients, ws)
			clientsMu.Unlock()
			break
		}

		// Support both legacy {"prompt": "..."} and new {"type": "CRAWL", "payload": "..."}
		if prompt, ok := msg["prompt"].(string); ok {
			triggerCrawl(br, prompt, "", false, false, pipeline.ExtractRunMetadata(msg, "", "web"))
		} else if msgType, ok := msg["type"].(string); ok {
			switch msgType {
			case "CRAWL":
				if prompt, ok := msg["payload"].(string); ok {
					vaultID := ""
					if rawVaultID, ok := msg["vaultId"].(string); ok {
						vaultID = strings.TrimSpace(rawVaultID)
					}
					triggerCrawl(br, prompt, vaultID, false, extractScrapeImagesPreference(msg), pipeline.ExtractRunMetadata(msg, vaultID, "web"))
				}
			case "APPEND_CRAWL":
				if prompt, ok := msg["payload"].(string); ok {
					vaultID := ""
					if rawVaultID, ok := msg["vaultId"].(string); ok {
						vaultID = strings.TrimSpace(rawVaultID)
					}
					if vaultID == "" {
						broadcast(models.WSMessage{Type: "ERROR", Payload: "Append crawl requires a target investigation."})
						continue
					}
					triggerCrawl(br, prompt, vaultID, true, extractScrapeImagesPreference(msg), pipeline.ExtractRunMetadata(msg, vaultID, "web"))
				}
			case "CRAWL_LOCAL":
				if payload, ok := msg["payload"].(string); ok {
					payload = strings.TrimSpace(payload)
					var filePaths []string

					// Check if it's a JSON array
					if strings.HasPrefix(payload, "[") && strings.HasSuffix(payload, "]") {
						if err := json.Unmarshal([]byte(payload), &filePaths); err != nil {
							log.Printf("[WS Error] Failed to parse JSON file paths: %v", err)
							filePaths = []string{payload} // Fallback to raw string
						}
					} else if strings.Contains(payload, "|") {
						filePaths = strings.Split(payload, "|")
					} else {
						filePaths = []string{payload}
					}
					triggerLocalCrawl(br, filePaths, pipeline.ExtractRunMetadata(msg, "", "local"))
				}
			case "STOP_PIPELINE":
				runID := ""
				if rawRunID, ok := msg["runId"].(string); ok {
					runID = strings.TrimSpace(rawRunID)
				}
				vaultID := ""
				if rawVaultID, ok := msg["vaultId"].(string); ok {
					vaultID = strings.TrimSpace(rawVaultID)
				}
				if runID == "" {
					broadcast(models.WSMessage{Type: "ERROR", Payload: "Stop pipeline requires a run id."})
					continue
				}
				if !pipeline.CancelRun(runID, vaultID) {
					broadcast(models.WSMessage{Type: "ERROR", Payload: "No active pipeline found for run " + runID})
					continue
				}
				if tracker, ok := pipeline.LookupTracker(runID); ok {
					broadcastPipelineCancelled(tracker, "Stopped by operator")
				}
			case "CONNECT_DOTS":
				log.Println("[WS] Received CONNECT_DOTS request")

				vaultID := ""
				if vId, ok := msg["vaultId"].(string); ok {
					vaultID = strings.TrimSpace(vId)
				}

				payloadBytes, _ := json.Marshal(msg["payload"])
				var nodes []models.MemoryNode
				if err := json.Unmarshal(payloadBytes, &nodes); err != nil {
					log.Printf("[WS Error] Failed to unmarshal CONNECT_DOTS payload: %v", err)
					broadcast(models.WSMessage{Type: "ERROR", Payload: "Invalid node data sent for analysis"})
					continue
				}

				if vaultID == "" && len(nodes) > 0 {
					parts := strings.Split(nodes[0].ID, "-")
					vaultID = "case-" + time.Now().Format("2006-01-02-150405")
					if len(parts) >= 2 {
						vaultID = "case-" + parts[1]
					}
				}

				triggerConnectDotsAnalysis(br, vaultID, nodes, nil, pipeline.ExtractRunMetadata(msg, vaultID, "analysis"))
			case "CONNECT_DOTS_INCREMENTAL":
				log.Println("[WS] Received CONNECT_DOTS_INCREMENTAL request")

				vaultID := ""
				if vId, ok := msg["vaultId"].(string); ok {
					vaultID = strings.TrimSpace(vId)
				}

				payloadBytes, _ := json.Marshal(msg["payload"])
				var payload models.IncrementalConnectDotsPayload
				if err := json.Unmarshal(payloadBytes, &payload); err != nil {
					log.Printf("[WS Error] Failed to unmarshal CONNECT_DOTS_INCREMENTAL payload: %v", err)
					broadcast(models.WSMessage{Type: "ERROR", Payload: "Invalid incremental node data sent for analysis"})
					continue
				}

				pendingNodeIDs := make([]string, 0, len(payload.PendingNodeIDs))
				seenPendingNodeIDs := make(map[string]struct{}, len(payload.PendingNodeIDs))
				for _, nodeID := range payload.PendingNodeIDs {
					nodeID = strings.TrimSpace(nodeID)
					if nodeID == "" {
						continue
					}
					if _, seen := seenPendingNodeIDs[nodeID]; seen {
						continue
					}
					seenPendingNodeIDs[nodeID] = struct{}{}
					pendingNodeIDs = append(pendingNodeIDs, nodeID)
				}

				if len(pendingNodeIDs) == 0 {
					broadcast(models.WSMessage{Type: "ERROR", Payload: "Incremental integration requires at least one pending node."})
					continue
				}

				if vaultID == "" && len(payload.AllNodes) > 0 {
					parts := strings.Split(payload.AllNodes[0].ID, "-")
					vaultID = "case-" + time.Now().Format("2006-01-02-150405")
					if len(parts) >= 2 {
						vaultID = "case-" + parts[1]
					}
				}

				triggerConnectDotsAnalysis(br, vaultID, payload.AllNodes, pendingNodeIDs, pipeline.ExtractRunMetadata(msg, vaultID, "analysis"))
			case "CHAT_RAG":
				log.Println("[WS] Received CHAT_RAG request")
				if payloadMap, ok := msg["payload"].(map[string]interface{}); ok {
					query, _ := payloadMap["query"].(string)
					filesIf, _ := payloadMap["files"].([]interface{})
					var files []string
					for _, f := range filesIf {
						if str, ok := f.(string); ok {
							files = append(files, str)
						}
					}

					go func() {
						broadcast(models.WSMessage{Type: "BRAIN_STATE", Payload: "Interrogating Vault..."})
						response, err := br.InterrogateVault(context.Background(), files, query)
						if err != nil {
							log.Printf("[WS Error] InterrogateVault failed: %v", err)
							broadcast(models.WSMessage{Type: "ERROR", Payload: "Vault interrogation failed: " + err.Error()})
							return
						}
						broadcast(models.WSMessage{Type: "CHAT_RESPONSE", Payload: response})
					}()
				}
			case "DELETE_VAULT":
				log.Println("[WS] Received DELETE_VAULT request")

				vaultPath := ""
				if vp, ok := msg["vaultPath"].(string); ok {
					vaultPath = strings.TrimSpace(vp)
				}

				if vID, ok := msg["payload"].(string); ok {
					vID = strings.TrimSpace(vID)
					// Prevent path traversal
					if filepath.Base(vID) == vID && vID != "" {
						if vaultPath != "" {
							// Delete the specific physical markdown file
							cleanPath := filepath.Clean(vaultPath)
							// ensure path starts with abdomen_vault for safety
							if strings.HasPrefix(strings.ReplaceAll(cleanPath, "\\", "/"), "abdomen_vault/") {
								log.Printf("[WS] Deleting specific vault file: %s", cleanPath)
								os.Remove(cleanPath)
							}
						}

						if br != nil && br.Synthesis != nil {
							go br.Synthesis.PurgeVault(vID)
						}
					} else {
						log.Printf("[WS Error] Invalid DELETE_VAULT payload: %s", vID)
					}
				}
			case "SYNC_VAULTS":
				log.Println("[WS] Received SYNC_VAULTS request")
				if payloadIf, ok := msg["payload"].([]interface{}); ok {
					activeVaults := make(map[string]bool)
					log.Printf("[WS] SYNC_VAULTS mapping %d active IDs", len(payloadIf))
					for _, v := range payloadIf {
						if idStr, ok := v.(string); ok {
							activeVaults[idStr] = true
						}
					}

					go func() {
						if br != nil && br.Synthesis != nil {
							synthesis.SyncIndexWithActiveVaults(br.Synthesis, investigations.Store(), activeVaults)
						}
					}()
				}
			case "PULL_NODE":
				log.Println("[WS] Received PULL_NODE request")
				if payloadMap, ok := msg["payload"].(map[string]interface{}); ok {
					sourceVaultID, _ := payloadMap["sourceVaultId"].(string)
					sourceNodeID, _ := payloadMap["sourceNodeId"].(string)
					targetVaultID, _ := payloadMap["targetVaultId"].(string)

					go func() {
						err := br.PullNode(context.Background(), sourceVaultID, sourceNodeID, targetVaultID)
						if err != nil {
							log.Printf("[WS Error] PullNode failed: %v", err)
							broadcast(models.WSMessage{Type: "ERROR", Payload: "Pull node failed: " + err.Error()})
						}
					}()
				}
			case "PROCESS_MANUAL_NODE":
				log.Println("[WS] Received PROCESS_MANUAL_NODE request")
				if payloadMap, ok := msg["payload"].(map[string]interface{}); ok {
					nodeID, _ := payloadMap["nodeId"].(string)
					rawText, _ := payloadMap["text"].(string)

					go func() {
						processedText, err := br.ProcessManualNodeText(context.Background(), rawText)
						if err != nil {
							log.Printf("[WS Error] ProcessManualNodeText failed: %v", err)
							broadcast(models.WSMessage{Type: "ERROR", Payload: "Analysis failed: " + err.Error()})
							return
						}
						broadcast(models.WSMessage{
							Type: "MANUAL_NODE_PROCESSED",
							Payload: map[string]interface{}{
								"nodeId":        nodeID,
								"processedText": processedText,
							},
						})
					}()
				}
			case "MERGE_INVESTIGATIONS":
				log.Println("[WS] Received MERGE_INVESTIGATIONS request")
				payloadBytes, err := json.Marshal(msg["payload"])
				if err != nil {
					log.Printf("[WS Error] Failed to marshal MERGE_INVESTIGATIONS payload: %v", err)
					broadcast(models.WSMessage{Type: "ERROR", Payload: "Invalid merge payload"})
					continue
				}
				var payload models.MergeInvestigationsPayload
				if err := json.Unmarshal(payloadBytes, &payload); err != nil {
					log.Printf("[WS Error] Failed to unmarshal MERGE_INVESTIGATIONS payload: %v", err)
					broadcast(models.WSMessage{Type: "ERROR", Payload: "Invalid merge payload"})
					continue
				}

				go func() {
					if err := br.CreateMergedInvestigation(context.Background(), payload); err != nil {
						log.Printf("[WS Error] CreateMergedInvestigation failed: %v", err)
						broadcast(models.WSMessage{Type: "ERROR", Payload: "Merge investigation failed: " + err.Error()})
					}
				}()
			}
		}
	}
}
