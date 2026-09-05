package research

import (
	"context"
	"fmt"
	"strings"

	"github.com/Andyi955/Gorantula/models"
)

// Evidence-expansion budget: bounded so the loop always terminates and never
// drags in a corpus to force unknowns toward yes.
const (
	expansionMaxRounds   = 1 // hard cap on expansion rounds per candidate
	expansionMaxCriteria = 3 // criteria attempted per round
	expansionMaxPapers   = 4 // papers fetched per criterion
	expansionMinSources  = 2 // must find >=2 relevant sources before attempting a flip
)

// expandCandidateEvidence runs one bounded expansion round: for the candidate's
// still-unknown criteria, fetch related papers, and if enough independent
// sources are found, re-run the reviewer against that expanded evidence. A
// single niche paper never flips an unknown (expansionMinSources), and the
// reviewer is told to only resolve when evidence is clearly/consistently
// supported - never to force a yes.
func (s *Service) expandCandidateEvidence(ctx context.Context, candidate *models.CandidateHypothesis, claims []models.Claim, papers []models.Paper) {
	if s.retriever == nil {
		return
	}
	if candidate.State == models.CandidateStateApproved || candidate.State == models.CandidateStateRejected {
		return
	}

	round := 0
	if candidate.Expansion != nil {
		round = candidate.Expansion.Round
	}
	if round >= expansionMaxRounds {
		trace("expansion", fmt.Sprintf("candidate %s: expansion round cap reached", candidate.ID))
		return
	}

	unknownIDs := unknownChecklistIDs(candidate)
	if len(unknownIDs) == 0 {
		trace("expansion", fmt.Sprintf("candidate %s: no unknowns to resolve", candidate.ID))
		return
	}
	if len(unknownIDs) > expansionMaxCriteria {
		unknownIDs = unknownIDs[:expansionMaxCriteria]
	}

	evidenceClaims := claimsForCandidate(claims, *candidate)
	retrieved := make([]models.Paper, 0, expansionMaxCriteria*expansionMaxPapers)
	seen := make(map[string]struct{})
	for _, criterionID := range unknownIDs {
		query := expansionQuery(*candidate, evidenceClaims, criterionID)
		fetched, err := s.retriever.Retrieve(ctx, query, expansionMaxPapers)
		if err != nil {
			trace("expansion", fmt.Sprintf("candidate %s criterion %s retrieval failed: %v", candidate.ID, criterionID, err))
			continue
		}
		for _, paper := range fetched {
			if _, ok := seen[paper.ID]; ok {
				continue
			}
			seen[paper.ID] = struct{}{}
			retrieved = append(retrieved, paper)
		}
	}

	if len(retrieved) < expansionMinSources {
		trace("expansion", fmt.Sprintf("candidate %s: only %d related source(s) found for %d criterion(s); leaving unknowns unresolved",
			candidate.ID, len(retrieved), len(unknownIDs)))
		return
	}

	candidate.Expansion = &models.CandidateExpansion{
		Round:     round + 1,
		Criteria:  unknownIDs,
		Retrieved: retrieved,
	}
	trace("expansion", fmt.Sprintf("candidate %s: expanded with %d related paper(s) for %d criterion(s)",
		candidate.ID, len(retrieved), len(unknownIDs)))

	if s.brain == nil {
		trace("expansion", fmt.Sprintf("candidate %s: no provider; expansion recorded but not re-reviewed", candidate.ID))
		return
	}
	s.applyReviewWithExpansion(ctx, candidate, claims, papers, retrieved)
}

func (s *Service) applyReviewWithExpansion(ctx context.Context, candidate *models.CandidateHypothesis, claims []models.Claim, papers, extra []models.Paper) {
	evidenceClaims := claimsForCandidate(claims, *candidate)
	reviewPapers := append(append([]models.Paper(nil), papersForCandidate(*candidate, papers)...), extra...)
	reviews, rationale, summary, err := s.brain.ReviewCandidateChecklist(ctx, candidate.Hypothesis, evidenceClaims, reviewPapers)
	if err != nil {
		trace("expansion", fmt.Sprintf("candidate %s re-review failed: %v", candidate.ID, err))
		return
	}
	applyChecklistReviews(candidate, reviews, rationale, summary)
	neutralizeContradictionCriticalItems(candidate)
	updateNoveltyAnswer(candidate)
	trace("expansion", fmt.Sprintf("candidate %s checklist updated from expanded evidence", candidate.ID))
}

func unknownChecklistIDs(candidate *models.CandidateHypothesis) []string {
	var ids []string
	for _, item := range candidate.Checklist {
		if item.Answer == "unknown" {
			ids = append(ids, item.ID)
		}
	}
	return ids
}

// expansionQuery builds a literature query from the candidate's entities plus
// the specific missing quantity for the criterion.
func expansionQuery(candidate models.CandidateHypothesis, claims []models.Claim, criterionID string) string {
	parts := entityNameParts(claims, candidate)
	term := criterionQueryTerm(criterionID)
	if term != "" {
		parts = append(parts, term)
	}
	if len(parts) == 0 {
		parts = append(parts, strings.TrimSpace(candidate.Hypothesis))
	}
	if len(parts) > 5 {
		parts = parts[:5]
	}
	return strings.Join(parts, " ")
}

func entityNameParts(claims []models.Claim, candidate models.CandidateHypothesis) []string {
	seen := make(map[string]struct{})
	var parts []string
	for _, claim := range claims {
		for _, entity := range claim.Entities {
			if _, name, ok := splitEntityTagForNovelty(entity); ok && name != "" {
				if _, dup := seen[strings.ToLower(name)]; dup {
					continue
				}
				seen[strings.ToLower(name)] = struct{}{}
				parts = append(parts, name)
			}
		}
	}
	return parts
}

func criterionQueryTerm(id string) string {
	switch id {
	case "strength", "precision":
		return "effect size"
	case "statistical_rigor":
		return "confidence interval"
	case "plausibility":
		return "mechanism"
	case "alternatives":
		return "confounders"
	case "reproducibility":
		return "reproducible data"
	case "consistency":
		return "independent replication"
	case "gradient":
		return "dose response"
	case "temporality":
		return "causal"
	default:
		return ""
	}
}
