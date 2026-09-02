package app

import (
	"context"
	"net/url"
	"strings"

	"github.com/Andyi955/Gorantula/internal/brainmemory"
	"github.com/Andyi955/Gorantula/models"
)

const maxBrainSourceLookupResults = 3

type brainSourceSignalRunner interface {
	RunSignals(ctx context.Context, signals []models.NerveSignal) ([]models.NutrientFlow, error)
}

// brainSourceEvidenceFinder resolves missing source evidence for autonomy
// blockers by running the web leg on the suggestion's search prompt and
// keeping the first valid source URLs it finds.
type brainSourceEvidenceFinder struct {
	runner brainSourceSignalRunner
}

func (f brainSourceEvidenceFinder) FindSourceEvidence(ctx context.Context, request brainmemory.SourceEvidenceLookupRequest) ([]brainmemory.BrainSuggestionSourceEvidence, error) {
	if f.runner == nil {
		return nil, nil
	}
	query := brainSourceLookupQuery(request)
	if query == "" {
		return nil, nil
	}

	flows, err := f.runner.RunSignals(ctx, []models.NerveSignal{{TargetQuery: query, LegID: 0}})
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{}, len(flows))
	evidence := make([]brainmemory.BrainSuggestionSourceEvidence, 0, len(flows))
	for _, flow := range flows {
		if flow.Error != nil {
			continue
		}
		sourceURL := strings.TrimSpace(flow.SourceURL)
		if !brainSourceLookupURL(sourceURL) {
			continue
		}
		if _, ok := seen[sourceURL]; ok {
			continue
		}
		seen[sourceURL] = struct{}{}
		evidence = append(evidence, brainmemory.BrainSuggestionSourceEvidence{
			SourceURL:  sourceURL,
			EvidenceID: "web-source",
			Note:       "Auto-found online by Brain source lookup.",
		})
		if len(evidence) == maxBrainSourceLookupResults {
			break
		}
	}
	return evidence, nil
}

func brainSourceLookupQuery(request brainmemory.SourceEvidenceLookupRequest) string {
	if prompt := strings.TrimSpace(request.SearchPrompt); prompt != "" {
		return prompt
	}
	suggestion := request.Suggestion
	return strings.TrimSpace(strings.Join([]string{
		suggestion.Title,
		suggestion.Summary,
		suggestion.Reason,
	}, " "))
}

func brainSourceLookupURL(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Hostname() == "" {
		return false
	}
	return parsed.Scheme == "http" || parsed.Scheme == "https"
}
