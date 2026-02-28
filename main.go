package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"

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
			case "CONNECT_DOTS":
				log.Println("[WS] Received CONNECT_DOTS request")
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
						log.Printf("[WS] Persona %s: nodeIDs=%v", insight.PersonaName, insight.NodeIDs)
					}
					// Broadcast insights to frontend
					broadcast(models.WSMessage{Type: "PERSONA_INSIGHTS", Payload: insights})

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

	port := "8080"
	fmt.Printf("Gorantula Backend running on :%s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
