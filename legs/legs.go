package legs

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"

	"spider-agent/models"

	"github.com/PuerkitoBio/goquery"
)

// SearchResponse matches the Brave Search API JSON structure.
type SearchResponse struct {
	Web struct {
		Results []struct {
			URL string `json:"url"`
		} `json:"results"`
	} `json:"web"`
}

// ExecuteLegTask handles searching Brave and using goquery to extract text from the top 2 sites.
func ExecuteLegTask(legID int, query string, broadcast models.Broadcaster) models.NutrientFlow {
	apiKey := os.Getenv("BRAVE_API_KEY")
	if apiKey == "" {
		return models.NutrientFlow{
			LegID: legID,
			Error: fmt.Errorf("BRAVE_API_KEY environment variable not set"),
		}
	}

	if broadcast != nil {
		broadcast(models.WSMessage{
			Type: "LEG_UPDATE",
			Payload: map[string]interface{}{
				"legId":  legID,
				"state":  "Searching Brave",
				"target": query,
			},
		})
	}

	searchURL := fmt.Sprintf("https://api.search.brave.com/res/v1/web/search?q=%s", url.QueryEscape(query))
	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return models.NutrientFlow{LegID: legID, Error: fmt.Errorf("search request error: %w", err)}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Subscription-Token", apiKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return models.NutrientFlow{LegID: legID, Error: fmt.Errorf("search api request failed: %w", err)}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return models.NutrientFlow{LegID: legID, Error: fmt.Errorf("brave search returned status code: %d", resp.StatusCode)}
	}

	var searchRes SearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&searchRes); err != nil {
		return models.NutrientFlow{LegID: legID, Error: fmt.Errorf("failed to decode json: %w", err)}
	}

	// Capture top 2 URLs
	var topURLs []string
	for i, result := range searchRes.Web.Results {
		if i >= 2 {
			break
		}
		topURLs = append(topURLs, result.URL)
	}

	if len(topURLs) == 0 {
		return models.NutrientFlow{LegID: legID, Error: fmt.Errorf("no search results found for query: %s", query)}
	}

	if broadcast != nil {
		broadcast(models.WSMessage{
			Type: "LEG_UPDATE",
			Payload: map[string]interface{}{
				"legId":  legID,
				"state":  "Scraping Top URLs",
				"target": strings.Join(topURLs, ", "),
			},
		})
	}

	// Extract paragraph text using goquery
	var extractedTexts []string
	for _, targetURL := range topURLs {
		res, err := http.Get(targetURL)
		if err != nil {
			continue // Skip URLs that fail
		}
		doc, err := goquery.NewDocumentFromReader(res.Body)
		res.Body.Close()
		if err != nil {
			continue
		}

		doc.Find("p").Each(func(i int, s *goquery.Selection) {
			text := strings.TrimSpace(s.Text())
			if len(text) > 40 {
				extractedTexts = append(extractedTexts, text)
			}
		})
	}

	fullContext := strings.Join(extractedTexts, "\n")
	// Cap the size of context so we don't blow up the LLM token limit per leg easily
	if len(fullContext) > 3000 {
		fullContext = fullContext[:3000]
	}

	if fullContext == "" {
		fullContext = "No valid paragraph text extracted."
	}

	if broadcast != nil {
		broadcast(models.WSMessage{
			Type: "LEG_UPDATE",
			Payload: map[string]interface{}{
				"legId": legID,
				"state": "Idle",
			},
		})
	}

	return models.NutrientFlow{
		LegID:     legID,
		SourceURL: strings.Join(topURLs, ", "),
		Content:   fullContext,
		Error:     nil,
	}
}
