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

// searchOpenData queries open-data repositories (Zenodo primary, then a
// dataset-oriented retry) for a topic-relevant dataset with a directly
// downloadable CSV/TSV. It returns candidates with their download URLs; it never
// verifies the measurements. A read that yields nothing or fails is an honest
// "no candidate", never a fabricated dataset.
func searchOpenData(ctx context.Context, query string) ([]openDataset, error) {
	if strings.TrimSpace(query) == "" {
		return nil, fmt.Errorf("a dataset search query is required")
	}
	if out, err := searchZenodo(ctx, query); err == nil && len(out) > 0 {
		return out, nil
	}
	// A natural-language topic often does not match dataset titles. Retry with a
	// dataset-oriented query and a wider scan to surface records whose metadata
	// carries the measurements even when the title does not.
	wide := "everything:" + query + " AND (dataset OR data OR measurements OR csv)"
	if out, err := searchZenodo(ctx, wide); err == nil && len(out) > 0 {
		return out, nil
	}
	return nil, nil
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
