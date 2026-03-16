package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
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
			triggerCrawl(br, prompt)
		} else if msgType, ok := msg["type"].(string); ok {
			switch msgType {
			case "CRAWL":
				if prompt, ok := msg["payload"].(string); ok {
					triggerCrawl(br, prompt)
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
					triggerLocalCrawl(br, filePaths)
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

				log.Printf("[WS] Dispatching multi-agent persona analysis for %d nodes...", len(nodes))
				go func() {
					// Step 1: Run persona analysis
					broadcast(models.WSMessage{Type: "BRAIN_STATE", Payload: "Running multi-agent persona analysis..."})
					insights, err := br.AnalyzeWithPersonas(context.Background(), nodes)
					if err != nil {
						log.Printf("[WS Error] AnalyzeWithPersonas failed: %v", err)
						broadcast(models.WSMessage{Type: "ERROR", Payload: "Persona analysis failed: " + err.Error()})
						// Fall back to standard analysis
						connections, fallbackErr := br.AnalyzeConnections(context.Background(), nodes)
						if fallbackErr != nil {
							broadcast(models.WSMessage{Type: "ERROR", Payload: "AI analysis failed: " + fallbackErr.Error()})
						} else {
							broadcast(models.WSMessage{Type: "CONNECTIONS_FOUND", Payload: connections})
						}
						return
					}

					// Debug: Log insights before broadcasting
					for _, insight := range insights {
						log.Printf("[WS] Persona %s: nodeIDs=%v, keyFindings=%d", insight.PersonaName, insight.NodeIDs, len(insight.KeyFindings))
					}
					// Broadcast insights to frontend
					broadcast(models.WSMessage{Type: "PERSONA_INSIGHTS", Payload: insights})

					// Trigger Cross-Case Synthesis using Entity Hunter extracted entities
					var entities []string
					for _, insight := range insights {
						if insight.PersonaName == "Entity Hunter" {
							entities = append(entities, insight.KeyFindings...)
						}
					}

					log.Printf("[Synthesis] Triggering overlaps check with %d entities for %d nodes", len(entities), len(nodes))
					if len(entities) > 0 && len(nodes) > 0 {
						if vaultID == "" {
							// Fallback: Create a unique case ID based on the node timestamp piece if not provided
							parts := strings.Split(nodes[0].ID, "-")
							vaultID = "case-" + time.Now().Format("2006-01-02-150405")
							if len(parts) >= 2 {
								vaultID = "case-" + parts[1]
							}
						}
						go br.Synthesis.AnalyzeOverlap(context.Background(), entities, vaultID, nodes, br)
					}

					// Step 2: Synthesize insights into final connections
					broadcast(models.WSMessage{Type: "BRAIN_STATE", Payload: "Synthesizing persona insights..."})
					connections, err := br.SynthesizePersonaInsights(context.Background(), nodes, insights)
					if err != nil {
						log.Printf("[WS Error] SynthesizePersonaInsights failed: %v", err)
						broadcast(models.WSMessage{Type: "ERROR", Payload: "Synthesis failed: " + err.Error()})
						return
					}

					log.Printf("[WS] Analysis complete. Broadcasting %d connections.", len(connections))
					broadcast(models.WSMessage{Type: "CONNECTIONS_FOUND", Payload: connections})
				}()
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
			}
		}
	}
}

func triggerCrawl(br *brain.Brain, prompt string) {
	go func() {
		_, err := br.ProcessPrompt(context.Background(), prompt)
		if err != nil {
			broadcast(models.WSMessage{
				Type:    "ERROR",
				Payload: err.Error(),
			})
		}
	}()
}

func triggerLocalCrawl(br *brain.Brain, filePaths []string) {
	go func() {
		_, err := br.ProcessLocalFiles(context.Background(), filePaths)
		if err != nil {
			broadcast(models.WSMessage{
				Type:    "ERROR",
				Payload: err.Error(),
			})
		}
	}()
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
		targetKeys := []string{
			"GEMINI_API_KEY", "MINIMAX_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
			"OLLAMA_HOST", "DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "ZHIPUAI_API_KEY",
			"MOONSHOT_API_KEY", "LM_API_TOKEN",
		}
		for _, k := range targetKeys {
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
