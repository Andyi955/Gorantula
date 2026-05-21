package investigations

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"spider-agent/brain"
	"spider-agent/internal/assets"
	"spider-agent/models"
)

var relationshipLogConnectionLinePattern = regexp.MustCompile(`^(.+?) -> (.+?) \[(.+?)\] confidence=([0-9.]+) quality=([0-9.]+)$`)

func Store() *models.InvestigationStore {
	return models.NewInvestigationStore("abdomen_vault")
}

func SaveRelationshipResult(result models.RelationshipResult) {
	if strings.TrimSpace(result.VaultID) == "" {
		return
	}
	raw, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		log.Printf("[WS Warning] Failed to marshal relationship result for vault=%s run=%s: %v", result.VaultID, result.RunID, err)
		return
	}
	if err := Store().SaveJSON(result.VaultID, models.InvestigationRelationshipsFilename, raw); err != nil {
		log.Printf("[WS Warning] Failed to persist relationship result for vault=%s run=%s: %v", result.VaultID, result.RunID, err)
	}
}

func HandleAPI(w http.ResponseWriter, r *http.Request, br *brain.Brain) {
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
		assets.HandleNodeImageUpload(w, r, br)
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
	case "relationships":
		handleInvestigationRelationships(w, r, investigationID)
	default:
		http.NotFound(w, r)
	}
}

func emptyRelationshipResult(investigationID string) json.RawMessage {
	emptyRelationships, _ := json.Marshal(models.RelationshipResult{
		VaultID:     investigationID,
		Connections: []models.BoardConnection{},
	})
	return emptyRelationships
}

func handleInvestigationRelationships(w http.ResponseWriter, r *http.Request, investigationID string) {
	store := Store()

	switch r.Method {
	case http.MethodGet:
		payload, err := store.LoadJSON(investigationID, models.InvestigationRelationshipsFilename)
		if err == nil {
			w.Write(payload)
			return
		}
		if errors.Is(err, models.ErrInvestigationNotFound) {
			if result, ok := loadLatestRelationshipResultFromLog(investigationID); ok {
				SaveRelationshipResult(result)
				raw, marshalErr := json.Marshal(result)
				if marshalErr != nil {
					http.Error(w, marshalErr.Error(), http.StatusInternalServerError)
					return
				}
				w.Write(raw)
				return
			}
			w.Write(emptyRelationshipResult(investigationID))
			return
		}
		if errors.Is(err, models.ErrInvalidInvestigationID) {
			http.Error(w, "invalid investigation id", http.StatusBadRequest)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
	case http.MethodPut:
		handleInvestigationJSON(w, r, investigationID, models.InvestigationRelationshipsFilename, emptyRelationshipResult(investigationID))
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func loadLatestRelationshipResultFromLog(vaultID string) (models.RelationshipResult, bool) {
	if !models.ValidInvestigationID(vaultID) {
		return models.RelationshipResult{}, false
	}

	matches, err := filepath.Glob(filepath.Join("abdomen_vault", "relationship_logs", vaultID+"-*.txt"))
	if err != nil || len(matches) == 0 {
		return models.RelationshipResult{}, false
	}
	sort.Strings(matches)
	for index := len(matches) - 1; index >= 0; index-- {
		data, err := os.ReadFile(matches[index])
		if err != nil {
			continue
		}
		result := parseRelationshipResultLog(vaultID, string(data))
		if len(result.Connections) > 0 {
			return result, true
		}
	}
	return models.RelationshipResult{}, false
}

func parseRelationshipResultLog(vaultID string, logText string) models.RelationshipResult {
	result := models.RelationshipResult{
		VaultID:     vaultID,
		Connections: []models.BoardConnection{},
	}

	lines := strings.Split(logText, "\n")
	inFinalConnections := false
	for index := 0; index < len(lines); index++ {
		line := strings.TrimSpace(lines[index])
		if strings.HasPrefix(line, "Generated:") && result.CreatedAt == "" {
			result.CreatedAt = strings.TrimSpace(strings.TrimPrefix(line, "Generated:"))
			continue
		}
		if line == "=== Final Connections ===" {
			inFinalConnections = true
			continue
		}
		if inFinalConnections && strings.HasPrefix(line, "===") {
			break
		}
		if !inFinalConnections || line == "" {
			continue
		}

		matches := relationshipLogConnectionLinePattern.FindStringSubmatch(line)
		if len(matches) != 6 {
			continue
		}

		confidence, _ := strconv.ParseFloat(matches[4], 32)
		quality, _ := strconv.ParseFloat(matches[5], 32)
		connection := models.BoardConnection{
			VaultID:      vaultID,
			Source:       strings.TrimSpace(matches[1]),
			Target:       strings.TrimSpace(matches[2]),
			Tag:          strings.TrimSpace(matches[3]),
			Confidence:   float32(confidence),
			QualityScore: float32(quality),
		}

		if index+1 < len(lines) {
			reasoningLine := strings.TrimSpace(lines[index+1])
			if strings.HasPrefix(reasoningLine, "Reasoning:") {
				connection.Reasoning = strings.TrimSpace(strings.TrimPrefix(reasoningLine, "Reasoning:"))
				index++
			}
		}
		if index+1 < len(lines) {
			metadataLine := strings.TrimSpace(lines[index+1])
			if strings.HasPrefix(metadataLine, "Personas:") {
				parseRelationshipLogMetadata(metadataLine, &connection)
				index++
			}
		}
		result.Connections = append(result.Connections, connection)
	}

	return result
}

func parseRelationshipLogMetadata(line string, connection *models.BoardConnection) {
	line = strings.TrimSpace(strings.TrimPrefix(line, "Personas:"))
	parts := strings.SplitN(line, "| EvidenceNodes:", 2)
	if len(parts) > 0 {
		connection.SupportingPersonas = splitRelationshipLogList(parts[0])
	}
	if len(parts) > 1 {
		connection.EvidenceNodeIDs = splitRelationshipLogList(parts[1])
	}
}

func splitRelationshipLogList(value string) []string {
	parts := strings.Split(value, ",")
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			cleaned = append(cleaned, part)
		}
	}
	return cleaned
}

func handleInvestigationCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	records, err := Store().List()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(records)
}

func handleInvestigationMetadata(w http.ResponseWriter, r *http.Request, investigationID string) {
	store := Store()

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
	store := Store()

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
