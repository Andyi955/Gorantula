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

	mapRequest := httptest.NewRequest(http.MethodOptions, "/api/brain/map?investigationId=inv-current", nil)
	mapRecorder := httptest.NewRecorder()
	mux.ServeHTTP(mapRecorder, mapRequest)

	if mapRecorder.Code != http.StatusNoContent {
		t.Fatalf("expected map preflight to route through brain memory handler, got %d", mapRecorder.Code)
	}
	if got := mapRecorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected map route to include CORS header, got %q", got)
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

	attentionRequest := httptest.NewRequest(http.MethodOptions, "/api/brain/attention?investigationId=inv-current", nil)
	attentionRecorder := httptest.NewRecorder()
	mux.ServeHTTP(attentionRecorder, attentionRequest)

	if attentionRecorder.Code != http.StatusNoContent {
		t.Fatalf("expected attention preflight to route through brain memory handler, got %d", attentionRecorder.Code)
	}
	if got := attentionRecorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected attention route to include CORS header, got %q", got)
	}

	followUpRequest := httptest.NewRequest(http.MethodOptions, "/api/brain/followups?investigationId=inv-current", nil)
	followUpRecorder := httptest.NewRecorder()
	mux.ServeHTTP(followUpRecorder, followUpRequest)

	if followUpRecorder.Code != http.StatusNoContent {
		t.Fatalf("expected follow-up preflight to route through brain memory handler, got %d", followUpRecorder.Code)
	}
	if got := followUpRecorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected follow-up route to include CORS header, got %q", got)
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

	followUpActionRequest := httptest.NewRequest(http.MethodPut, "/api/brain/followups/missing/launch", nil)
	followUpActionRecorder := httptest.NewRecorder()
	mux.ServeHTTP(followUpActionRecorder, followUpActionRequest)

	if followUpActionRecorder.Code != http.StatusNotFound {
		t.Fatalf("expected slash follow-up action to route through brain memory handler, got %d", followUpActionRecorder.Code)
	}
	if got := followUpActionRecorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected slash follow-up action to include CORS header, got %q", got)
	}
}
