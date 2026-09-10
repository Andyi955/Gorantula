package research

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

type stubRoundTrip func(*http.Request) (*http.Response, error)

func (f stubRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func stubClient(f stubRoundTrip) *http.Client { return &http.Client{Transport: f} }

func response(status int, body string) *http.Response {
	parsed, _ := url.Parse("https://data.example.org/file.csv")
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     http.Header{},
		Request:    &http.Request{URL: parsed},
	}
}

// A host that refuses the browser agent but accepts the plain client agent must
// still yield the data, and every attempt must carry a User-Agent header.
func TestFetchWithAgentsRetriesRefusedRequestWithSecondAgent(t *testing.T) {
	var agents []string
	client := stubClient(func(r *http.Request) (*http.Response, error) {
		agents = append(agents, r.Header.Get("User-Agent"))
		if len(agents) == 1 {
			return response(http.StatusForbidden, "blocked"), nil
		}
		return response(http.StatusOK, "group,value\na,1\n"), nil
	})

	data, final, err := fetchWithAgents(context.Background(), client, "https://data.example.org/file.csv", maxDatasetBytes)
	if err != nil {
		t.Fatalf("fetchWithAgents: %v", err)
	}
	if string(data) != "group,value\na,1\n" {
		t.Errorf("body = %q", string(data))
	}
	if final != "https://data.example.org/file.csv" {
		t.Errorf("final URL = %q", final)
	}
	if len(agents) != 2 {
		t.Fatalf("expected 2 attempts, got %d (%v)", len(agents), agents)
	}
	if agents[0] == agents[1] || agents[0] == "" || agents[1] == "" {
		t.Errorf("attempts must use distinct non-empty agents, got %v", agents)
	}
}

// A 404 means the file is not there; retrying it wastes the budget.
func TestFetchWithAgentsDoesNotRetryMissingFile(t *testing.T) {
	attempts := 0
	client := stubClient(func(*http.Request) (*http.Response, error) {
		attempts++
		return response(http.StatusNotFound, "gone"), nil
	})
	if _, _, err := fetchWithAgents(context.Background(), client, "https://data.example.org/file.csv", maxDatasetBytes); err == nil {
		t.Fatal("expected an error for 404")
	}
	if attempts != 1 {
		t.Errorf("expected a single attempt for 404, got %d", attempts)
	}
}

func TestFetchWithAgentsRejectsOversizedPayload(t *testing.T) {
	client := stubClient(func(*http.Request) (*http.Response, error) {
		return response(http.StatusOK, strings.Repeat("x", 64)), nil
	})
	_, _, err := fetchWithAgents(context.Background(), client, "https://data.example.org/file.csv", 16)
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected an oversize error, got %v", err)
	}
}
