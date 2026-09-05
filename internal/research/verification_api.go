package research

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/Andyi955/Gorantula/models"
)

func decodeStrictJSON(data []byte, target interface{}) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		return err
	}
	if err := d.Decode(new(interface{})); err != io.EOF {
		return fmt.Errorf("expected one JSON object")
	}
	return nil
}

// These new endpoints reject cross-site browser calls and require JSON for
// mutations, so visiting a web page cannot launch local calculations or import
// files. CLI access without Origin remains supported.
func handleVerificationAPI(w http.ResponseWriter, r *http.Request, s *Service) bool {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 || parts[0] != "api" || parts[1] != "research" || (parts[2] != "datasets" && parts[2] != "verify" && parts[2] != "runs") {
		return false
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1") {
			http.Error(w, "local origin required", http.StatusForbidden)
			return true
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	respond := func(value interface{}, err error) {
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, os.ErrNotExist) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
		} else {
			_ = json.NewEncoder(w).Encode(value)
		}
	}
	read := func(target interface{}) bool {
		media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if media != "application/json" {
			http.Error(w, "application/json required", http.StatusUnsupportedMediaType)
			return false
		}
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16*maxDatasetBytes))
		if err == nil {
			err = decodeStrictJSON(data, target)
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return false
		}
		return true
	}
	switch {
	case len(parts) == 4 && parts[2] == "datasets" && parts[3] == "pdf-files" && r.Method == http.MethodPost:
		var req struct {
			Name string `json:"name"`
			Data []byte `json:"data"`
		}
		if !read(&req) {
			return true
		}
		if len(req.Name) == 0 || len(req.Name) > 200 || len(req.Data) > maxPDFBytes || !bytes.HasPrefix(req.Data, []byte("%PDF-")) {
			http.Error(w, "provide a named PDF up to 10 MiB", http.StatusBadRequest)
			break
		}
		id := digestBytes(req.Data)
		doc := models.ResearchDocument{Name: req.Name, URL: "local-pdf:" + id, Digest: id, Bytes: req.Data}
		err := s.verificationStore("documents").saveSlice(id+".json", doc)
		respond(map[string]string{"url": doc.URL, "name": req.Name}, err)
	case len(parts) == 4 && parts[2] == "datasets" && parts[3] == "tools" && r.Method == http.MethodPost:
		var req preparationRequest
		if !read(&req) {
			return true
		}
		value, err := s.prepareResearchData(r.Context(), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
		} else {
			respond(value, nil)
		}
	case len(parts) == 5 && parts[2] == "datasets" && parts[3] == "preparations" && r.Method == http.MethodGet:
		if !verificationID.MatchString(parts[4]) {
			http.NotFound(w, r)
			break
		}
		var run models.VerificationRun
		err := s.verificationStore("preparations").readJSON(parts[4]+".json", &run)
		if err == nil && run.ID != parts[4] {
			http.NotFound(w, r)
			break
		}
		w.Header().Set("Content-Disposition", `attachment; filename="preparation-`+parts[4]+`.json"`)
		respond(run, err)
	case len(parts) == 5 && parts[2] == "datasets" && parts[4] == "inspect" && r.Method == http.MethodGet:
		d, err := s.loadDataset(parts[3])
		if err != nil {
			respond(nil, err)
			break
		}
		result, err := inspectDataset(d)
		respond(result, err)
	case len(parts) == 4 && parts[2] == "datasets" && parts[3] == "import-url" && r.Method == http.MethodPost:
		var req struct {
			Name string `json:"name"`
			URL  string `json:"url"`
		}
		if !read(&req) {
			return true
		}
		data, source, err := fetchDatasetURL(r.Context(), req.URL)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			break
		}
		d, err := s.RegisterDataset(req.Name, source+" (remote CSV; origin unverified)", string(data))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			break
		}
		d.CSV = ""
		respond(d, nil)
	case len(parts) == 3 && parts[2] == "datasets" && r.Method == http.MethodGet:
		value, err := s.ListDatasets()
		respond(value, err)
	case len(parts) == 3 && parts[2] == "datasets" && r.Method == http.MethodPost:
		var req struct {
			Name   string `json:"name"`
			Source string `json:"source"`
			CSV    string `json:"csv"`
		}
		if !read(&req) {
			return true
		}
		d, err := s.RegisterDataset(req.Name, req.Source, req.CSV)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
		} else {
			d.CSV = ""
			w.WriteHeader(http.StatusCreated)
			respond(d, nil)
		}
	case len(parts) == 3 && parts[2] == "verify" && r.Method == http.MethodPost:
		var req models.VerificationRequest
		if !read(&req) {
			return true
		}
		run, err := s.StartVerification(req)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, ErrVerificationBusy) {
				status = http.StatusTooManyRequests
			}
			http.Error(w, err.Error(), status)
		} else {
			run.Dataset.CSV = ""
			w.WriteHeader(http.StatusAccepted)
			respond(run, nil)
		}
	case len(parts) == 3 && parts[2] == "runs" && r.Method == http.MethodGet:
		runs, err := s.ListVerificationRuns()
		respond(runs, err)
	case len(parts) == 4 && parts[2] == "runs" && r.Method == http.MethodGet:
		run, err := s.GetVerificationRun(parts[3])
		respond(run, err)
	case len(parts) == 5 && parts[2] == "runs" && parts[4] == "bundle" && r.Method == http.MethodGet:
		run, err := s.GetVerificationRun(parts[3])
		if err == nil {
			w.Header().Set("Content-Disposition", `attachment; filename="verification-`+run.ID+`.json"`)
		}
		respond(run, err)
	case len(parts) == 5 && parts[2] == "runs" && parts[4] == "cancel" && r.Method == http.MethodPost:
		var req struct{}
		if !read(&req) {
			return true
		}
		err := s.CancelVerification(parts[3])
		if err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
		} else {
			respond(map[string]bool{"cancelRequested": true}, nil)
		}
	default:
		http.NotFound(w, r)
	}
	return true
}
