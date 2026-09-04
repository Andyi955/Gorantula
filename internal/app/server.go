package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/joho/godotenv"
	"github.com/ncruces/zenity"

	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/internal/assets"
	"github.com/Andyi955/Gorantula/internal/brainmemory"
	"github.com/Andyi955/Gorantula/internal/config"
	"github.com/Andyi955/Gorantula/internal/investigations"
	"github.com/Andyi955/Gorantula/internal/pipeline"
	"github.com/Andyi955/Gorantula/internal/research"
	"github.com/Andyi955/Gorantula/internal/settings"
	"github.com/Andyi955/Gorantula/models"
	"github.com/Andyi955/Gorantula/nervous_system"
)

func Run() error {
	_ = godotenv.Load() // Loads .env if it exists

	abdomen := &models.Abdomen{}
	ns := nervous_system.NewNervousSystem(broadcast)
	br, err := brain.NewBrain(ns, abdomen)
	if err != nil {
		return fmt.Errorf("startup error: %w", err)
	}
	brainMemoryService := brainmemory.NewService("abdomen_vault")
	brainMemoryService.SetSourceEvidenceFinder(brainSourceEvidenceFinder{runner: ns})

	// Pipeline parallelism: the persona/relationship/discovery pipeline
	// starts the moment crawl evidence is summarized, running concurrently
	// with fact ranking + report generation. The run-scoped connect-dots
	// claim makes the frontend's later CONNECT_DOTS a no-op.
	br.SetNodesReadyHook(func(vaultID string, nodes []models.MemoryNode, runID string) {
		triggerConnectDotsAnalysis(br, vaultID, nodes, nil, pipeline.RunMetadata{
			RunID:   runID,
			VaultID: vaultID,
			Mode:    "analysis",
		})
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleConnections(w, r, br)
	})
	mux.HandleFunc("/vault-assets/", assets.HandleVaultAsset)
	mux.HandleFunc("/api/pipeline-runs", pipeline.HandleRuns)
	mux.HandleFunc("/api/pipeline-runs/", pipeline.HandleRuns)
	mux.HandleFunc("/api/investigations", func(w http.ResponseWriter, r *http.Request) {
		investigations.HandleAPI(w, r, br, brainEvidenceNotifier(brainMemoryService))
	})
	mux.HandleFunc("/api/investigations/", func(w http.ResponseWriter, r *http.Request) {
		investigations.HandleAPI(w, r, br, brainEvidenceNotifier(brainMemoryService))
	})
	registerBrainMemoryRoutes(mux, brainMemoryService)

	// Research corpus engine (Phase 0: ingest + claim extraction + listing).
	researchService := research.NewService("research_corpus", br)
	mux.HandleFunc("/api/research", func(w http.ResponseWriter, r *http.Request) {
		research.HandleAPI(w, r, researchService)
	})
	mux.HandleFunc("/api/research/", func(w http.ResponseWriter, r *http.Request) {
		research.HandleAPI(w, r, researchService)
	})

	mux.HandleFunc("/api/pick-files", func(w http.ResponseWriter, r *http.Request) {
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
			appLog("server").Error("file picker failed", "err", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(paths)
	})

	mux.HandleFunc("/api/vault-files", func(w http.ResponseWriter, r *http.Request) {
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
			appLog("server").Error("failed to list vault files", "err", err)
		}

		// Sort newest first
		sort.Slice(files, func(i, j int) bool {
			return files[i].ModTime > files[j].ModTime
		})

		json.NewEncoder(w).Encode(files)
	})

	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		envFile := ".env"
		var envMutex sync.Mutex
		settings.Handle(w, r, envFile, &envMutex, br)
	})

	address := config.ListenAddress()
	appLog("server").Info("backend listening", "address", address, "url", "http://"+address)
	return http.ListenAndServe(address, mux)
}

func registerBrainMemoryRoutes(mux *http.ServeMux, brainMemoryService *brainmemory.Service) {
	mux.HandleFunc("/api/brain/signals", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/signals/", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/links", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/links/", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/map", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/clusters", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/clusters/", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/gateways", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/gateways/", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/suggestions", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/suggestions/", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/attention", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/followups", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/followups/", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/autonomy", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
	mux.HandleFunc("/api/brain/autonomy/", func(w http.ResponseWriter, r *http.Request) {
		brainmemory.HandleAPI(w, r, brainMemoryService)
	})
}
