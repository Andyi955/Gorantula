package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
	"github.com/ncruces/zenity"

	"spider-agent/brain"
	"spider-agent/models"
	"spider-agent/nervous_system"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all for local dev
	},
}

var (
	clients          = make(map[*websocket.Conn]bool)
	clientsMu        sync.Mutex
	pipelineTrackers sync.Map
)

const maxNodeImageUploadBodyBytes = 12 << 20
const pipelineProfileRetention = 100

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

func extractScrapeImagesPreference(msg map[string]interface{}) bool {
	rawPreference, ok := msg["scrapeImages"]
	if !ok {
		return false
	}

	preference, ok := rawPreference.(bool)
	return ok && preference
}

type pipelineRunMetadata struct {
	RunID   string
	VaultID string
	Mode    string
}

func extractPipelineRunMetadata(msg map[string]interface{}, fallbackVaultID, mode string) pipelineRunMetadata {
	runID := ""
	if rawRunID, ok := msg["runId"].(string); ok {
		runID = strings.TrimSpace(rawRunID)
	}
	if runID == "" {
		runID = fmt.Sprintf("run-%d", time.Now().UnixNano())
	}

	vaultID := strings.TrimSpace(fallbackVaultID)
	if rawVaultID, ok := msg["vaultId"].(string); ok && strings.TrimSpace(rawVaultID) != "" {
		vaultID = strings.TrimSpace(rawVaultID)
	}

	return pipelineRunMetadata{
		RunID:   runID,
		VaultID: vaultID,
		Mode:    strings.TrimSpace(mode),
	}
}

func newPipelineTracker(meta pipelineRunMetadata, steps []models.PipelineProgressStep) *models.PipelineProgressTracker {
	tracker := models.NewPipelineProgressTracker(meta.RunID, meta.VaultID, meta.Mode, steps)
	if meta.RunID != "" {
		pipelineTrackers.Store(meta.RunID, tracker)
	}
	return tracker
}

func getPipelineTracker(meta pipelineRunMetadata, steps []models.PipelineProgressStep) *models.PipelineProgressTracker {
	if meta.RunID != "" {
		if existing, ok := pipelineTrackers.Load(meta.RunID); ok {
			if tracker, ok := existing.(*models.PipelineProgressTracker); ok {
				return tracker
			}
		}
	}
	return newPipelineTracker(meta, steps)
}

func forgetPipelineTracker(runID string) {
	if strings.TrimSpace(runID) != "" {
		pipelineTrackers.Delete(runID)
	}
}

func pipelineProfileStore() *models.PipelineProfileStore {
	return models.NewPipelineProfileStore(filepath.Join("abdomen_vault", "pipeline_runs"), pipelineProfileRetention)
}

func investigationStore() *models.InvestigationStore {
	return models.NewInvestigationStore("abdomen_vault")
}

func saveAndBroadcastPipelineProfile(tracker *models.PipelineProgressTracker) {
	if tracker == nil {
		return
	}

	profile := tracker.Profile()
	if strings.TrimSpace(profile.RunID) == "" {
		return
	}
	if err := pipelineProfileStore().Save(profile); err != nil {
		log.Printf("[PipelineProfile] failed to save profile for %s: %v", profile.RunID, err)
		return
	}
	broadcast(models.WSMessage{
		Type: models.PipelineProfileSavedMessageType,
		Payload: map[string]interface{}{
			"runId":          profile.RunID,
			"vaultId":        profile.VaultID,
			"status":         profile.Status,
			"totalElapsedMs": profile.TotalElapsedMs,
		},
	})
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
			triggerCrawl(br, prompt, "", false, false, extractPipelineRunMetadata(msg, "", "web"))
		} else if msgType, ok := msg["type"].(string); ok {
			switch msgType {
			case "CRAWL":
				if prompt, ok := msg["payload"].(string); ok {
					vaultID := ""
					if rawVaultID, ok := msg["vaultId"].(string); ok {
						vaultID = strings.TrimSpace(rawVaultID)
					}
					triggerCrawl(br, prompt, vaultID, false, extractScrapeImagesPreference(msg), extractPipelineRunMetadata(msg, vaultID, "web"))
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
					triggerCrawl(br, prompt, vaultID, true, extractScrapeImagesPreference(msg), extractPipelineRunMetadata(msg, vaultID, "web"))
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
					triggerLocalCrawl(br, filePaths, extractPipelineRunMetadata(msg, "", "local"))
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

				triggerConnectDotsAnalysis(br, vaultID, nodes, nil, extractPipelineRunMetadata(msg, vaultID, "analysis"))
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

				triggerConnectDotsAnalysis(br, vaultID, payload.AllNodes, pendingNodeIDs, extractPipelineRunMetadata(msg, vaultID, "analysis"))
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
							log.Printf("[WS] SYNC_VAULTS running PurgeOrphans for stale index entries...")
							br.Synthesis.PurgeOrphans(activeVaults)
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

func triggerCrawl(br *brain.Brain, prompt, vaultID string, appendToVault bool, scrapeImages bool, meta pipelineRunMetadata) {
	go func() {
		tracker := newPipelineTracker(meta, models.DefaultPipelineProgressSteps())
		var err error
		if appendToVault {
			_, err = br.ProcessPromptIntoVaultWithProgress(context.Background(), prompt, vaultID, scrapeImages, tracker)
		} else if strings.TrimSpace(vaultID) != "" {
			_, err = br.ProcessPromptForVaultWithProgress(context.Background(), prompt, vaultID, scrapeImages, tracker)
		} else {
			_, err = br.ProcessPromptWithProgress(context.Background(), prompt, scrapeImages, tracker)
		}
		if err != nil {
			broadcast(tracker.Error("complete", err.Error()))
			saveAndBroadcastPipelineProfile(tracker)
			forgetPipelineTracker(meta.RunID)
			broadcast(models.WSMessage{
				Type:    "ERROR",
				Payload: err.Error(),
			})
			return
		}
		saveAndBroadcastPipelineProfile(tracker)
	}()
}

func filterConnectionsByPendingNodeIDs(connections []models.BoardConnection, pendingNodeIDs []string) []models.BoardConnection {
	if len(pendingNodeIDs) == 0 {
		return connections
	}

	pendingNodeIDSet := make(map[string]struct{}, len(pendingNodeIDs))
	for _, nodeID := range pendingNodeIDs {
		pendingNodeIDSet[nodeID] = struct{}{}
	}

	filtered := make([]models.BoardConnection, 0, len(connections))
	for _, connection := range connections {
		if _, ok := pendingNodeIDSet[connection.Source]; ok {
			filtered = append(filtered, connection)
			continue
		}
		if _, ok := pendingNodeIDSet[connection.Target]; ok {
			filtered = append(filtered, connection)
		}
	}

	return filtered
}

func filterNodesByIDs(nodes []models.MemoryNode, nodeIDs []string) []models.MemoryNode {
	if len(nodeIDs) == 0 {
		return append([]models.MemoryNode(nil), nodes...)
	}

	nodeIDSet := make(map[string]struct{}, len(nodeIDs))
	for _, nodeID := range nodeIDs {
		nodeIDSet[nodeID] = struct{}{}
	}

	filtered := make([]models.MemoryNode, 0, len(nodeIDs))
	for _, node := range nodes {
		if _, ok := nodeIDSet[node.ID]; ok {
			filtered = append(filtered, node)
		}
	}

	return filtered
}

func triggerConnectDotsAnalysis(br *brain.Brain, vaultID string, nodes []models.MemoryNode, pendingNodeIDs []string, meta pipelineRunMetadata) {
	go func() {
		tracker := getPipelineTracker(meta, models.DefaultPipelineProgressSteps())
		isIncremental := len(pendingNodeIDs) > 0
		if isIncremental {
			log.Printf("[WS] Dispatching incremental persona analysis for %d nodes with %d pending nodes...", len(nodes), len(pendingNodeIDs))
		} else {
			log.Printf("[WS] Dispatching multi-agent persona analysis for %d nodes...", len(nodes))
		}

		broadcast(tracker.Start("persona_analysis", "Running multi-agent persona analysis"))
		broadcast(models.WSMessage{Type: "BRAIN_STATE", Payload: "Running multi-agent persona analysis..."})

		var (
			insights []brain.PersonaInsight
			err      error
		)
		tracker.StartSpan("persona_fanout", "persona_analysis", "Persona fanout", fmt.Sprintf("running %d personas", len(brain.GetDefaultPersonas())))
		if isIncremental {
			insights, err = br.AnalyzeIncrementalWithPersonasWithProgress(context.Background(), vaultID, nodes, pendingNodeIDs, tracker)
		} else {
			insights, err = br.AnalyzeWithPersonasWithProgress(context.Background(), vaultID, nodes, tracker)
		}
		tracker.CompleteSpan("persona_fanout", fmt.Sprintf("generated %d persona insight sets", len(insights)))
		if err != nil {
			log.Printf("[WS Error] Persona analysis failed: %v", err)
			broadcast(tracker.Error("persona_analysis", err.Error()))
			saveAndBroadcastPipelineProfile(tracker)
			forgetPipelineTracker(meta.RunID)
			broadcast(models.WSMessage{Type: "ERROR", Payload: "Persona analysis failed: " + err.Error()})

			connections, fallbackErr := br.AnalyzeConnections(context.Background(), nodes)
			if fallbackErr != nil {
				broadcast(models.WSMessage{Type: "ERROR", Payload: "AI analysis failed: " + fallbackErr.Error()})
			} else {
				validatedConnections, _ := br.ValidateFallbackConnections(vaultID, nodes, connections)
				if isIncremental {
					validatedConnections = filterConnectionsByPendingNodeIDs(validatedConnections, pendingNodeIDs)
				}
				broadcast(models.WSMessage{Type: "CONNECTIONS_FOUND", Payload: validatedConnections})
			}
			return
		}

		for _, insight := range insights {
			log.Printf("[WS] Persona %s: nodeIDs=%v, keyFindings=%d", insight.PersonaName, insight.NodeIDs, len(insight.KeyFindings))
		}

		broadcast(models.WSMessage{Type: "PERSONA_INSIGHTS", Payload: insights})
		broadcast(tracker.Complete("persona_analysis", fmt.Sprintf("Generated %d persona insight sets", len(insights))))
		tracker.RecordCounter("personaInsightSets", len(insights))
		saveAndBroadcastPipelineProfile(tracker)

		overlapCandidateNodes := nodes
		if isIncremental {
			overlapCandidateNodes = filterNodesByIDs(nodes, pendingNodeIDs)
		}

		log.Printf("[Synthesis] Triggering overlaps check with %d candidate nodes for %d total nodes", len(overlapCandidateNodes), len(nodes))
		broadcast(tracker.Start("overlap_scan", "Scanning for cross-case overlap"))
		if len(overlapCandidateNodes) > 0 && len(nodes) > 0 {
			go br.Synthesis.AnalyzeOverlap(context.Background(), vaultID, overlapCandidateNodes, nodes, br)
		}
		broadcast(tracker.Complete("overlap_scan", "Unified theory scan queued"))

		broadcast(tracker.Start("relationship_synthesis", "Synthesizing evidence relationships"))
		broadcast(models.WSMessage{Type: "BRAIN_STATE", Payload: "Synthesizing persona insights..."})

		var connections []models.BoardConnection
		relationshipCtx, relationshipScopeID := br.StartPipelineTokenScope(context.Background(), "pipeline-relationships", "relationship_synthesis")
		tracker.StartSpan("relationship_generation", "relationship_synthesis", "Relationship synthesis", fmt.Sprintf("linking %d nodes", len(nodes)))
		if isIncremental {
			connections, _, err = br.RunIncrementalRelationshipWorkflow(relationshipCtx, vaultID, nodes, pendingNodeIDs, insights)
		} else {
			connections, _, err = br.RunRelationshipWorkflow(relationshipCtx, vaultID, nodes, insights)
		}
		tracker.CompleteSpan("relationship_generation", fmt.Sprintf("found %d relationships", len(connections)))
		br.RecordPipelineTokenUsage(tracker, relationshipScopeID)
		if err != nil {
			log.Printf("[WS Error] Relationship workflow failed: %v", err)
			broadcast(tracker.Error("relationship_synthesis", err.Error()))
			saveAndBroadcastPipelineProfile(tracker)
			forgetPipelineTracker(meta.RunID)
			broadcast(models.WSMessage{Type: "ERROR", Payload: "Synthesis failed: " + err.Error()})
			return
		}

		log.Printf("[WS] Analysis complete. Broadcasting %d connections.", len(connections))
		broadcast(tracker.Complete("relationship_synthesis", fmt.Sprintf("Found %d relationships", len(connections))))
		tracker.RecordCounter("relationships", len(connections))
		broadcast(models.WSMessage{Type: "CONNECTIONS_FOUND", Payload: connections})
		saveAndBroadcastPipelineProfile(tracker)

		if isIncremental {
			broadcast(tracker.Complete("complete", "Incremental integration complete"))
			saveAndBroadcastPipelineProfile(tracker)
			forgetPipelineTracker(meta.RunID)
			return
		}

		nodesSnapshot := append([]models.MemoryNode(nil), nodes...)
		insightsSnapshot := append([]brain.PersonaInsight(nil), insights...)
		go func(vaultID string, nodes []models.MemoryNode, insights []brain.PersonaInsight) {
			broadcast(tracker.Start("discovery_review", "Reviewing breakthrough candidates"))
			discoveryCtx, discoveryScopeID := br.StartPipelineTokenScope(context.Background(), "pipeline-discovery", "discovery_synthesis")
			tracker.StartSpan("discovery_synthesis", "discovery_review", "Discovery candidate synthesis", fmt.Sprintf("reviewing %d nodes", len(nodes)))
			candidateDiscoveries, err := br.SynthesizeDiscoveries(discoveryCtx, vaultID, nodes, insights)
			tracker.CompleteSpan("discovery_synthesis", fmt.Sprintf("generated %d candidate discoveries", len(candidateDiscoveries)))
			br.RecordPipelineTokenUsage(tracker, discoveryScopeID)
			if err != nil {
				log.Printf("[WS Error] SynthesizeDiscoveries failed: %v", err)
				broadcast(tracker.Error("discovery_review", err.Error()))
				saveAndBroadcastPipelineProfile(tracker)
				forgetPipelineTracker(meta.RunID)
				return
			}
			tracker.RecordCounter("discoveryCandidates", len(candidateDiscoveries))

			reviewCtx, reviewScopeID := br.StartPipelineTokenScope(context.Background(), "pipeline-discovery-review", "discovery_review")
			tracker.StartSpan("discovery_candidate_review", "discovery_review", "Discovery expert review", fmt.Sprintf("reviewing %d candidates", len(candidateDiscoveries)))
			discoveries, err := br.ReviewDiscoveryCandidates(reviewCtx, candidateDiscoveries, nodes)
			tracker.CompleteSpan("discovery_candidate_review", fmt.Sprintf("approved %d discoveries", len(discoveries)))
			br.RecordPipelineTokenUsage(tracker, reviewScopeID)
			if err != nil {
				log.Printf("[WS Error] ReviewDiscoveryCandidates failed: %v", err)
				broadcast(tracker.Error("discovery_review", err.Error()))
				saveAndBroadcastPipelineProfile(tracker)
				forgetPipelineTracker(meta.RunID)
				return
			}

			if len(discoveries) > 0 {
				broadcast(models.WSMessage{Type: "DISCOVERIES_FOUND", Payload: discoveries})
			}
			tracker.RecordCounter("discoveries", len(discoveries))
			broadcast(tracker.Complete("discovery_review", fmt.Sprintf("Approved %d discoveries", len(discoveries))))
			broadcast(tracker.Complete("complete", "Pipeline complete"))
			saveAndBroadcastPipelineProfile(tracker)
			forgetPipelineTracker(meta.RunID)
		}(vaultID, nodesSnapshot, insightsSnapshot)
	}()
}

func triggerLocalCrawl(br *brain.Brain, filePaths []string, meta pipelineRunMetadata) {
	go func() {
		tracker := newPipelineTracker(meta, models.LocalPipelineProgressSteps())
		_, err := br.ProcessLocalFilesWithProgress(context.Background(), filePaths, tracker)
		if err != nil {
			broadcast(tracker.Error("complete", err.Error()))
			saveAndBroadcastPipelineProfile(tracker)
			forgetPipelineTracker(meta.RunID)
			broadcast(models.WSMessage{
				Type:    "ERROR",
				Payload: err.Error(),
			})
			return
		}
		saveAndBroadcastPipelineProfile(tracker)
	}()
}

func handleNodeImageUpload(w http.ResponseWriter, r *http.Request, br *brain.Brain) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/investigations/")
	parts := strings.Split(path, "/")
	if len(parts) != 4 || parts[1] != "nodes" || parts[3] != "images" {
		http.NotFound(w, r)
		return
	}

	vaultID := strings.TrimSpace(parts[0])
	nodeID := strings.TrimSpace(parts[2])
	if vaultID == "" || nodeID == "" {
		http.Error(w, "Missing vault or node id", http.StatusBadRequest)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxNodeImageUploadBodyBytes)
	var payload struct {
		FileName string `json:"fileName"`
		DataURL  string `json:"dataUrl"`
		Caption  string `json:"caption"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	image, err := br.AttachManualNodeImage(vaultID, nodeID, payload.FileName, payload.DataURL, payload.Caption)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"image": image,
	})
}

func isAllowedVaultImageExtension(extension string) bool {
	switch strings.ToLower(strings.TrimSpace(extension)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
		return true
	default:
		return false
	}
}

func handleVaultAsset(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")

	relativePath := strings.TrimPrefix(r.URL.Path, "/vault-assets/")
	if relativePath == "" {
		http.NotFound(w, r)
		return
	}

	pathParts := strings.Split(strings.ReplaceAll(relativePath, "\\", "/"), "/")
	if len(pathParts) < 3 {
		log.Printf("[VaultAssets] Invalid asset path: %s", r.URL.Path)
		http.NotFound(w, r)
		return
	}

	vaultID := strings.TrimSpace(pathParts[0])
	if !models.ValidInvestigationID(vaultID) || pathParts[1] != "images" {
		log.Printf("[VaultAssets] Invalid vault asset request: vault=%q path=%s", vaultID, r.URL.Path)
		http.NotFound(w, r)
		return
	}

	imageSubPath := strings.Join(pathParts[2:], "/")
	if imageSubPath == "" {
		log.Printf("[VaultAssets] Missing image asset path for vault=%s", vaultID)
		http.NotFound(w, r)
		return
	}

	root := filepath.Clean("abdomen_vault")
	vaultImagesRoot := filepath.Clean(filepath.Join(root, filepath.FromSlash(vaultID), "images"))
	targetPath := filepath.Clean(filepath.Join(vaultImagesRoot, filepath.FromSlash(imageSubPath)))
	if !strings.HasPrefix(targetPath, vaultImagesRoot+string(filepath.Separator)) && targetPath != vaultImagesRoot {
		log.Printf("[VaultAssets] Rejected traversal asset path: vault=%s subPath=%s", vaultID, imageSubPath)
		http.Error(w, "Invalid asset path", http.StatusBadRequest)
		return
	}
	if !isAllowedVaultImageExtension(filepath.Ext(targetPath)) {
		log.Printf("[VaultAssets] Rejected unsupported asset type: vault=%s subPath=%s", vaultID, imageSubPath)
		http.Error(w, "Unsupported asset type", http.StatusBadRequest)
		return
	}
	if _, err := os.Stat(targetPath); err != nil {
		if os.IsNotExist(err) {
			log.Printf("[VaultAssets] Missing image asset: vault=%s path=%s", vaultID, targetPath)
			http.NotFound(w, r)
			return
		}
		log.Printf("[VaultAssets] Failed to stat image asset: vault=%s path=%s err=%v", vaultID, targetPath, err)
		http.Error(w, "Failed to load asset", http.StatusInternalServerError)
		return
	}

	http.ServeFile(w, r, targetPath)
}

func handlePipelineRuns(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimRight(r.URL.Path, "/")
	store := pipelineProfileStore()
	if path == "/api/pipeline-runs" {
		limit := 20
		if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
			if parsed, err := strconv.Atoi(rawLimit); err == nil && parsed > 0 {
				limit = parsed
			}
		}
		if limit > 100 {
			limit = 100
		}
		profiles, err := store.List(limit)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(profiles)
		return
	}

	runID := strings.TrimPrefix(path, "/api/pipeline-runs/")
	if runID == "" || runID == path {
		http.NotFound(w, r)
		return
	}
	profile, err := store.Load(runID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	json.NewEncoder(w).Encode(profile)
}

func handleInvestigationAPI(w http.ResponseWriter, r *http.Request, br *brain.Brain) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET,PUT,DELETE,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	path := strings.Trim(r.URL.Path, "/")
	if path == "api/investigations" {
		handleInvestigationCatalog(w, r)
		return
	}

	parts := strings.Split(path, "/")
	if len(parts) == 6 &&
		parts[0] == "api" &&
		parts[1] == "investigations" &&
		parts[3] == "nodes" &&
		parts[5] == "images" {
		if !models.ValidInvestigationID(strings.TrimSpace(parts[2])) {
			http.Error(w, "invalid investigation id", http.StatusBadRequest)
			return
		}
		handleNodeImageUpload(w, r, br)
		return
	}

	if len(parts) < 3 || parts[0] != "api" || parts[1] != "investigations" {
		http.NotFound(w, r)
		return
	}

	investigationID := strings.TrimSpace(parts[2])
	if !models.ValidInvestigationID(investigationID) {
		http.Error(w, "invalid investigation id", http.StatusBadRequest)
		return
	}

	if len(parts) == 3 {
		handleInvestigationMetadata(w, r, investigationID)
		return
	}

	if len(parts) != 4 {
		http.NotFound(w, r)
		return
	}

	switch parts[3] {
	case "board":
		handleInvestigationJSON(w, r, investigationID, models.InvestigationBoardFilename, json.RawMessage(`{"mode":"strict-grid","nodes":[],"edges":[]}`))
	case "result":
		handleInvestigationJSON(w, r, investigationID, models.InvestigationResultFilename, json.RawMessage(`{}`))
	case "discoveries":
		handleInvestigationJSON(w, r, investigationID, models.InvestigationDiscoveryFilename, json.RawMessage(`[]`))
	default:
		http.NotFound(w, r)
	}
}

func handleInvestigationCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	records, err := investigationStore().List()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(records)
}

func handleInvestigationMetadata(w http.ResponseWriter, r *http.Request, investigationID string) {
	store := investigationStore()

	switch r.Method {
	case http.MethodGet:
		record, err := store.LoadMetadata(investigationID)
		if err != nil {
			if errors.Is(err, models.ErrInvestigationNotFound) {
				http.NotFound(w, r)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(record)
	case http.MethodPut:
		var record models.InvestigationRecord
		if err := json.NewDecoder(r.Body).Decode(&record); err != nil {
			http.Error(w, "invalid metadata json", http.StatusBadRequest)
			return
		}
		if record.ID == "" {
			record.ID = investigationID
		}
		if record.ID != investigationID {
			http.Error(w, "metadata id does not match route", http.StatusBadRequest)
			return
		}
		if err := store.SaveMetadata(record); err != nil {
			if errors.Is(err, models.ErrInvalidInvestigationID) {
				http.Error(w, "invalid investigation id", http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		normalized, _ := store.LoadMetadata(investigationID)
		json.NewEncoder(w).Encode(normalized)
	case http.MethodDelete:
		if err := store.Delete(investigationID); err != nil {
			if errors.Is(err, models.ErrInvalidInvestigationID) {
				http.Error(w, "invalid investigation id", http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleInvestigationJSON(w http.ResponseWriter, r *http.Request, investigationID, filename string, emptyPayload json.RawMessage) {
	store := investigationStore()

	switch r.Method {
	case http.MethodGet:
		payload, err := store.LoadJSON(investigationID, filename)
		if err != nil {
			if errors.Is(err, models.ErrInvestigationNotFound) {
				w.Write(emptyPayload)
				return
			}
			if errors.Is(err, models.ErrInvalidInvestigationID) {
				http.Error(w, "invalid investigation id", http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Write(payload)
	case http.MethodPut:
		body, err := io.ReadAll(io.LimitReader(r.Body, 25<<20))
		if err != nil {
			http.Error(w, "failed to read payload", http.StatusBadRequest)
			return
		}
		if len(body) == 0 || !json.Valid(body) {
			http.Error(w, "payload must be valid json", http.StatusBadRequest)
			return
		}
		if err := store.SaveJSON(investigationID, filename, body); err != nil {
			if errors.Is(err, models.ErrInvalidInvestigationID) {
				http.Error(w, "invalid investigation id", http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Write(body)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func main() {
	_ = godotenv.Load() // Loads .env if it exists

	abdomen := &models.Abdomen{}
	ns := nervous_system.NewNervousSystem(broadcast)
	br, err := brain.NewBrain(ns, abdomen)
	if err != nil {
		fmt.Printf("Startup Error: %v\n", err)
		os.Exit(1)
	}

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleConnections(w, r, br)
	})
	http.HandleFunc("/vault-assets/", handleVaultAsset)
	http.HandleFunc("/api/pipeline-runs", handlePipelineRuns)
	http.HandleFunc("/api/pipeline-runs/", handlePipelineRuns)
	http.HandleFunc("/api/investigations", func(w http.ResponseWriter, r *http.Request) {
		handleInvestigationAPI(w, r, br)
	})
	http.HandleFunc("/api/investigations/", func(w http.ResponseWriter, r *http.Request) {
		handleInvestigationAPI(w, r, br)
	})

	http.HandleFunc("/api/pick-files", func(w http.ResponseWriter, r *http.Request) {
		// Enable CORS for local dev
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")

		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		paths, err := zenity.SelectFileMultiple(
			zenity.Title("Select Local Documents & Case Files"),
			zenity.FileFilter{
				Name:     "Documents (PDF, DOCX, TXT)",
				Patterns: []string{"*.pdf", "*.docx", "*.txt"},
			},
		)

		if err != nil {
			if err == zenity.ErrCanceled {
				// User cancelled the dialog, just return an empty array
				json.NewEncoder(w).Encode([]string{})
				return
			}
			log.Printf("[Picker Error] %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(paths)
	})

	http.HandleFunc("/api/vault-files", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")

		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		type VaultFile struct {
			FileName string `json:"fileName"`
			FilePath string `json:"filePath"`
			ModTime  string `json:"modTime"`
		}

		var files []VaultFile
		vaultDir := filepath.Join(".", "abdomen_vault")

		if _, err := os.Stat(vaultDir); os.IsNotExist(err) {
			_ = os.MkdirAll(vaultDir, 0755)
			json.NewEncoder(w).Encode([]VaultFile{})
			return
		}

		// We will test if Vault works by just walking it
		err := filepath.Walk(vaultDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil // skip errors
			}
			if !info.IsDir() && strings.HasSuffix(info.Name(), ".md") {
				// use relative path nicely
				relPath, _ := filepath.Rel(vaultDir, path)

				files = append(files, VaultFile{
					FileName: relPath,
					FilePath: path,
					ModTime:  info.ModTime().Format(time.RFC3339),
				})
			}
			return nil
		})

		if err != nil {
			log.Printf("[Picker Error] %v", err)
		}

		// Sort newest first
		sort.Slice(files, func(i, j int) bool {
			return files[i].ModTime > files[j].ModTime
		})

		json.NewEncoder(w).Encode(files)
	})

	http.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		envFile := ".env"
		var envMutex sync.Mutex
		handleSettings(w, r, envFile, &envMutex, br)
	})

	port := "8080"
	fmt.Printf("Gorantula Backend running on :%s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

// handleSettings is extracted for testability
func handleSettings(w http.ResponseWriter, r *http.Request, envFile string, envMutex *sync.Mutex, br *brain.Brain) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method == http.MethodGet {
		envMap, err := godotenv.Read(envFile)
		if err != nil && !os.IsNotExist(err) {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if envMap == nil {
			envMap = make(map[string]string)
		}

		maskedMap := make(map[string]string)
		sensitiveKeys := []string{
			"GEMINI_API_KEY", "MINIMAX_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
			"DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "ZHIPUAI_API_KEY",
			"MOONSHOT_API_KEY", "LM_API_TOKEN",
		}
		for _, k := range sensitiveKeys {
			val := envMap[k]
			if val != "" {
				if len(val) > 4 {
					maskedMap[k] = val[:3] + "..." + val[len(val)-2:]
				} else {
					maskedMap[k] = "***"
				}
			} else {
				maskedMap[k] = ""
			}
		}

		passthroughKeys := []string{
			"OLLAMA_HOST",
			"LMSTUDIO_BASE_URL",
			"DEFAULT_SEARCH_MODEL",
			"DEFAULT_PERSONA_MODEL",
			"GEMINI_MODEL",
			"OPENAI_MODEL",
			"ANTHROPIC_MODEL",
			"DEEPSEEK_MODEL",
			"DASHSCOPE_MODEL",
			"ZHIPUAI_MODEL",
			"MOONSHOT_MODEL",
			"MINIMAX_MODEL",
			"OLLAMA_MODEL",
			"LMSTUDIO_MODEL",
		}
		for _, k := range passthroughKeys {
			maskedMap[k] = envMap[k]
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"keys": maskedMap})
		return
	}

	if r.Method == http.MethodPost {
		var payload struct {
			Keys map[string]string `json:"keys"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		envMutex.Lock()
		defer envMutex.Unlock()

		envMap, err := godotenv.Read(envFile)
		if err != nil {
			if os.IsNotExist(err) {
				envMap = make(map[string]string)
			} else {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}

		// Validate and apply keys
		for k, v := range payload.Keys {
			cleanVal := strings.TrimSpace(v) // Edge case 1: Trim accidental whitespace
			if cleanVal != "" && !strings.Contains(cleanVal, "...") {
				envMap[k] = cleanVal
				os.Setenv(k, cleanVal)
			} else if cleanVal == "" {
				// We only delete if it was explicitly sent as empty
				delete(envMap, k)
				os.Unsetenv(k)
			}
		}

		if err := godotenv.Write(envMap, envFile); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Edge Case 3: Dynamically reload the backend router mapping
		if br != nil {
			if err := br.ReloadModelProviders(); err != nil {
				log.Printf("[Settings Error] Failed to reload backend model router: %v", err)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"success"}`))
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	port := "8080"
	fmt.Printf("Gorantula Backend running on :%s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
