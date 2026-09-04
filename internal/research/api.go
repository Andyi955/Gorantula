package research

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Andyi955/Gorantula/models"
)

// HandleAPI serves the research corpus endpoints.
//
//	GET  /api/research/papers  -> []models.Paper
//	GET  /api/research/claims  -> []models.Claim
//	POST /api/research/ingest  -> {"papers":[...], "claims":[...]}
func HandleAPI(w http.ResponseWriter, r *http.Request, service *Service) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 || parts[0] != "api" || parts[1] != "research" {
		http.NotFound(w, r)
		return
	}

	switch {
	case len(parts) == 3 && parts[2] == "papers" && r.Method == http.MethodGet:
		papers, err := service.ListPapers()
		if err != nil {
			httpError(w, err)
			return
		}
		_ = json.NewEncoder(w).Encode(papers)

	case len(parts) == 3 && parts[2] == "claims" && r.Method == http.MethodGet:
		claims, err := service.ListClaims()
		if err != nil {
			httpError(w, err)
			return
		}
		_ = json.NewEncoder(w).Encode(claims)

	case len(parts) == 3 && parts[2] == "relations" && r.Method == http.MethodGet:
		relations, err := service.ListRelations()
		if err != nil {
			httpError(w, err)
			return
		}
		_ = json.NewEncoder(w).Encode(relations)

	case len(parts) == 3 && parts[2] == "signals" && r.Method == http.MethodGet:
		signals, err := service.ListSignals()
		if err != nil {
			httpError(w, err)
			return
		}
		_ = json.NewEncoder(w).Encode(signals)

	case len(parts) == 3 && parts[2] == "ingest" && r.Method == http.MethodPost:
		handleIngest(w, r, service)

	default:
		http.NotFound(w, r)
	}
}

func handleIngest(w http.ResponseWriter, r *http.Request, service *Service) {
	type ingestRequest struct {
		Papers []models.Paper `json:"papers"`
	}
	var req ingestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.Papers) == 0 {
		http.Error(w, "no papers provided", http.StatusBadRequest)
		return
	}

	claims, err := service.IngestPapers(r.Context(), req.Papers)
	if err != nil {
		httpError(w, err)
		return
	}
	if claims == nil {
		claims = []models.Claim{}
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"papers": req.Papers,
		"claims": claims,
	})
}

func httpError(w http.ResponseWriter, err error) {
	http.Error(w, err.Error(), http.StatusInternalServerError)
}
