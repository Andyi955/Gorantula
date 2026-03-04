package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
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
				handleSettings(w, r, tempEnvFile.Name(), &envMutex, nil)
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
