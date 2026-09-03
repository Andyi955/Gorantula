package legs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Andyi955/Gorantula/models"
	"github.com/Andyi955/Gorantula/pkg/document"

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

type sourceScrapeResult struct {
	index     int
	texts     []string
	imageURLs []string
}

// ExecuteLegTask handles searching Brave and using goquery to extract text from the top 2 sites.
func ExecuteLegTask(legID int, query string, broadcast models.Broadcaster) models.NutrientFlow {
	return ExecuteLegTaskWithContext(context.Background(), legID, query, broadcast)
}

// ExecuteLegTaskWithContext handles searching Brave and scraping with cancellation support.
func ExecuteLegTaskWithContext(ctx context.Context, legID int, query string, broadcast models.Broadcaster) models.NutrientFlow {
	if ctx == nil {
		ctx = context.Background()
	}
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
		if err := ctx.Err(); err != nil {
			return models.NutrientFlow{LegID: legID, Error: err}
		}
		req, _ := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("X-Subscription-Token", apiKey)
		resp, err = client.Do(req)
		if err == nil && resp.StatusCode == 200 {
			break
		}
		if resp != nil {
			resp.Body.Close()
		}
		select {
		case <-ctx.Done():
			return models.NutrientFlow{LegID: legID, Error: ctx.Err()}
		case <-time.After(time.Duration(i+1) * time.Second):
		}
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

	topURLs := ExtractTopURLs(&searchRes, legSourceCount())

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

	scrapeClient := &http.Client{Timeout: 15 * time.Second} // Quality gate: timeout slow sites
	scrapedSources := scrapeSources(ctx, scrapeClient, topURLs)
	var extractedTexts []string
	var imageCandidates []string
	for _, result := range scrapedSources {
		extractedTexts = append(extractedTexts, result.texts...)
		imageCandidates = append(imageCandidates, result.imageURLs...)
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
		ImageURLs: imageCandidates,
		Error:     nil,
	}
}

func scrapeSources(ctx context.Context, scrapeClient *http.Client, targetURLs []string) []sourceScrapeResult {
	if len(targetURLs) == 0 {
		return nil
	}

	results := make([]sourceScrapeResult, 0, len(targetURLs))
	resultCh := make(chan sourceScrapeResult, len(targetURLs))
	var waitGroup sync.WaitGroup
	for index, targetURL := range targetURLs {
		waitGroup.Add(1)
		go func(resultIndex int, resultURL string) {
			defer waitGroup.Done()
			resultCh <- scrapeSingleSource(ctx, scrapeClient, resultIndex, resultURL)
		}(index, targetURL)
	}
	waitGroup.Wait()
	close(resultCh)

	for result := range resultCh {
		if len(result.texts) == 0 && len(result.imageURLs) == 0 {
			continue
		}
		results = append(results, result)
	}
	sort.SliceStable(results, func(i, j int) bool {
		return results[i].index < results[j].index
	})
	return results
}

func scrapeSingleSource(ctx context.Context, scrapeClient *http.Client, index int, targetURL string) sourceScrapeResult {
	var scrapeResp *http.Response
	var scrapeErr error
	for attempt := 0; attempt < 2; attempt++ {
		if err := ctx.Err(); err != nil {
			return sourceScrapeResult{index: index}
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
		if err != nil {
			return sourceScrapeResult{index: index}
		}
		scrapeResp, scrapeErr = scrapeClient.Do(request)
		if scrapeErr == nil && scrapeResp != nil && scrapeResp.StatusCode == http.StatusOK {
			break
		}
		if scrapeResp != nil {
			scrapeResp.Body.Close()
		}
		select {
		case <-ctx.Done():
			return sourceScrapeResult{index: index}
		case <-time.After(500 * time.Millisecond):
		}
	}

	if scrapeErr != nil || scrapeResp == nil || scrapeResp.StatusCode != http.StatusOK {
		return sourceScrapeResult{index: index}
	}
	defer scrapeResp.Body.Close()

	doc, err := goquery.NewDocumentFromReader(scrapeResp.Body)
	if err != nil {
		return sourceScrapeResult{index: index}
	}

	result := sourceScrapeResult{
		index:     index,
		imageURLs: extractCandidateImageURLs(doc, targetURL),
	}

	// 404 / Dead Link Detection
	title := strings.ToLower(doc.Find("title").Text())
	bodyText := strings.ToLower(doc.Find("body").Text())
	if strings.Contains(title, "404") || strings.Contains(title, "not found") ||
		strings.Contains(title, "access denied") || strings.Contains(bodyText, "404 not found") {
		return result
	}

	result.texts = extractLegParagraphs(doc)
	return result
}

// legSourceCount is how many Brave results each leg scrapes. The old
// hard-coded 2 starved boards (8 legs x 2 = 16 pages max, fewer after
// failures); 4 doubles the raw material per scan. Override with
// GORANTULA_LEG_SOURCES.
func legSourceCount() int {
	raw := strings.TrimSpace(os.Getenv("GORANTULA_LEG_SOURCES"))
	if raw == "" {
		return 4
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return 4
	}
	if parsed > 8 {
		return 8
	}
	return parsed
}

// extractLegParagraphs pulls article text out of a scraped page. Modern
// sites keep the real copy inside semantic containers, while bare <p>
// scraping drags in nav/boilerplate paragraphs and misses
// container-rendered copy. Prefer the strong containers (deduplicated)
// and fall back to the whole document only when no container yields
// usable copy.
func extractLegParagraphs(doc *goquery.Document) []string {
	for _, selector := range []string{
		"article", "main", "[role=main]", "#content",
		".post-content", ".article-content", ".entry-content", ".article-body",
	} {
		var texts []string
		doc.Find(selector).Each(func(_ int, container *goquery.Selection) {
			container.Find("p").Each(func(_ int, s *goquery.Selection) {
				text := strings.TrimSpace(s.Text())
				if len(text) > 80 {
					texts = append(texts, text)
				}
			})
		})
		if len(texts) >= 2 {
			return dedupeParagraphs(texts)
		}
	}

	var texts []string
	doc.Find("p").Each(func(_ int, s *goquery.Selection) {
		text := strings.TrimSpace(s.Text())
		if len(text) > 80 {
			texts = append(texts, text)
		}
	})
	return dedupeParagraphs(texts)
}

func dedupeParagraphs(texts []string) []string {
	seen := make(map[string]struct{}, len(texts))
	result := make([]string, 0, len(texts))
	for _, text := range texts {
		if _, ok := seen[text]; ok {
			continue
		}
		seen[text] = struct{}{}
		result = append(result, text)
	}
	return result
}

// ExecuteLocalFileTask reads a local file using the document parsing package.
func ExecuteLocalFileTask(legID int, filePath string, broadcast models.Broadcaster) models.NutrientFlow {
	return ExecuteLocalFileTaskWithContext(context.Background(), legID, filePath, broadcast)
}

// ExecuteLocalFileTaskWithContext reads a local file using the document parsing package.
func ExecuteLocalFileTaskWithContext(ctx context.Context, legID int, filePath string, broadcast models.Broadcaster) models.NutrientFlow {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return models.NutrientFlow{LegID: legID, Error: err}
	}
	if broadcast != nil {
		broadcast(models.WSMessage{
			Type: "LEG_UPDATE",
			Payload: map[string]interface{}{
				"legId":  legID,
				"state":  "Parsing Document",
				"target": filepath.Base(filePath),
			},
		})
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	var content string
	var err error

	// We significantly increase the context window for local files to support massive PDFs
	limit := 1000000

	switch ext {
	case ".txt", ".md", ".csv":
		content, err = document.ParseTXT(filePath, limit)
	case ".pdf":
		content, err = document.ParsePDF(filePath, limit)
	case ".docx":
		content, err = document.ParseDOCX(filePath, limit)
	default:
		err = fmt.Errorf("unsupported file extension: %s", ext)
	}

	if err != nil {
		return models.NutrientFlow{
			LegID: legID,
			Error: fmt.Errorf("failed to parse local file %s: %w", filepath.Base(filePath), err),
		}
	}
	if err := ctx.Err(); err != nil {
		return models.NutrientFlow{LegID: legID, Error: err}
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
		SourceURL: "file://" + filePath, // Use file protocol structure, but we can treat as pseudo URL
		Content:   content,
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

func extractCandidateImageURLs(doc *goquery.Document, pageURL string) []string {
	candidates := make(map[string]int)
	appendCandidate := func(raw string, score int) {
		resolved := resolveImageURL(pageURL, raw)
		if resolved == "" || !isLikelyEvidenceImageURL(resolved) {
			return
		}
		if score > candidates[resolved] {
			candidates[resolved] = score
		}
	}

	doc.Find(`meta[property="og:image"], meta[name="twitter:image"], meta[property="twitter:image"]`).Each(func(_ int, selection *goquery.Selection) {
		appendCandidate(strings.TrimSpace(selection.AttrOr("content", "")), 100)
	})

	doc.Find("article img, main img, img").Each(func(index int, selection *goquery.Selection) {
		score := 50 - index
		if score < 1 {
			score = 1
		}
		appendCandidate(strings.TrimSpace(selection.AttrOr("src", "")), score)
		appendCandidate(strings.TrimSpace(selection.AttrOr("data-src", "")), score-5)
		appendCandidate(strings.TrimSpace(selection.AttrOr("data-lazy-src", "")), score-5)
	})

	type rankedCandidate struct {
		url   string
		score int
	}

	ranked := make([]rankedCandidate, 0, len(candidates))
	for candidateURL, score := range candidates {
		ranked = append(ranked, rankedCandidate{url: candidateURL, score: score})
	}

	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		return ranked[i].url < ranked[j].url
	})

	limit := 4
	if len(ranked) < limit {
		limit = len(ranked)
	}

	results := make([]string, 0, limit)
	for index := 0; index < limit; index++ {
		results = append(results, ranked[index].url)
	}

	return results
}

func resolveImageURL(pageURL, raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if parsed.IsAbs() {
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return ""
		}
		return parsed.String()
	}

	base, err := url.Parse(pageURL)
	if err != nil {
		return ""
	}

	resolved := base.ResolveReference(parsed)
	if resolved == nil || (resolved.Scheme != "http" && resolved.Scheme != "https") {
		return ""
	}

	return resolved.String()
}

func isLikelyEvidenceImageURL(candidate string) bool {
	lower := strings.ToLower(candidate)
	if lower == "" {
		return false
	}
	if strings.HasPrefix(lower, "data:") {
		return false
	}

	blockedTokens := []string{
		"sprite", "logo", "icon", "avatar", "favicon", "badge", "emoji", "tracking", "pixel", "banner-ad", "doubleclick",
	}
	for _, token := range blockedTokens {
		if strings.Contains(lower, token) {
			return false
		}
	}

	parsed, err := url.Parse(candidate)
	if err != nil {
		return false
	}

	pathLower := strings.ToLower(parsed.Path)
	if pathLower == "" {
		return true
	}

	supportedExtensions := []string{".jpg", ".jpeg", ".png", ".webp", ".gif"}
	for _, extension := range supportedExtensions {
		if strings.HasSuffix(pathLower, extension) {
			return true
		}
	}

	return strings.Contains(pathLower, "/image") || strings.Contains(pathLower, "/photo") || strings.Contains(pathLower, "/media")
}

// ExecuteChunkTask processes a pre-parsed text chunk.
func ExecuteChunkTask(legID int, targetQuery string, chunkData string, broadcast models.Broadcaster) models.NutrientFlow {
	return ExecuteChunkTaskWithContext(context.Background(), legID, targetQuery, chunkData, broadcast)
}

// ExecuteChunkTaskWithContext processes a pre-parsed text chunk with cancellation support.
func ExecuteChunkTaskWithContext(ctx context.Context, legID int, targetQuery string, chunkData string, broadcast models.Broadcaster) models.NutrientFlow {
	if ctx == nil {
		ctx = context.Background()
	}
	if broadcast != nil {
		broadcast(models.WSMessage{
			Type: "LEG_UPDATE",
			Payload: map[string]interface{}{
				"legId":  legID,
				"state":  "Analyzing Chunk",
				"target": targetQuery,
			},
		})
	}

	// Artificial delay so the UI shows the "Analyzing Chunk" state before returning to Brain
	select {
	case <-ctx.Done():
		return models.NutrientFlow{LegID: legID, SourceURL: targetQuery, Error: ctx.Err()}
	case <-time.After(200 * time.Millisecond):
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
		SourceURL: targetQuery,
		Content:   chunkData,
		Error:     nil,
	}
}
