package research

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// openDataFetch fetches an open-data repository response. It is a variable so
// tests can stub it; production uses the bounded, public-URL-and-IP safe fetcher.
var openDataFetch = fetchResearchURL

// dataDownloadFetch fetches a candidate dataset file. It is a variable so tests
// can stub it without network.
var dataDownloadFetch = fetchDatasetURL

// maxProviderBytes bounds provider payloads that are legitimately large: one WHO
// indicator is several megabytes, well over the per-dataset analysis limit.
const maxProviderBytes = 24 << 20

// providerBulkFetch fetches a large provider payload. It is a variable so tests
// can stub it without network.
var providerBulkFetch = func(ctx context.Context, raw string) ([]byte, string, error) {
	return fetchResearchURL(ctx, raw, maxProviderBytes)
}

const openDataSearchLimit = 4 << 20

// truncateRunes shortens s to at most n runes, appending an ellipsis when it
// was cut. Used to keep summaries and descriptions within prompt bounds.
func truncateRunes(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:max(0, n-3)]) + "..."
}

// openDataset is a candidate dataset from an open-data repository (Zenodo), with
// a directly downloadable data file. It is a lead, never verified measurements.
type openDataset struct {
	Name        string
	Description string
	Provider    string
	File        string
	Size        int64
	DownloadURL string
	// Format selects the download conversion. Empty or "csv" means the body is
	// already CSV; the other values name a JSON API that is converted to CSV at
	// download time so the analysis tools see a plain table.
	Format string
	// Merge holds provider tables that are joined on country and year into this
	// candidate, for questions that need a variable from two providers (for
	// example WHO healthy life expectancy with World Bank income).
	Merge []openDataset
}

type zenodoResponse struct {
	Hits struct {
		Total int `json:"total"`
		Hits  []struct {
			ID       int `json:"id"`
			Metadata struct {
				Title       string `json:"title"`
				Description string `json:"description"`
			} `json:"metadata"`
			Files []struct {
				Key   string `json:"key"`
				Size  int64  `json:"size"`
				Links struct {
					Self string `json:"self"`
				} `json:"links"`
			} `json:"files"`
		} `json:"hits"`
	} `json:"hits"`
}

// openDataProviders are tried in order and their results are pooled, so one
// provider's loose keyword match cannot starve the others: a question about
// predator populations also matches the World Population chart, and the run
// must still see the Zenodo candidates that actually answer it. The relevance
// check is what decides which candidate is used.
var openDataProviders = []func(context.Context, string) ([]openDataset, error){
	searchWorldBank,
	searchWHO,
	searchOurWorldInData,
	func(ctx context.Context, query string) ([]openDataset, error) { return searchZenodo(ctx, query) },
	// A natural-language topic often does not match dataset titles. Retry with a
	// dataset-oriented query and a wider scan to surface records whose metadata
	// carries the measurements even when the title does not.
	func(ctx context.Context, query string) ([]openDataset, error) {
		return searchZenodo(ctx, "everything:"+query+" AND (dataset OR data OR measurements OR csv)")
	},
}

// openDataCandidateLimit bounds how many candidates the pooled search returns.
const openDataCandidateLimit = 7

// searchOpenData queries every open-data provider for a topic-relevant dataset
// with a directly downloadable CSV/TSV, or a JSON indicator API that converts to
// one. It returns candidates with their download URLs; it never verifies the
// measurements. A read that yields nothing or fails is an honest "no candidate",
// never a fabricated dataset.
func searchOpenData(ctx context.Context, query string) ([]openDataset, error) {
	if strings.TrimSpace(query) == "" {
		return nil, fmt.Errorf("a dataset search query is required")
	}
	var out []openDataset
	seen := map[string]bool{}
	for _, search := range openDataProviders {
		if len(out) >= openDataCandidateLimit {
			break
		}
		found, err := search(ctx, query)
		if err != nil {
			continue
		}
		for _, candidate := range found {
			if seen[candidate.DownloadURL] {
				continue
			}
			seen[candidate.DownloadURL] = true
			out = append(out, candidate)
		}
	}
	// A question that names a variable only one provider holds needs both
	// tables joined before any calculation. Put the merged table first so the
	// relevance check sees it, and leave the parts available as fallbacks.
	if merged, ok := mergeProviderCandidates(out); ok {
		out = append([]openDataset{merged}, out...)
	}
	return out, nil
}

// mergeProviderCandidates joins one World Bank table with one WHO table on
// country and year. It returns false unless exactly one usable candidate comes
// from each provider, so a single-provider question is unaffected.
func mergeProviderCandidates(candidates []openDataset) (openDataset, bool) {
	var worldBank, who *openDataset
	for i := range candidates {
		switch candidates[i].Provider {
		case "World Bank":
			if worldBank == nil {
				worldBank = &candidates[i]
			}
		case "WHO":
			if who == nil {
				who = &candidates[i]
			}
		}
	}
	if worldBank == nil || who == nil {
		return openDataset{}, false
	}
	return openDataset{
		Name:        worldBank.Name + " joined with " + who.Name + " — World Bank + WHO, by country and year",
		Description: "World Bank indicator and WHO indicator joined on country and year, so both variables are in one table.",
		Provider:    "World Bank + WHO",
		File:        worldBank.File + "+" + who.File,
		DownloadURL: worldBank.DownloadURL,
		Format:      "merge",
		Merge:       []openDataset{*worldBank, *who},
	}, true
}

// searchZenodo queries the Zenodo API for records with a directly downloadable
// CSV/TSV file, returning up to four candidates.
func searchZenodo(ctx context.Context, query string) ([]openDataset, error) {
	if strings.TrimSpace(query) == "" {
		return nil, fmt.Errorf("a dataset search query is required")
	}
	v := url.Values{}
	v.Set("q", query)
	v.Set("size", "12")
	endpoint := "https://zenodo.org/api/records?" + v.Encode()
	data, _, err := openDataFetch(ctx, endpoint, openDataSearchLimit)
	if err != nil {
		return nil, err
	}
	var body zenodoResponse
	if err := json.Unmarshal(data, &body); err != nil {
		return nil, err
	}
	var out []openDataset
	for _, hit := range body.Hits.Hits {
		var best *struct {
			Key   string `json:"key"`
			Size  int64  `json:"size"`
			Links struct {
				Self string `json:"self"`
			} `json:"links"`
		}
		for i := range hit.Files {
			key := strings.ToLower(hit.Files[i].Key)
			if strings.HasSuffix(key, ".csv") || strings.HasSuffix(key, ".tsv") {
				best = &hit.Files[i]
				break
			}
		}
		if best == nil {
			continue
		}
		out = append(out, openDataset{
			Name:        strings.TrimSpace(hit.Metadata.Title),
			Description: truncateRunes(strings.TrimSpace(hit.Metadata.Description), 900),
			Provider:    "Zenodo",
			File:        best.Key,
			Size:        best.Size,
			DownloadURL: best.Links.Self,
		})
		if len(out) >= 4 {
			break
		}
	}
	return out, nil
}
