package legs

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

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

	// Retry loop for Search API
	var resp *http.Response
	var err error
	client := &http.Client{Timeout: 10 * time.Second}
	for i := 0; i < 3; i++ {
		req, _ := http.NewRequest("GET", searchURL, nil)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("X-Subscription-Token", apiKey)
		resp, err = client.Do(req)
		if err == nil && resp.StatusCode == 200 {
			break
		}
		if resp != nil {
			resp.Body.Close()
		}
		time.Sleep(time.Duration(i+1) * time.Second)
	}

	if err != nil || (resp != nil && resp.StatusCode != 200) {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		return models.NutrientFlow{LegID: legID, Error: fmt.Errorf("search api failed after retries (status %d): %v", status, err)}
	}
	defer resp.Body.Close()

	var searchRes SearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&searchRes); err != nil {
		return models.NutrientFlow{LegID: legID, Error: fmt.Errorf("failed to decode json: %w", err)}
	}

	topURLs := ExtractTopURLs(&searchRes, 2)

	if len(topURLs) == 0 {
		return models.NutrientFlow{LegID: legID, Error: fmt.Errorf("no search results found for: %s", query)}
	}

	if broadcast != nil {
		broadcast(models.WSMessage{
			Type: "LEG_UPDATE",
			Payload: map[string]interface{}{
				"legId":  legID,
				"state":  "Scraping Content",
				"target": fmt.Sprintf("%d sources", len(topURLs)),
			},
		})
	}

	var extractedTexts []string
	scrapeClient := &http.Client{Timeout: 15 * time.Second} // Quality gate: timeout slow sites
	for _, targetURL := range topURLs {
		var scrapeResp *http.Response
		var scrapeErr error
		for i := 0; i < 2; i++ { // Inner retry for individual sites
			scrapeResp, scrapeErr = scrapeClient.Get(targetURL)
			if scrapeErr == nil && scrapeResp.StatusCode == 200 {
				break
			}
			if scrapeResp != nil {
				scrapeResp.Body.Close()
			}
			time.Sleep(500 * time.Millisecond)
		}

		if scrapeErr != nil || (scrapeResp != nil && scrapeResp.StatusCode != 200) {
			continue
		}

		doc, err := goquery.NewDocumentFromReader(scrapeResp.Body)
		scrapeResp.Body.Close()
		if err != nil {
			continue
		}

		// 404 / Dead Link Detection
		title := strings.ToLower(doc.Find("title").Text())
		bodyText := strings.ToLower(doc.Find("body").Text())
		if strings.Contains(title, "404") || strings.Contains(title, "not found") ||
			strings.Contains(title, "access denied") || strings.Contains(bodyText, "404 not found") {
			continue
		}

		doc.Find("p").Each(func(i int, s *goquery.Selection) {
			text := strings.TrimSpace(s.Text())
			if len(text) > 80 { // Increased threshold for quality
				extractedTexts = append(extractedTexts, text)
			}
		})
	}

	fullContext := TruncateContent(strings.Join(extractedTexts, "\n"), 4000)

	// VALIDATION: If we have no meaningful content, return an error so no card is created
	if len(extractedTexts) < 2 || len(fullContext) < 200 {
		return models.NutrientFlow{
			LegID: legID,
			Error: fmt.Errorf("insufficient content extracted (found %d snippets)", len(extractedTexts)),
		}
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

// ExtractTopURLs retrieves up to limit URLs from the search response
func ExtractTopURLs(res *SearchResponse, limit int) []string {
	var urls []string
	for i, result := range res.Web.Results {
		if i >= limit {
			break
		}
		urls = append(urls, result.URL)
	}
	return urls
}

// TruncateContent caps string length by runes to ensure UTF-8 safety
func TruncateContent(content string, limit int) string {
	runes := []rune(content)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return content
}
