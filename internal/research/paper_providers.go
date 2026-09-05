package research

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Andyi955/Gorantula/models"
	"github.com/PuerkitoBio/goquery"
)

type paperAPI struct {
	name, endpoint string
	client         *http.Client
	mu             sync.Mutex
	next           time.Time
}
type paperAPIError struct {
	status int
	retry  time.Duration
}

func (e paperAPIError) Error() string { return fmt.Sprintf("HTTP %d", e.status) }

// Space arXiv requests across concurrent runs and bound every response.
func (p *paperAPI) get(ctx context.Context, query url.Values) ([]byte, error) {
	if p.name == "arXiv" {
		p.mu.Lock()
		start := time.Now()
		if p.next.After(start) {
			start = p.next
		}
		p.next = start.Add(3 * time.Second)
		p.mu.Unlock()
		timer := time.NewTimer(time.Until(start))
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Gorantula-Research/1.0")
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		retry := time.Minute
		if seconds, e := strconv.Atoi(resp.Header.Get("Retry-After")); e == nil && seconds > 0 {
			retry = time.Duration(min(seconds, 86400)) * time.Second
		} else if when, e := http.ParseTime(resp.Header.Get("Retry-After")); e == nil && when.After(time.Now()) {
			retry = min(time.Until(when), 24*time.Hour)
		}
		return nil, paperAPIError{resp.StatusCode, retry}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, (4<<20)+1))
	if len(data) > 4<<20 {
		return nil, fmt.Errorf("paper response exceeds 4 MiB")
	}
	return data, err
}
func plainAbstract(s string) string {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(s))
	if err != nil {
		return ""
	}
	doc.Find("script,style").Remove()
	return strings.Join(strings.Fields(doc.Text()), " ")
}

// Remove question scaffolding while leaving scientific terms for provider search.
func paperSearchTerms(query string) []string {
	var terms []string
	for _, term := range cleanHypothesisTerms(query) {
		switch term {
		case "does", "do", "can", "how", "what", "whether", "compared", "compare", "than", "nearby", "addition", "improve", "reduce":
			continue
		}
		terms = append(terms, term)
	}
	return terms
}
func (p *paperAPI) Retrieve(ctx context.Context, query string, limit int) ([]models.Paper, error) {
	limit = max(1, min(limit, 10))
	q := url.Values{}
	var out []models.Paper
	switch p.name {
	case "Crossref":
		q.Set("query.bibliographic", query)
		q.Set("rows", strconv.Itoa(limit*3))
		data, err := p.get(ctx, q)
		if err != nil {
			return nil, err
		}
		var body struct {
			Message struct {
				Items []struct {
					DOI       string
					Title     []string
					Abstract  string
					Type      string
					Updates   []struct{ Type string } `json:"update-to"`
					UpdatedBy []struct{ Type string } `json:"updated-by"`
					Container []string                `json:"container-title"`
					Author    []struct{ Given, Family string }
					Published struct {
						Parts [][]int `json:"date-parts"`
					}
				}
			}
		}
		if err = json.Unmarshal(data, &body); err != nil {
			return nil, err
		}
		for _, w := range body.Message.Items {
			withdrawn := false
			for _, update := range append(w.Updates, w.UpdatedBy...) {
				if strings.Contains(strings.ToLower(update.Type), "retract") || update.Type == "withdrawal" {
					withdrawn = true
				}
			}
			if len(w.Title) == 0 || w.DOI == "" || w.Type == "component" || withdrawn {
				continue
			}
			if title := strings.ToLower(w.Title[0]); strings.HasPrefix(title, "retraction:") || strings.HasPrefix(title, "retracted:") || strings.HasPrefix(title, "withdrawn:") {
				continue
			}
			abstract := plainAbstract(w.Abstract)
			if abstract == "" {
				continue
			}
			paper := models.Paper{ID: "crossref-" + w.DOI, DOI: w.DOI, Provider: p.name, PublicationType: w.Type, Title: plainAbstract(w.Title[0]), Abstract: abstract, SourceURL: "https://doi.org/" + w.DOI}
			if w.Type == "posted-content" {
				paper.PublicationType = "posted-content (peer review not established)"
			}
			if len(w.Container) > 0 {
				paper.Venue = w.Container[0]
			}
			if len(w.Published.Parts) > 0 && len(w.Published.Parts[0]) > 0 {
				paper.Year = w.Published.Parts[0][0]
			}
			for _, a := range w.Author {
				paper.Authors = append(paper.Authors, strings.TrimSpace(a.Given+" "+a.Family))
			}
			out = append(out, paper)
			if len(out) == limit {
				break
			}
		}
	case "Europe PMC":
		terms := paperSearchTerms(query)
		if len(terms) == 0 {
			return nil, nil
		}
		q.Set("query", strings.Join(terms, " "))
		q.Set("format", "json")
		q.Set("resultType", "core")
		q.Set("pageSize", strconv.Itoa(limit*3))
		data, err := p.get(ctx, q)
		if err != nil {
			return nil, err
		}
		var body struct {
			ResultList struct {
				Result []struct {
					ID, Source, PMCID, DOI, Title, AbstractText, PubYear, AuthorString string
					PubTypeList                                                        struct{ PubType []string }
				}
			}
		}
		if err = json.Unmarshal(data, &body); err != nil {
			return nil, err
		}
		for _, w := range body.ResultList.Result {
			if w.ID == "" || w.Title == "" || w.AbstractText == "" || strings.Contains(strings.ToLower(strings.Join(w.PubTypeList.PubType, " ")), "retract") {
				continue
			}
			year, _ := strconv.Atoi(w.PubYear)
			source := "https://europepmc.org/article/" + url.PathEscape(w.Source) + "/" + url.PathEscape(w.ID)
			if w.PMCID != "" {
				source = "https://pmc.ncbi.nlm.nih.gov/articles/" + url.PathEscape(w.PMCID) + "/"
			}
			out = append(out, models.Paper{ID: "europepmc-" + w.Source + "-" + w.ID, DOI: w.DOI, Provider: p.name, PublicationType: strings.Join(w.PubTypeList.PubType, ", "), Title: plainAbstract(w.Title), Abstract: plainAbstract(w.AbstractText), SourceURL: source, Year: year, Authors: []string{w.AuthorString}})
			if len(out) == limit {
				break
			}
		}
	case "arXiv":
		terms := paperSearchTerms(query)
		if len(terms) == 0 {
			return nil, nil
		}
		var clauses []string
		for _, term := range terms[:min(8, len(terms))] {
			clauses = append(clauses, "all:"+strconv.Quote(term))
		}
		q.Set("search_query", strings.Join(clauses, " AND "))
		q.Set("max_results", strconv.Itoa(limit))
		q.Set("sortBy", "relevance")
		data, err := p.get(ctx, q)
		if err != nil {
			return nil, err
		}
		var feed struct {
			XMLName xml.Name `xml:"feed"`
			Entries []struct {
				ID        string `xml:"id"`
				Title     string `xml:"title"`
				Summary   string `xml:"summary"`
				Published string `xml:"published"`
				DOI       string `xml:"doi"`
				Authors   []struct {
					Name string `xml:"name"`
				} `xml:"author"`
			} `xml:"entry"`
		}
		if err = xml.Unmarshal(data, &feed); err != nil {
			return nil, err
		}
		for _, w := range feed.Entries {
			u, e := url.Parse(w.ID)
			if e != nil || (u.Host != "arxiv.org" && u.Host != "export.arxiv.org") || !strings.HasPrefix(u.Path, "/abs/") || w.Summary == "" {
				continue
			}
			year := 0
			if len(w.Published) >= 4 {
				year, _ = strconv.Atoi(w.Published[:4])
			}
			paper := models.Paper{ID: "arxiv-" + strings.TrimPrefix(u.Path, "/abs/"), DOI: w.DOI, Provider: p.name, PublicationType: "preprint (peer review not established)", Title: strings.Join(strings.Fields(w.Title), " "), Abstract: strings.TrimSpace(w.Summary), SourceURL: "https://arxiv.org" + u.Path, Year: year}
			for _, a := range w.Authors {
				paper.Authors = append(paper.Authors, a.Name)
			}
			out = append(out, paper)
		}
	default:
		return nil, fmt.Errorf("unknown paper provider")
	}
	return out, nil
}
