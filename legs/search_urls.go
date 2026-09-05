package legs

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// SearchWebURLs reuses the board's Brave credential and endpoint without running
// its scraper. Callers must validate and fetch these untrusted result URLs.
func SearchWebURLs(ctx context.Context, query string, limit int) ([]string, error) {
	key := os.Getenv("BRAVE_API_KEY")
	if key == "" {
		return nil, fmt.Errorf("BRAVE_API_KEY is not configured")
	}
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return searchWebURLs(ctx, client, "https://api.search.brave.com/res/v1/web/search", key, query, limit)
}
func searchWebURLs(ctx context.Context, client *http.Client, endpoint, key, query string, limit int) ([]string, error) {
	if strings.TrimSpace(query) == "" || len(query) > 1000 || limit < 1 || limit > 5 {
		return nil, fmt.Errorf("provide a bounded search query and 1-5 results")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?q="+url.QueryEscape(query)+fmt.Sprintf("&count=%d", limit), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Subscription-Token", key)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Brave search request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Brave search returned HTTP %d", resp.StatusCode)
	}
	var result SearchResponse
	if err = json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&result); err != nil {
		return nil, fmt.Errorf("invalid Brave search response")
	}
	urls := []string{}
	seen := map[string]bool{}
	for _, r := range result.Web.Results {
		u, e := url.Parse(r.URL)
		if e != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil {
			continue
		}
		if seen[r.URL] {
			continue
		}
		seen[r.URL] = true
		urls = append(urls, r.URL)
		if len(urls) == limit {
			break
		}
	}
	return urls, nil
}
