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

func TestInvestigationAPIStoresRelationshipResults(t *testing.T) {
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

	putRelationships := httptest.NewRequest(http.MethodPut, "/api/investigations/inv-1/relationships", strings.NewReader(`{
		"vaultId":"inv-1",
		"runId":"run-1",
		"connections":[{"source":"node-a","target":"node-b","tag":"RELATED","reasoning":"Shared evidence"}]
	}`))
	putRelationships.Header.Set("Content-Type", "application/json")
	putRecorder := httptest.NewRecorder()
	handleInvestigationAPI(putRecorder, putRelationships, nil)
	if putRecorder.Code != http.StatusOK {
		t.Fatalf("relationships PUT status = %d, body = %s", putRecorder.Code, putRecorder.Body.String())
	}

	getRelationships := httptest.NewRequest(http.MethodGet, "/api/investigations/inv-1/relationships", nil)
	getRecorder := httptest.NewRecorder()
	handleInvestigationAPI(getRecorder, getRelationships, nil)
	if getRecorder.Code != http.StatusOK {
		t.Fatalf("relationships GET status = %d, body = %s", getRecorder.Code, getRecorder.Body.String())
	}
	if !strings.Contains(getRecorder.Body.String(), `"node-a"`) {
		t.Fatalf("expected persisted relationship payload, got %s", getRecorder.Body.String())
	}
}

func TestInvestigationAPIFallsBackToLatestRelationshipLog(t *testing.T) {
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

	if err := os.MkdirAll("abdomen_vault/relationship_logs", 0755); err != nil {
		t.Fatalf("failed to create relationship log dir: %v", err)
	}
	logBody := `GORANTULA RELATIONSHIP DEBUG TRACE
Generated: 2026-05-18T07:19:25+01:00
Vault: inv-1
Stage: completed

=== Final Connections ===
node-a -> node-b [RELATED] confidence=0.90 quality=0.86
Reasoning: Shared durable evidence.
Personas: Connector, Skeptic | EvidenceNodes: node-a, node-b

=== Notes ===
- accepted_connections=1
`
	if err := os.WriteFile("abdomen_vault/relationship_logs/inv-1-20260518-071925-1.txt", []byte(logBody), 0644); err != nil {
		t.Fatalf("failed to write relationship log: %v", err)
	}

	getRelationships := httptest.NewRequest(http.MethodGet, "/api/investigations/inv-1/relationships", nil)
	getRecorder := httptest.NewRecorder()
	handleInvestigationAPI(getRecorder, getRelationships, nil)
	if getRecorder.Code != http.StatusOK {
		t.Fatalf("relationships GET status = %d, body = %s", getRecorder.Code, getRecorder.Body.String())
	}
	for _, expected := range []string{`"source":"node-a"`, `"target":"node-b"`, `"tag":"RELATED"`, `"reasoning":"Shared durable evidence."`} {
		if !strings.Contains(getRecorder.Body.String(), expected) {
			t.Fatalf("expected recovered relationship payload to contain %s, got %s", expected, getRecorder.Body.String())
		}
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
