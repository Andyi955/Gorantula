package research

import (
	"context"
	"fmt"
	"github.com/Andyi955/Gorantula/models"
	"strings"
)

// Reserve three preparation calls for the agent. Probe at most three source
// pages and two observed supplementary links; never invent a URL or import data.
func (s *Service) discoverTopicData(ctx context.Context, run *models.VerificationRun) error {
	if err := s.topicStage(run, "checking", "Checking paper pages and observed supplementary-data links before assessing data availability."); err != nil {
		return err
	}
	attempted := map[string]bool{}
	for _, a := range run.DatasetActions {
		if a.Call.URL != "" {
			attempted[a.Call.URL] = true
		}
	}
	follow := []string{}
	calls := 0
	probe := func(u string) error {
		if attempted[u] || calls >= 5 || len(run.DatasetActions) >= 5 {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		attempted[u] = true
		result := s.executeDatasetCall(ctx, run, models.DatasetCall{Tool: "dataset-discover", URL: u})
		run.DatasetActions = append(run.DatasetActions, result)
		calls++
		if result.Error == "" {
			follow = append(follow, result.Links...)
		}
		return s.saveVerificationRun(*run)
	}
	sources := 0
	for _, u := range run.PaperSources {
		if attempted[u] || strings.TrimSpace(u) == "" {
			continue
		}
		if sources >= 3 {
			break
		}
		sources++
		if err := probe(u); err != nil {
			return err
		}
	}
	// One Brave fallback uses the existing credential when paper pages yield no
	// supplementary links. Search hits are leads, never verified source evidence.
	searched := false
	for _, a := range run.DatasetActions {
		if a.Call.Tool == "web-search" {
			searched = true
		}
	}
	if len(follow) == 0 && !searched && s.webSearch != nil && len(run.DatasetActions) < 5 {
		if err := ctx.Err(); err != nil {
			return err
		}
		query := run.Request.Topic + " (site:datadryad.org OR site:zenodo.org OR site:figshare.com OR site:github.com OR site:pmc.ncbi.nlm.nih.gov)"
		if err := s.topicStage(run, "checking", "Paper pages yielded no data links. Searching Brave for accessible repository and supplementary-data leads."); err != nil {
			return err
		}
		links, err := s.webSearch(ctx, query, 5)
		result := models.DatasetResult{Call: models.DatasetCall{Tool: "web-search", Query: query}, Links: links, Summary: "Brave search leads only. Verify relevance and provenance on the destination page before using data; search ranking is not evidence."}
		if err != nil {
			result.Links = nil
			result.Error = err.Error()
		} else {
			follow = append(follow, links...)
		}
		run.DatasetActions = append(run.DatasetActions, result)
		if err := s.saveVerificationRun(*run); err != nil {
			return err
		}
	}
	// Only follow one observed level, avoiding link cycles and crawler expansion.
	observed := append([]string{}, follow...)
	for _, u := range observed {
		if err := probe(u); err != nil {
			return err
		}
		if calls >= 5 {
			break
		}
	}
	return s.topicStage(run, "checking", fmt.Sprintf("Recorded %d source/data-page attempts. The agent is assessing returned links, access errors and available measurements.", calls))
}
