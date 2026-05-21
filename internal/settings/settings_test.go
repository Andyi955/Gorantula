package settings

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestSettingsHandler(t *testing.T) {
	// Create a temporary .env file for testing
	tempEnvFile, err := os.CreateTemp("", ".env.test")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tempEnvFile.Name())

	var envMutex sync.Mutex

	tests := []struct {
		name           string
		method         string
		payload        map[string]string
		expectedStatus int
		expectedEnv    map[string]string // What should be in os.Getenv after
	}{
		{
			name:           "GET - Empty initially",
			method:         http.MethodGet,
			payload:        nil,
			expectedStatus: http.StatusOK,
			expectedEnv:    map[string]string{},
		},
		{
			name:           "POST - Add new key",
			method:         http.MethodPost,
			payload:        map[string]string{"OPENAI_API_KEY": "sk-1234567890abcdef"},
			expectedStatus: http.StatusOK,
			expectedEnv:    map[string]string{"OPENAI_API_KEY": "sk-1234567890abcdef"},
		},
		{
			name:           "POST - Trim whitespace",
			method:         http.MethodPost,
			payload:        map[string]string{"ANTHROPIC_API_KEY": "   sk-ant-123   "},
			expectedStatus: http.StatusOK,
			expectedEnv:    map[string]string{"ANTHROPIC_API_KEY": "sk-ant-123"},
		},
		{
			name:           "POST - Delete key by sending empty",
			method:         http.MethodPost,
			payload:        map[string]string{"OPENAI_API_KEY": ""},
			expectedStatus: http.StatusOK,
			expectedEnv:    map[string]string{"OPENAI_API_KEY": ""}, // Should be empty/unset
		},
		{
			name:           "POST - Ignore masked submission",
			method:         http.MethodPost,
			payload:        map[string]string{"ANTHROPIC_API_KEY": "sk-...123"},
			expectedStatus: http.StatusOK,
			expectedEnv:    map[string]string{"ANTHROPIC_API_KEY": "sk-ant-123"}, // Should remain from earlier
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var reqBody bytes.Buffer
			if tt.payload != nil {
				json.NewEncoder(&reqBody).Encode(map[string]interface{}{"keys": tt.payload})
			}

			req, err := http.NewRequest(tt.method, "/api/settings", &reqBody)
			if err != nil {
				t.Fatalf("failed to create request: %v", err)
			}
			req.Header.Set("Content-Type", "application/json")

			rr := httptest.NewRecorder()

			// We inject the tempEnvFile path and mutex into our handler logic
			// for testability. Since the original handler is an inline anonymous
			// function in main.go, we reproduce the core logic here with the injected test path.
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				Handle(w, r, tempEnvFile.Name(), &envMutex, nil)
			})

			handler.ServeHTTP(rr, req)

			if status := rr.Code; status != tt.expectedStatus {
				t.Errorf("handler returned wrong status code: got %v want %v",
					status, tt.expectedStatus)
			}

			// Validate Env
			for k, expectedVal := range tt.expectedEnv {
				actualVal := os.Getenv(k)
				if actualVal != expectedVal {
					t.Errorf("expected env %s=%s, got %s", k, expectedVal, actualVal)
				}
			}
		})
	}
}

func TestSettingsHandler_GetExposesModelOverridesAndHosts(t *testing.T) {
	tempEnvFile, err := os.CreateTemp("", ".env.test")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tempEnvFile.Name())

	content := strings.Join([]string{
		"OPENAI_API_KEY=sk-test-123456",
		"OLLAMA_HOST=http://localhost:11434",
		"LMSTUDIO_BASE_URL=http://localhost:1234/v1",
		"DEEPSEEK_MODEL=deepseek-v4-pro",
		"DEFAULT_SEARCH_MODEL=deepseek",
	}, "\n")
	if err := os.WriteFile(tempEnvFile.Name(), []byte(content), 0o600); err != nil {
		t.Fatalf("failed to write temp env file: %v", err)
	}

	var envMutex sync.Mutex
	req := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	rr := httptest.NewRecorder()

	Handle(rr, req, tempEnvFile.Name(), &envMutex, nil)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var payload struct {
		Keys map[string]string `json:"keys"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if payload.Keys["OLLAMA_HOST"] != "http://localhost:11434" {
		t.Fatalf("expected passthrough ollama host, got %q", payload.Keys["OLLAMA_HOST"])
	}
	if payload.Keys["LMSTUDIO_BASE_URL"] != "http://localhost:1234/v1" {
		t.Fatalf("expected passthrough lm studio base url, got %q", payload.Keys["LMSTUDIO_BASE_URL"])
	}
	if payload.Keys["DEEPSEEK_MODEL"] != "deepseek-v4-pro" {
		t.Fatalf("expected passthrough deepseek model, got %q", payload.Keys["DEEPSEEK_MODEL"])
	}
	if payload.Keys["DEFAULT_SEARCH_MODEL"] != "deepseek" {
		t.Fatalf("expected passthrough search model, got %q", payload.Keys["DEFAULT_SEARCH_MODEL"])
	}
	if payload.Keys["OPENAI_API_KEY"] == "sk-test-123456" {
		t.Fatal("expected OPENAI_API_KEY to be masked")
	}
}
