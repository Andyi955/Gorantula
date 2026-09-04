package brain

import (
	"context"
	"fmt"
	"strings"

	"github.com/Andyi955/Gorantula/models"
)

// researchReviewSourceLimit caps the evidence text sent to the reviewer so a
// long candidate does not blow the prompt budget.
const researchReviewSourceLimit = 6000

// ReviewCandidateChecklist runs the bounded-review committee (a reviewer
// persona) over a candidate hypothesis, answering each checklist criterion as
// yes / no / unknown against the grounded evidence. Unknown means the evidence
// does not contain enough to judge - the reviewer never guesses.
func (b *Brain) ReviewCandidateChecklist(ctx context.Context, hypothesis string, claims []models.Claim) ([]models.ChecklistReviewItem, error) {
	provider := b.GetSearchProvider()
	if provider == nil {
		return nil, fmt.Errorf("no model providers available for checklist review")
	}

	evidence := formatReviewEvidence(claims)
	if strings.TrimSpace(evidence) == "" {
		evidence = "(no grounded evidence provided)"
	}

	prompt := fmt.Sprintf(researchReviewPromptTemplate,
		strings.TrimSpace(hypothesis),
		truncateRunes(evidence, researchReviewSourceLimit),
		researchChecklistCriteria,
	)

	var resp models.ChecklistReviewResponse
	if err := provider.GenerateJSON(ctx, prompt, &resp); err != nil {
		return nil, err
	}

	normalized := make([]models.ChecklistReviewItem, 0, len(resp.Items))
	for _, item := range resp.Items {
		item.ID = strings.TrimSpace(item.ID)
		item.Answer = normalizeReviewAnswer(item.Answer)
		item.Reason = strings.TrimSpace(item.Reason)
		if item.ID == "" || item.Answer == "" {
			continue
		}
		normalized = append(normalized, item)
	}
	return normalized, nil
}

func normalizeReviewAnswer(answer string) string {
	switch strings.ToLower(strings.TrimSpace(answer)) {
	case "yes":
		return "yes"
	case "no":
		return "no"
	default:
		return "unknown"
	}
}

func formatReviewEvidence(claims []models.Claim) string {
	var builder strings.Builder
	for _, claim := range claims {
		fmt.Fprintf(&builder, "[%s] %s\n", claim.ID, strings.TrimSpace(claim.Text))
		if len(claim.Entities) > 0 {
			fmt.Fprintf(&builder, "  entities: %s\n", strings.Join(claim.Entities, " "))
		}
		if snippet := strings.TrimSpace(claim.SourceSnippet); snippet != "" {
			fmt.Fprintf(&builder, "  source: %s\n", snippet)
		}
	}
	return builder.String()
}

const researchReviewPromptTemplate = `You are a scientific review committee (Methods Reviewer, Domain Oracle, Red-Team Critic) deciding how credible a candidate research hypothesis is, based ONLY on the evidence text below.

For EACH criterion answer:
- "yes" = there is clear evidence in the text to satisfy it.
- "no" = the evidence clearly fails this criterion.
- "unknown" = there is NOT ENOUGH evidence in the provided text to judge this criterion. NEVER guess; unknown is the honest answer when the papers do not report the needed information.

Return ONLY a valid JSON object: {"items":[{"id":"precision","answer":"yes|no|unknown","reason":"one short sentence","confidence":0.9}]}. Include an item for EVERY criterion below.

CANDIDATE HYPOTHESIS: %s

EVIDENCE (grounded claims + source snippets):
%s

CRITERIA:
%s`

const researchChecklistCriteria = `precision - Is the claim stated with exact quantities, conditions, and scope?
temporality - Does the cause precede the effect (for causal claims)?
strength - Is the effect size strong enough to matter?
consistency - Is it independently replicated (cross-paper convergence)?
specificity - Does the effect point at a specific cause?
gradient - Is there a dose-response or monotonic pattern?
plausibility - Is a mechanism known or the claim coherent with theory?
coherence - Consistent with the broader literature - no cherry-picking?
alternatives - Are confounds / alternative explanations excluded or bounded?
statistical_rigor - Correct test, multiple-comparison control, effect size + CI, power?
reproducibility - Can a third party rerun it (data + code + artifacts)?
novelty - Not already established (novelty gate)?
language - No overclaiming - 'supports' instead of 'proves'?`
