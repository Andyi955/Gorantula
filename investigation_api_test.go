package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestInvestigationAPIStoresMetadataAndBoardState(t *testing.T) {
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd failed: %v", err)
	}
	tempDir := t.TempDir()
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("Chdir failed: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(originalDir)
	})

	putMetadata := httptest.NewRequest(http.MethodPut, "/api/investigations/inv-1", strings.NewReader(`{
		"id":"inv-1",
		"topic":"Backend Case",
		"kind":"root",
		"parentIds":[],
		"childIds":[],
		"mergedFromIds":[],
		"primaryParentId":null,
		"displayTopic":"Backend Case"
	}`))
	putMetadata.Header.Set("Content-Type", "application/json")
	metadataRecorder := httptest.NewRecorder()
	handleInvestigationAPI(metadataRecorder, putMetadata, nil)
	if metadataRecorder.Code != http.StatusOK {
		t.Fatalf("metadata PUT status = %d, body = %s", metadataRecorder.Code, metadataRecorder.Body.String())
	}

	putBoard := httptest.NewRequest(http.MethodPut, "/api/investigations/inv-1/board", strings.NewReader(`{"mode":"strict-grid","nodes":[{"id":"node-1"}],"edges":[]}`))
	putBoard.Header.Set("Content-Type", "application/json")
	boardRecorder := httptest.NewRecorder()
	handleInvestigationAPI(boardRecorder, putBoard, nil)
	if boardRecorder.Code != http.StatusOK {
		t.Fatalf("board PUT status = %d, body = %s", boardRecorder.Code, boardRecorder.Body.String())
	}

	getBoard := httptest.NewRequest(http.MethodGet, "/api/investigations/inv-1/board", nil)
	getBoardRecorder := httptest.NewRecorder()
	handleInvestigationAPI(getBoardRecorder, getBoard, nil)
	if getBoardRecorder.Code != http.StatusOK {
		t.Fatalf("board GET status = %d, body = %s", getBoardRecorder.Code, getBoardRecorder.Body.String())
	}
	if !strings.Contains(getBoardRecorder.Body.String(), `"node-1"`) {
		t.Fatalf("expected persisted board payload, got %s", getBoardRecorder.Body.String())
	}

	getCatalog := httptest.NewRequest(http.MethodGet, "/api/investigations", nil)
	catalogRecorder := httptest.NewRecorder()
	handleInvestigationAPI(catalogRecorder, getCatalog, nil)
	if catalogRecorder.Code != http.StatusOK {
		t.Fatalf("catalog GET status = %d, body = %s", catalogRecorder.Code, catalogRecorder.Body.String())
	}
	if !strings.Contains(catalogRecorder.Body.String(), `"inv-1"`) {
		t.Fatalf("expected catalog to include investigation, got %s", catalogRecorder.Body.String())
	}
}

func TestInvestigationAPIRejectsInvalidIDs(t *testing.T) {
	request := httptest.NewRequest(http.MethodPut, "/api/investigations/../escape/board", strings.NewReader(`{}`))
	recorder := httptest.NewRecorder()

	handleInvestigationAPI(recorder, request, nil)

	if recorder.Code != http.StatusBadRequest && recorder.Code != http.StatusNotFound {
		t.Fatalf("expected invalid route to be rejected, got %d", recorder.Code)
	}
}
