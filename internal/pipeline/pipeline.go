package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"spider-agent/models"
)

const pipelineProfileRetention = 100

var (
	pipelineTrackers      sync.Map
	pipelineCancellations sync.Map
)

type RunMetadata struct {
	RunID   string
	VaultID string
	Mode    string
}

type cancellation struct {
	vaultID string
	cancel  context.CancelFunc
}

func ExtractRunMetadata(msg map[string]interface{}, fallbackVaultID, mode string) RunMetadata {
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

	return RunMetadata{
		RunID:   runID,
		VaultID: vaultID,
		Mode:    strings.TrimSpace(mode),
	}
}

func NewTracker(meta RunMetadata, steps []models.PipelineProgressStep) *models.PipelineProgressTracker {
	tracker := models.NewPipelineProgressTracker(meta.RunID, meta.VaultID, meta.Mode, steps)
	if meta.RunID != "" {
		pipelineTrackers.Store(meta.RunID, tracker)
	}
	return tracker
}

func GetTracker(meta RunMetadata, steps []models.PipelineProgressStep) *models.PipelineProgressTracker {
	if meta.RunID != "" {
		if tracker, ok := LookupTracker(meta.RunID); ok {
			return tracker
		}
	}
	return NewTracker(meta, steps)
}

func LookupTracker(runID string) (*models.PipelineProgressTracker, bool) {
	if strings.TrimSpace(runID) == "" {
		return nil, false
	}
	existing, ok := pipelineTrackers.Load(runID)
	if !ok {
		return nil, false
	}
	tracker, ok := existing.(*models.PipelineProgressTracker)
	return tracker, ok
}

func ForgetTracker(runID string) {
	if strings.TrimSpace(runID) != "" {
		pipelineTrackers.Delete(runID)
	}
}

func RegisterCancellation(meta RunMetadata, cancel context.CancelFunc) {
	runID := strings.TrimSpace(meta.RunID)
	if runID == "" || cancel == nil {
		return
	}
	pipelineCancellations.Store(runID, cancellation{
		vaultID: strings.TrimSpace(meta.VaultID),
		cancel:  cancel,
	})
}

func CancelRun(runID, vaultID string) bool {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return false
	}
	value, ok := pipelineCancellations.Load(runID)
	if !ok {
		return false
	}
	registration, ok := value.(cancellation)
	if !ok {
		pipelineCancellations.Delete(runID)
		return false
	}
	vaultID = strings.TrimSpace(vaultID)
	if vaultID != "" && registration.vaultID != "" && vaultID != registration.vaultID {
		return false
	}
	registration.cancel()
	pipelineCancellations.Delete(runID)
	return true
}

func ForgetCancellation(runID string) {
	if strings.TrimSpace(runID) != "" {
		pipelineCancellations.Delete(runID)
	}
}

func ResetCancellationRegistryForTest() {
	pipelineCancellations.Range(func(key, value interface{}) bool {
		pipelineCancellations.Delete(key)
		return true
	})
}

func IsCancellationError(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

func ProfileStore() *models.PipelineProfileStore {
	return models.NewPipelineProfileStore(filepath.Join("abdomen_vault", "pipeline_runs"), pipelineProfileRetention)
}

func HandleRuns(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimRight(r.URL.Path, "/")
	store := ProfileStore()
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
