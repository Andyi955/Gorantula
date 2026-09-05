package research

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/Andyi955/Gorantula/models"
)

// NoveltyChecker scores how novel a candidate hypothesis is against the
// literature. It is an interface so tests can inject a deterministic stub.
type NoveltyChecker interface {
	CheckNovelty(ctx context.Context, hypothesis string, entities []string) (score float32, nearestWork string, err error)
}

// EvidenceRetriever fetches related/surrounding papers for a literature query so
// the review committee can resolve criteria the candidate's own papers left
// unknown. It is an interface so tests can inject a deterministic stub.
type EvidenceRetriever interface {
	Retrieve(ctx context.Context, query string, limit int) ([]models.Paper, error)
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
	IsRetracted           bool             `json:"is_retracted"`
	Type                  string           `json:"type"`
	Title                 string           `json:"title"`
	Doi                   string           `json:"doi"`
	PublicationYear       int              `json:"publication_year"`
	AbstractInvertedIndex map[string][]int `json:"abstract_inverted_index"`
	ID                    string           `json:"id"`
}

func (c *OpenAlexNoveltyChecker) CheckNovelty(ctx context.Context, hypothesis string, entities []string) (float32, string, error) {
	query := noveltyQuery(hypothesis, entities)
	if strings.TrimSpace(query) == "" {
		return 0.5, "", nil
	}

	requestURL := fmt.Sprintf("%s?search=%s&per-page=10&mailto=gorantula@example.com", c.baseURL, url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return 0, "", err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, "", fmt.Errorf("OpenAlex returned HTTP %d", resp.StatusCode)
	}

	var body openAlexResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, "", err
	}

	// Claim-specific novelty: count how many of the closest works are
	// near-duplicates of the hypothesis — a high fraction of the hypothesis's
	// content words present in the work's title/abstract. Few/none -> novel;
	// several -> the claim is already established. Using cleaned content words
	// (stopwords stripped) keeps generic words from inflating the match, and the
	// score reflects THIS claim, not the broad topic.
	contentWords := cleanHypothesisTerms(hypothesis)
	hypWords := make(map[string]struct{}, len(contentWords))
	for _, word := range contentWords {
		hypWords[word] = struct{}{}
	}
	nearMatches := 0
	nearest := ""
	for _, work := range body.Results {
		workText := work.Title + " " + reconstructOpenAlexAbstract(work.AbstractInvertedIndex)
		if measureWordCoverage(hypWords, workText) >= 0.5 {
			nearMatches++
			if nearest == "" {
				nearest = work.Title
			}
		}
	}
	if nearest == "" && len(body.Results) > 0 {
		nearest = body.Results[0].Title
	}
	return noveltyScoreFromCount(nearMatches), nearest, nil
}

// Retrieve fetches related papers for a literature query and returns them as
// Paper records (title, reconstructed abstract, source URL, year), capped to
// limit. Grounded to real OpenAlex works; never synthesizes content.
func (c *OpenAlexNoveltyChecker) Retrieve(ctx context.Context, query string, limit int) ([]models.Paper, error) {
	if strings.TrimSpace(query) == "" {
		return []models.Paper{}, nil
	}
	if limit <= 0 {
		limit = 5
	}

	requestURL := fmt.Sprintf("%s?search=%s&filter=has_abstract:true&per-page=%d&mailto=gorantula@example.com", c.baseURL, url.QueryEscape(query), limit)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		retry := time.Minute
		if seconds, e := strconv.Atoi(resp.Header.Get("Retry-After")); e == nil && seconds > 0 {
			retry = time.Duration(min(seconds, 86400)) * time.Second
		}
		return nil, fmt.Errorf("OpenAlex returned %w", paperAPIError{resp.StatusCode, retry})
	}

	var body openAlexResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&body); err != nil {
		return nil, err
	}

	papers := make([]models.Paper, 0, len(body.Results))
	for _, work := range body.Results {
		// Exclude known withdrawn work and non-study records; absence of a flag is not a reliability certificate.
		if work.IsRetracted || work.Type == "retraction" || work.Type == "paratext" {
			continue
		}
		title := strings.TrimSpace(work.Title)
		abstract := reconstructOpenAlexAbstract(work.AbstractInvertedIndex)
		if title == "" && abstract == "" {
			continue
		}
		sourceURL := firstNonEmpty(work.Doi, work.ID, "https://openalex.org/")
		if !strings.HasPrefix(sourceURL, "http") {
			sourceURL = "https://" + sourceURL
		}
		papers = append(papers, models.Paper{
			ID:        "fetched-" + strings.TrimSpace(work.ID),
			Title:     title,
			Abstract:  abstract,
			SourceURL: sourceURL,
			Year:      work.PublicationYear,
			License:   "openalex",
		})
	}
	return papers, nil
}

// reconstructOpenAlexAbstract turns OpenAlex's word->position inverted index
// back into the readable abstract. Empty if OpenAlex did not index an abstract.
func reconstructOpenAlexAbstract(inverted map[string][]int) string {
	if len(inverted) == 0 {
		return ""
	}
	type wordAt struct {
		word     string
		position int
	}
	words := make([]wordAt, 0, 128)
	for word, positions := range inverted {
		for _, pos := range positions {
			words = append(words, wordAt{word: word, position: pos})
		}
	}
	sort.SliceStable(words, func(i, j int) bool { return words[i].position < words[j].position })
	var builder strings.Builder
	for i, w := range words {
		if i > 0 && (w.word == "." || w.word == ",") {
			builder.WriteString(w.word)
			continue
		}
		builder.WriteString(w.word)
		if i != len(words)-1 {
			builder.WriteString(" ")
		}
	}
	return strings.TrimSpace(builder.String())
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
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
		if _, name, ok := splitEntityTagForNovelty(entity); ok && name != "" {
			parts = append(parts, name)
		}
	}
	// Add the substance of the claim so the search targets THIS hypothesis, not
	// just the broad topic.
	for _, term := range cleanHypothesisTerms(hypothesis) {
		parts = append(parts, term)
	}
	if len(parts) == 0 {
		parts = append(parts, strings.TrimSpace(hypothesis))
	}
	if len(parts) > 5 {
		parts = parts[:5]
	}
	return strings.Join(parts, " ")
}

var noveltyQueryStopwords = map[string]struct{}{
	"contradiction": {}, "convergence": {}, "divergence": {}, "hypothesis": {},
	"vs": {}, "versus": {}, "the": {}, "a": {}, "an": {}, "of": {}, "in": {},
	"on": {}, "and": {}, "or": {}, "to": {}, "for": {}, "with": {}, "by": {},
	"not": {}, "is": {}, "are": {}, "was": {}, "were": {}, "it": {}, "its": {},
}

func cleanHypothesisTerms(hypothesis string) []string {
	var terms []string
	seen := make(map[string]struct{})
	for _, token := range strings.FieldsFunc(strings.ToLower(hypothesis), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if _, stop := noveltyQueryStopwords[token]; stop || token == "" {
			continue
		}
		if _, dup := seen[token]; dup {
			continue
		}
		seen[token] = struct{}{}
		terms = append(terms, token)
	}
	return terms
}

// measureWordCoverage returns the fraction of the hypothesis's content words
// that appear in text. Used for claim-specific near-match novelty.
func measureWordCoverage(hypWords map[string]struct{}, text string) float64 {
	if len(hypWords) == 0 {
		return 0
	}
	textWords := wordSet(text)
	matched := 0
	for word := range hypWords {
		if _, ok := textWords[word]; ok {
			matched++
		}
	}
	return float64(matched) / float64(len(hypWords))
}

// wordSet lowercases text and returns the set of tokens, trimming surrounding
// punctuation. Mirrors brain.wordSet so novelty coverage is measured the same
// way across the package boundary.
func wordSet(text string) map[string]struct{} {
	words := strings.Fields(strings.ToLower(text))
	set := make(map[string]struct{}, len(words))
	for _, word := range words {
		word = strings.Trim(word, ".,;:!?\"'()[]—-")
		if word == "" {
			continue
		}
		set[word] = struct{}{}
	}
	return set
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
