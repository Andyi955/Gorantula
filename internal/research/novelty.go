package research

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// NoveltyChecker scores how novel a candidate hypothesis is against the
// literature. It is an interface so tests can inject a deterministic stub.
type NoveltyChecker interface {
	CheckNovelty(ctx context.Context, hypothesis string, entities []string) (score float32, nearestWork string, err error)
}

// OpenAlexNoveltyChecker queries the OpenAlex API (no key required). It returns
// a proxy novelty score based on how few closely-matching works exist, plus the
// nearest-looking title so the operator can judge whether a candidate is
// genuinely unclaimed or just rephrased.
type OpenAlexNoveltyChecker struct {
	baseURL string
	client  *http.Client
}

func NewOpenAlexNoveltyChecker() *OpenAlexNoveltyChecker {
	return &OpenAlexNoveltyChecker{
		baseURL: "https://api.openalex.org/works",
		client:  &http.Client{Timeout: 8 * time.Second},
	}
}

type openAlexResponse struct {
	Meta struct {
		Count int `json:"count"`
	} `json:"meta"`
	Results []openAlexWork `json:"results"`
}

type openAlexWork struct {
	Title string `json:"title"`
}

func (c *OpenAlexNoveltyChecker) CheckNovelty(ctx context.Context, hypothesis string, entities []string) (float32, string, error) {
	query := noveltyQuery(hypothesis, entities)
	if strings.TrimSpace(query) == "" {
		return 0.5, "", nil
	}

	requestURL := fmt.Sprintf("%s?search=%s&per-page=5&mailto=gorantula@example.com", c.baseURL, url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return 0, "", err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()

	var body openAlexResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, "", err
	}

	nearest := ""
	if len(body.Results) > 0 {
		nearest = body.Results[0].Title
	}
	return noveltyScoreFromCount(body.Meta.Count), nearest, nil
}

// noveltyScoreFromCount maps the number of search hits to a novelty proxy score:
// zero hits is maximally novel, many hits means the idea is likely covered.
func noveltyScoreFromCount(count int) float32 {
	switch {
	case count <= 0:
		return 0.9
	case count == 1:
		return 0.7
	case count <= 3:
		return 0.55
	case count <= 8:
		return 0.4
	default:
		return 0.25
	}
}

func noveltyQuery(hypothesis string, entities []string) string {
	var parts []string
	for _, entity := range entities {
		if _, name, ok := splitEntityTagForNovelty(entity); ok {
			parts = append(parts, name)
		}
	}
	if len(parts) == 0 {
		parts = append(parts, strings.TrimSpace(hypothesis))
	}
	if len(parts) > 4 {
		parts = parts[:4]
	}
	return strings.Join(parts, " ")
}

func splitEntityTagForNovelty(entity string) (prefix, value string, ok bool) {
	entity = strings.TrimSpace(entity)
	if len(entity) < 4 || entity[0] != '[' || entity[len(entity)-1] != ']' {
		return "", "", false
	}
	inner := entity[1 : len(entity)-1]
	colon := strings.Index(inner, ":")
	if colon <= 0 {
		return "", "", false
	}
	return strings.ToUpper(strings.TrimSpace(inner[:colon])), strings.TrimSpace(inner[colon+1:]), true
}
