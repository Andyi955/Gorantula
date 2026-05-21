package settings

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/joho/godotenv"

	"spider-agent/brain"
)

func Handle(w http.ResponseWriter, r *http.Request, envFile string, envMutex *sync.Mutex, br *brain.Brain) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method == http.MethodGet {
		envMap, err := godotenv.Read(envFile)
		if err != nil && !os.IsNotExist(err) {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if envMap == nil {
			envMap = make(map[string]string)
		}

		maskedMap := make(map[string]string)
		sensitiveKeys := []string{
			"GEMINI_API_KEY", "MINIMAX_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
			"DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "ZHIPUAI_API_KEY",
			"MOONSHOT_API_KEY", "LM_API_TOKEN",
		}
		for _, k := range sensitiveKeys {
			val := envMap[k]
			if val != "" {
				if len(val) > 4 {
					maskedMap[k] = val[:3] + "..." + val[len(val)-2:]
				} else {
					maskedMap[k] = "***"
				}
			} else {
				maskedMap[k] = ""
			}
		}

		passthroughKeys := []string{
			"GEMINI_ENABLED",
			"OPENAI_ENABLED",
			"ANTHROPIC_ENABLED",
			"DEEPSEEK_ENABLED",
			"DASHSCOPE_ENABLED",
			"ZHIPUAI_ENABLED",
			"MOONSHOT_ENABLED",
			"MINIMAX_ENABLED",
			"OLLAMA_ENABLED",
			"LMSTUDIO_ENABLED",
			"OLLAMA_HOST",
			"LMSTUDIO_BASE_URL",
			"DEFAULT_SEARCH_MODEL",
			"DEFAULT_PERSONA_MODEL",
			"GEMINI_MODEL",
			"OPENAI_MODEL",
			"ANTHROPIC_MODEL",
			"DEEPSEEK_MODEL",
			"DASHSCOPE_MODEL",
			"ZHIPUAI_MODEL",
			"MOONSHOT_MODEL",
			"MINIMAX_MODEL",
			"OLLAMA_MODEL",
			"LMSTUDIO_MODEL",
		}
		for _, k := range passthroughKeys {
			maskedMap[k] = envMap[k]
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"keys": maskedMap})
		return
	}

	if r.Method == http.MethodPost {
		var payload struct {
			Keys map[string]string `json:"keys"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		envMutex.Lock()
		defer envMutex.Unlock()

		envMap, err := godotenv.Read(envFile)
		if err != nil {
			if os.IsNotExist(err) {
				envMap = make(map[string]string)
			} else {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}

		// Validate and apply keys
		for k, v := range payload.Keys {
			cleanVal := strings.TrimSpace(v) // Edge case 1: Trim accidental whitespace
			if cleanVal != "" && !strings.Contains(cleanVal, "...") {
				envMap[k] = cleanVal
				os.Setenv(k, cleanVal)
			} else if cleanVal == "" {
				// We only delete if it was explicitly sent as empty
				delete(envMap, k)
				os.Unsetenv(k)
			}
		}

		if err := godotenv.Write(envMap, envFile); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Edge Case 3: Dynamically reload the backend router mapping
		if br != nil {
			if err := br.ReloadModelProviders(); err != nil {
				log.Printf("[Settings Error] Failed to reload backend model router: %v", err)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"success"}`))
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}
