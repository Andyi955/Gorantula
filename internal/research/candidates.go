package research

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/Andyi955/Gorantula/models"
)

type checklistCriterion struct {
	ID       string
	Question string
	Critical bool
	Evaluate func(candidate models.CandidateHypothesis, claims []models.Claim) string
}

var candidateChecklist = []checklistCriterion{
	{ID: "precision", Question: "Is the claim stated with exact quantities, conditions, and scope?", Critical: false, Evaluate: func(c models.CandidateHypothesis, claims []models.Claim) string {
		if claimsHaveNumber(claims, c) {
			return "yes"
		}
		return "unknown"
	}},
	{ID: "temporality", Question: "Does the cause precede the effect (for causal claims)?", Critical: false, Evaluate: func(c models.CandidateHypothesis, claims []models.Claim) string {
		if !claimsHaveCausalLanguage(claims) {
			return "unknown"
		}
		return "yes"
	}},
	{ID: "strength", Question: "Is the effect size strong enough to matter?", Critical: false, Evaluate: func(c models.CandidateHypothesis, claims []models.Claim) string {
		if claimsHaveNumber(claims, c) {
			return "yes"
		}
		return "unknown"
	}},
	{ID: "consistency", Question: "Is it independently replicated (cross-paper convergence)?", Critical: true, Evaluate: func(c models.CandidateHypothesis, claims []models.Claim) string {
		// A contradiction is a genuine disagreement - not a consistency pass and
		// not a refutation of the finding - so leave it for the human to judge.
		if candidateIsContradiction(c) {
			return "unknown"
		}
		return "yes"
	}},
	{ID: "specificity", Question: "Does the effect point at a specific cause?", Critical: false, Evaluate: func(c models.CandidateHypothesis, claims []models.Claim) string {
		if len(claimEntities(claims, c)) > 0 {
			return "yes"
		}
		return "unknown"
	}},
	{ID: "gradient", Question: "Is there a dose–response or monotonic pattern?", Critical: false, Evaluate: func(_ models.CandidateHypothesis, _ []models.Claim) string {
		return "unknown"
	}},
	{ID: "plausibility", Question: "Is a mechanism known or the claim coherent with theory?", Critical: false, Evaluate: func(c models.CandidateHypothesis, claims []models.Claim) string {
		if claimsHaveMechanism(claims) {
			return "yes"
		}
		return "unknown"
	}},
	{ID: "coherence", Question: "Consistent with the broader literature — no cherry-picking?", Critical: true, Evaluate: func(c models.CandidateHypothesis, claims []models.Claim) string {
		if allClaimsGrounded(claims, c) {
			return "yes"
		}
		return "unknown"
	}},
	{ID: "alternatives", Question: "Are confounds / alternative explanations excluded or bounded?", Critical: true, Evaluate: func(c models.CandidateHypothesis, claims []models.Claim) string {
		if strings.Contains(strings.ToLower(c.Hypothesis), "confound") || strings.Contains(strings.ToLower(c.Hypothesis), "alternative explanation") {
			return "yes"
		}
		return "unknown"
	}},
	{ID: "statistical_rigor", Question: "Correct test, multiple-comparison control, effect size + CI, power?", Critical: true, Evaluate: func(c models.CandidateHypothesis, claims []models.Claim) string {
		if claimsHaveStatsLanguage(claims) {
			return "yes"
		}
		return "unknown"
	}},
	{ID: "reproducibility", Question: "Can a third party rerun it (data + code + artifacts)?", Critical: true, Evaluate: func(c models.CandidateHypothesis, claims []models.Claim) string {
		if allClaimsGrounded(claims, c) {
			return "yes"
		}
		return "unknown"
	}},
	{ID: "novelty", Question: "Not already established (novelty gate)?", Critical: false, Evaluate: func(c models.CandidateHypothesis, _ []models.Claim) string {
		// Novelty is an informational axis, not a credibility gate: low novelty
		// means "already partially covered", which a human should review rather
		// than auto-refute. Only a clear novelty check marks it yes/unknown.
		if c.NoveltyScore >= 0.6 {
			return "yes"
		}
		return "unknown"
	}},
	{ID: "language", Question: "No overclaiming — 'supports' instead of 'proves'?", Critical: false, Evaluate: func(c models.CandidateHypothesis, _ []models.Claim) string {
		if strings.Contains(strings.ToLower(c.Hypothesis), "proves") || strings.Contains(strings.ToLower(c.Hypothesis), "proven") {
			return "no"
		}
		return "yes"
	}},
}

// buildCandidates promotes each contradiction/convergence signal into a
// reviewable candidate hypothesis.
func buildCandidates(signals []models.ResearchSignal, claims []models.Claim) []models.CandidateHypothesis {
	claimByID := make(map[string]models.Claim, len(claims))
	for _, claim := range claims {
		claimByID[claim.ID] = claim
	}

	var candidates []models.CandidateHypothesis
	for _, signal := range signals {
		switch signal.Kind {
		case models.ResearchSignalContradiction:
			candidates = append(candidates, candidateFromSignal(signal))
		case models.ResearchSignalConvergence:
			candidates = append(candidates, candidateFromSignal(signal))
		}
	}
	return candidates
}

func candidateFromSignal(signal models.ResearchSignal) models.CandidateHypothesis {
	hypothesis := signal.Title
	if strings.TrimSpace(hypothesis) == "" {
		hypothesis = "A cross-paper finding worth reviewing."
	}
	return models.CandidateHypothesis{
		ID:         fmt.Sprintf("candidate-%s", signal.ID),
		SignalID:   signal.ID,
		Hypothesis: hypothesis,
		ClaimIDs:   append([]string(nil), signal.ClaimIDs...),
		PaperIDs:   append([]string(nil), signal.PaperIDs...),
		State:      models.CandidateStateProposed,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
	}
}

// evaluateChecklist applies the bounded checklist to a candidate and sets its
// Checklist, Verdict, and EvidenceGrade.
func evaluateChecklist(candidate *models.CandidateHypothesis, claims []models.Claim) {
	candidate.Checklist = make([]models.ChecklistItem, 0, len(candidateChecklist))
	yes, unknown, criticalNo := 0, 0, 0
	for _, criterion := range candidateChecklist {
		answer := criterion.Evaluate(*candidate, claims)
		if answer == "" {
			answer = "unknown"
		}
		grade := checklistGrade(answer)
		if answer == "yes" {
			yes++
		} else if answer == "unknown" {
			unknown++
		} else if criterion.Critical {
			criticalNo++
		}
		candidate.Checklist = append(candidate.Checklist, models.ChecklistItem{
			ID:       criterion.ID,
			Question: criterion.Question,
			Answer:   answer,
			Grade:    grade,
		})
	}

	switch {
	case criticalNo > 0:
		candidate.Verdict = models.CandidateVerdictRefuted
	case unknown > 0:
		candidate.Verdict = models.CandidateVerdictDisputed
	default:
		candidate.Verdict = models.CandidateVerdictAgreed
	}
	candidate.EvidenceGrade = evidenceGradeFromCounts(yes, unknown)

	switch candidate.Verdict {
	case models.CandidateVerdictRefuted:
		if candidate.State == models.CandidateStateProposed {
			candidate.State = models.CandidateStateRefuted
		}
	default:
		if candidate.State == models.CandidateStateProposed {
			candidate.State = models.CandidateStateReviewed
		}
	}
}

func checklistGrade(answer string) string {
	switch answer {
	case "yes":
		return "moderate"
	case "unknown":
		return "unresolved"
	default:
		return "not-supported"
	}
}

func evidenceGradeFromCounts(yes, unknown int) string {
	if unknown == 0 && yes >= 11 {
		return "high"
	}
	if unknown <= 2 && yes >= 8 {
		return "moderate"
	}
	if unknown <= 5 {
		return "low"
	}
	return "very-low"
}

// ---- simple heuristic detectors for checklist items (deterministic) ----

var numberPattern = regexp.MustCompile(`\d`)
var causalWords = []string{"causes", "increases", "decreases", "reduces", "improves", "drives", "induces", "prevents", "raises"}
var mechanismWords = []string{"because", "via", "through", "mechanism", "pathway", "mediates"}
var statsWords = []string{"%", "ci", "confidence interval", "p<", "p <", "p-value", "effect size", "cohen", "f1", "auc", "correlation", "r =", "r="}

func candidateIsContradiction(candidate models.CandidateHypothesis) bool {
	return strings.Contains(strings.ToLower(candidate.Hypothesis), "contradiction")
}

func claimEntities(claims []models.Claim, candidate models.CandidateHypothesis) []string {
	entitySet := map[string]struct{}{}
	for _, claim := range claims {
		for _, entity := range claim.Entities {
			if _, ok := entitySet[entity]; !ok {
				entitySet[entity] = struct{}{}
			}
		}
	}
	keys := make([]string, 0, len(entitySet))
	for entity := range entitySet {
		keys = append(keys, entity)
	}
	return keys
}

func claimsHaveNumber(claims []models.Claim, _ models.CandidateHypothesis) bool {
	for _, claim := range claims {
		if numberPattern.MatchString(claim.Text) {
			return true
		}
	}
	return false
}

func claimsHaveCausalLanguage(claims []models.Claim) bool {
	for _, claim := range claims {
		lower := strings.ToLower(claim.Text)
		for _, word := range causalWords {
			if strings.Contains(lower, word) {
				return true
			}
		}
	}
	return false
}

func claimsHaveMechanism(claims []models.Claim) bool {
	for _, claim := range claims {
		lower := strings.ToLower(claim.Text)
		for _, word := range mechanismWords {
			if strings.Contains(lower, word) {
				return true
			}
		}
	}
	return false
}

func claimsHaveStatsLanguage(claims []models.Claim) bool {
	for _, claim := range claims {
		lower := strings.ToLower(claim.Text)
		for _, word := range statsWords {
			if strings.Contains(lower, word) {
				return true
			}
		}
	}
	return false
}

func allClaimsGrounded(claims []models.Claim, candidate models.CandidateHypothesis) bool {
	for _, claim := range claims {
		if strings.TrimSpace(claim.SourceSnippet) == "" && strings.TrimSpace(claim.Text) == "" {
			return false
		}
	}
	return len(claims) > 0
}
