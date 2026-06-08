package assets

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
)

const maxNodeImageUploadBodyBytes = 12 << 20

func HandleNodeImageUpload(w http.ResponseWriter, r *http.Request, br *brain.Brain) {
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

func IsAllowedVaultImageExtension(extension string) bool {
	switch strings.ToLower(strings.TrimSpace(extension)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
		return true
	default:
		return false
	}
}

func HandleVaultAsset(w http.ResponseWriter, r *http.Request) {
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
	if !IsAllowedVaultImageExtension(filepath.Ext(targetPath)) {
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
