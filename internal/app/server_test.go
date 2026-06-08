package app

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/Andyi955/Gorantula/internal/brainmemory"
)

func TestBrainMemoryRoutesIncludeClustersAndLinkActions(t *testing.T) {
	service := brainmemory.NewService(filepath.Join(t.TempDir(), "abdomen_vault"))
	mux := http.NewServeMux()
	registerBrainMemoryRoutes(mux, service)

	clusterRequest := httptest.NewRequest(http.MethodOptions, "/api/brain/clusters?investigationId=inv-current", nil)
	clusterRecorder := httptest.NewRecorder()
	mux.ServeHTTP(clusterRecorder, clusterRequest)

	if clusterRecorder.Code != http.StatusNoContent {
		t.Fatalf("expected clusters preflight to route through brain memory handler, got %d", clusterRecorder.Code)
	}
	if got := clusterRecorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected clusters route to include CORS header, got %q", got)
	}

	suggestionRequest := httptest.NewRequest(http.MethodOptions, "/api/brain/suggestions?investigationId=inv-current", nil)
	suggestionRecorder := httptest.NewRecorder()
	mux.ServeHTTP(suggestionRecorder, suggestionRequest)

	if suggestionRecorder.Code != http.StatusNoContent {
		t.Fatalf("expected suggestions preflight to route through brain memory handler, got %d", suggestionRecorder.Code)
	}
	if got := suggestionRecorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected suggestions route to include CORS header, got %q", got)
	}

	linkRequest := httptest.NewRequest(http.MethodPut, "/api/brain/links/missing/forget", nil)
	linkRecorder := httptest.NewRecorder()
	mux.ServeHTTP(linkRecorder, linkRequest)

	if linkRecorder.Code != http.StatusNotFound {
		t.Fatalf("expected slash link action to route through brain memory handler, got %d", linkRecorder.Code)
	}
	if got := linkRecorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected slash link action to include CORS header, got %q", got)
	}

	suggestionActionRequest := httptest.NewRequest(http.MethodPut, "/api/brain/suggestions/missing/dismiss", nil)
	suggestionActionRecorder := httptest.NewRecorder()
	mux.ServeHTTP(suggestionActionRecorder, suggestionActionRequest)

	if suggestionActionRecorder.Code != http.StatusNotFound {
		t.Fatalf("expected slash suggestion action to route through brain memory handler, got %d", suggestionActionRecorder.Code)
	}
	if got := suggestionActionRecorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected slash suggestion action to include CORS header, got %q", got)
	}
}
