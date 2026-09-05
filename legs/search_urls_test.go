package legs

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestSearchWebURLsUsesCredentialAndBoundsResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Subscription-Token") != "test-key" || r.URL.Query().Get("q") != "moth data" || r.URL.Query().Get("count") != "2" {
			t.Error("incorrect search request")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"web":{"results":[{"url":"javascript:bad"},{"url":"https://example.org/data"},{"url":"https://example.org/data"},{"url":"https://github.com/example/data"},{"url":"https://example.org/extra"}]}}`))
	}))
	defer server.Close()
	urls, e := searchWebURLs(context.Background(), server.Client(), server.URL, "test-key", "moth data", 2)
	if e != nil || !reflect.DeepEqual(urls, []string{"https://example.org/data", "https://github.com/example/data"}) {
		t.Fatal(urls, e)
	}
}
func TestSearchWebURLsReportsHTTPFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(429) }))
	defer server.Close()
	if _, e := searchWebURLs(context.Background(), server.Client(), server.URL, "test-key", "moth", 2); e == nil {
		t.Fatal("failure hidden")
	}
}
