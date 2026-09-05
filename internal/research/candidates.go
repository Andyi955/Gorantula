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

// evaluateChecklist applies the bounded checklist to a candidate via the
// deterministic heuristic (used when no LLM reviewer is available) and sets its
// Checklist, Verdict, State, and EvidenceGrade.
func evaluateChecklist(candidate *models.CandidateHypothesis, claims []models.Claim) {
	candidate.Checklist = make([]models.ChecklistItem, 0, len(candidateChecklist))
	for _, criterion := range candidateChecklist {
		answer := criterion.Evaluate(*candidate, claims)
		if answer == "" {
			answer = "unknown"
		}
		candidate.Checklist = append(candidate.Checklist, models.ChecklistItem{
			ID:       criterion.ID,
			Question: criterion.Question,
			Answer:   answer,
			Grade:    checklistGrade(answer),
		})
	}
	finalizeCandidate(candidate)
}

// applyChecklistReviews builds the candidate's checklist from the reviewer
// persona's answers (the bounded-review debate roster) plus the plain-language
// rationale and one-line status summary, and finalizes the verdict. Any
// criterion the reviewer did not answer is left unknown.
func applyChecklistReviews(candidate *models.CandidateHypothesis, reviews []models.ChecklistReviewItem, rationale, summary string) {
	candidate.Rationale = strings.TrimSpace(rationale)
	candidate.Summary = strings.TrimSpace(summary)
	reviewsByID := make(map[string]models.ChecklistReviewItem, len(reviews))
	for _, review := range reviews {
		reviewsByID[review.ID] = review
	}

	candidate.Checklist = make([]models.ChecklistItem, 0, len(candidateChecklist))
	for _, criterion := range candidateChecklist {
		review, ok := reviewsByID[criterion.ID]
		answer := "unknown"
		if ok && review.Answer != "" {
			answer = review.Answer
		}
		candidate.Checklist = append(candidate.Checklist, models.ChecklistItem{
			ID:         criterion.ID,
			Question:   criterion.Question,
			Answer:     answer,
			Grade:      checklistGrade(answer),
			Reason:     review.Reason,
			Confidence: review.Confidence,
		})
	}
	finalizeCandidate(candidate)
}

// finalizeCandidate computes the verdict, evidence grade, and state transition
// from the populated checklist.
func finalizeCandidate(candidate *models.CandidateHypothesis) {
	yes, unknown, criticalNo := 0, 0, 0
	for _, item := range candidate.Checklist {
		switch item.Answer {
		case "yes":
			yes++
		case "unknown":
			unknown++
		case "no":
			if isCriticalChecklistItem(item.ID) {
				criticalNo++
			}
		}
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

	// Terminal (already-decided) candidates are never re-finalized by the
	// review pipeline; only proposed/reviewed candidates transition here.
	if candidate.State == models.CandidateStateApproved || candidate.State == models.CandidateStateRejected {
		return
	}

	switch candidate.Verdict {
	case models.CandidateVerdictRefuted:
		candidate.State = models.CandidateStateRefuted
	default:
		candidate.State = models.CandidateStateReviewed
	}
}

func isCriticalChecklistItem(id string) bool {
	for _, criterion := range candidateChecklist {
		if criterion.ID == id {
			return criterion.Critical
		}
	}
	return false
}

// claimsForCandidate returns only the claims referenced by the candidate's
// claim IDs, so a reviewer judges the candidate against its own evidence.
func claimsForCandidate(claims []models.Claim, candidate models.CandidateHypothesis) []models.Claim {
	if len(candidate.ClaimIDs) == 0 {
		return nil
	}
	byID := make(map[string]models.Claim, len(claims))
	for _, claim := range claims {
		byID[claim.ID] = claim
	}
	next := make([]models.Claim, 0, len(candidate.ClaimIDs))
	for _, id := range candidate.ClaimIDs {
		if claim, ok := byID[id]; ok {
			next = append(next, claim)
		}
	}
	return next
}

// papersForCandidate returns only the papers referenced by the candidate's
// paper IDs, so a reviewer can read the underlying paper text.
func papersForCandidate(candidate models.CandidateHypothesis, papers []models.Paper) []models.Paper {
	if len(candidate.PaperIDs) == 0 {
		return nil
	}
	byID := make(map[string]models.Paper, len(papers))
	for _, paper := range papers {
		byID[paper.ID] = paper
	}
	next := make([]models.Paper, 0, len(candidate.PaperIDs))
	for _, id := range candidate.PaperIDs {
		if paper, ok := byID[id]; ok {
			next = append(next, paper)
		}
	}
	return next
}

// updateNoveltyAnswer sets the novelty checklist item from the novelty score
// (novel >= 0.6 -> yes, else unknown) and re-finalizes the verdict. Novelty is
// deterministic after the gate runs, so it needs no extra LLM call.
func updateNoveltyAnswer(candidate *models.CandidateHypothesis) {
	for i := range candidate.Checklist {
		if candidate.Checklist[i].ID != "novelty" {
			continue
		}
		if candidate.NoveltyScore >= 0.6 {
			candidate.Checklist[i].Answer = "yes"
		} else {
			candidate.Checklist[i].Answer = "unknown"
		}
		candidate.Checklist[i].Grade = checklistGrade(candidate.Checklist[i].Answer)
	}
	finalizeCandidate(candidate)
}

// neutralizeContradictionCriticalItems treats a contradiction as a review-worthy
// disagreement rather than a failed hypothesis: consistency and coherence are
// not meaningful for an intentionally-conflicting pair, so they go unknown and
// the candidate is routed to the human (disputed) instead of refuted.
func neutralizeContradictionCriticalItems(candidate *models.CandidateHypothesis) {
	if !candidateIsContradiction(*candidate) {
		return
	}
	for i := range candidate.Checklist {
		if candidate.Checklist[i].ID == "consistency" || candidate.Checklist[i].ID == "coherence" {
			candidate.Checklist[i].Answer = "unknown"
			candidate.Checklist[i].Grade = "unresolved"
		}
	}
	finalizeCandidate(candidate)
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
