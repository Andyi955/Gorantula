package research

import (
	"context"
	"errors"
	"fmt"
	"github.com/Andyi955/Gorantula/models"
	"net/http"
	"sort"
	"strings"
	"time"
)

type namedPaperProvider struct {
	name      string
	retriever EvidenceRetriever
}
type paperSearchCache struct {
	papers  []models.Paper
	expires time.Time
}
type multiPaperSearch struct {
	providers []namedPaperProvider
	cache     map[string]paperSearchCache
	cooldown  map[string]time.Time
	gate      chan struct{}
}

func newMultiPaperSearch(openAlex EvidenceRetriever) *multiPaperSearch {
	client := &http.Client{Timeout: 12 * time.Second}
	m := &multiPaperSearch{cache: map[string]paperSearchCache{}, cooldown: map[string]time.Time{}, gate: make(chan struct{}, 1)}
	for _, p := range []struct{ name, url string }{{"Crossref", "https://api.crossref.org/works"}, {"arXiv", "https://export.arxiv.org/api/query"}, {"Europe PMC", "https://www.ebi.ac.uk/europepmc/webservices/rest/search"}} {
		m.providers = append(m.providers, namedPaperProvider{p.name, &paperAPI{name: p.name, endpoint: p.url, client: client}})
	}
	m.providers = append(m.providers, namedPaperProvider{"OpenAlex", openAlex})
	return m
}
func (m *multiPaperSearch) Retrieve(ctx context.Context, query string, limit int) ([]models.Paper, error) {
	papers, _, err := m.RetrieveWithTrace(ctx, query, limit)
	return papers, err
}

// Keep independent provider failures visible while allowing usable sources to continue the run.
func (m *multiPaperSearch) RetrieveWithTrace(ctx context.Context, query string, limit int) ([]models.Paper, []models.PaperSearchAttempt, error) {
	select {
	case m.gate <- struct{}{}:
		defer func() { <-m.gate }()
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	}
	limit = max(1, min(limit, 10))
	var pool []models.Paper
	var trace []models.PaperSearchAttempt
	for _, provider := range m.providers {
		if provider.name == "OpenAlex" && len(uniquePapers(pool, limit)) >= limit {
			break
		}
		if err := ctx.Err(); err != nil {
			return nil, trace, err
		}
		a := models.PaperSearchAttempt{Provider: provider.name}
		key := provider.name + "|" + strings.ToLower(strings.TrimSpace(query)) + fmt.Sprint(limit)
		cached, ok := m.cache[key]
		var papers []models.Paper
		var err error
		if ok && time.Now().Before(cached.expires) {
			papers = append([]models.Paper{}, cached.papers...)
			a.Cached = true
		} else if until := m.cooldown[provider.name]; time.Now().Before(until) {
			a.Error = "Rate limited; waiting until " + until.UTC().Format(time.RFC3339)
			trace = append(trace, a)
			continue
		} else {
			papers, err = provider.retriever.Retrieve(ctx, query, limit)
			if err == nil {
				if len(m.cache) >= 128 {
					clear(m.cache)
				}
				m.cache[key] = paperSearchCache{append([]models.Paper{}, papers...), time.Now().Add(24 * time.Hour)}
			}
		}
		if err != nil {
			a.Error = err.Error()
			var apiErr paperAPIError
			if errors.As(err, &apiErr) && apiErr.status == 429 {
				m.cooldown[provider.name] = time.Now().Add(apiErr.retry)
			} else if strings.Contains(err.Error(), "429") {
				m.cooldown[provider.name] = time.Now().Add(5 * time.Minute)
			}
		} else {
			for _, p := range papers {
				if strings.TrimSpace(p.Abstract+p.FullText) == "" || p.ID == "" || p.Title == "" {
					continue
				}
				if p.Provider == "" {
					p.Provider = provider.name
				}
				pool = append(pool, p)
				a.Papers++
			}
		}
		trace = append(trace, a)
	}
	// Ranking is a retrieval aid only; the subsequent model screen still decides topic relevance.
	terms := map[string]struct{}{}
	for _, t := range cleanHypothesisTerms(query) {
		terms[t] = struct{}{}
	}
	sort.SliceStable(pool, func(i, j int) bool {
		return measureWordCoverage(terms, pool[i].Title+" "+pool[i].Abstract) > measureWordCoverage(terms, pool[j].Title+" "+pool[j].Abstract)
	})
	selected := uniquePapers(pool, limit)
	if len(selected) == 0 {
		return nil, trace, fmt.Errorf("no readable papers found across available providers; see recorded search attempts")
	}
	return selected, trace, nil
}

func uniquePapers(pool []models.Paper, limit int) []models.Paper {
	seen := map[string]bool{}
	var selected []models.Paper
	for _, p := range pool {
		doi := strings.ToLower(strings.TrimSpace(p.DOI))
		if doi == "" && strings.Contains(p.SourceURL, "doi.org/") {
			doi = strings.ToLower(strings.SplitN(p.SourceURL, "doi.org/", 2)[1])
		}
		title := strings.Join(strings.Fields(strings.ToLower(p.Title)), " ")
		if seen["id:"+p.ID] || seen["title:"+title] || (doi != "" && seen["doi:"+doi]) {
			continue
		}
		seen["id:"+p.ID] = true
		seen["title:"+title] = true
		if doi != "" {
			seen["doi:"+doi] = true
		}
		selected = append(selected, p)
		if len(selected) == limit {
			break
		}
	}
	return selected
}
