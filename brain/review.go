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
// yes / no / unknown against the grounded evidence, plus a plain-language
// "why" rationale and a one-line status summary. The reviewer reads the
// referenced claims AND the underlying papers' abstracts. Unknown means the
// evidence does not contain enough to judge - the reviewer never guesses.
func (b *Brain) ReviewCandidateChecklist(ctx context.Context, hypothesis string, claims []models.Claim, papers []models.Paper) ([]models.ChecklistReviewItem, string, string, error) {
	provider := b.GetSearchProvider()
	if provider == nil {
		return nil, "", "", fmt.Errorf("no model providers available for checklist review")
	}

	evidence := formatReviewEvidence(claims, papers)
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
		return nil, "", "", err
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
	return normalized, strings.TrimSpace(resp.Rationale), strings.TrimSpace(resp.Summary), nil
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

func formatReviewEvidence(claims []models.Claim, papers []models.Paper) string {
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

	seen := make(map[string]struct{}, len(papers))
	for _, paper := range papers {
		if _, ok := seen[paper.ID]; ok {
			continue
		}
		seen[paper.ID] = struct{}{}
		abstract := strings.TrimSpace(paper.Abstract)
		if abstract == "" {
			continue
		}
		fmt.Fprintf(&builder, "\n[PAPER %s] %s\n%s\n", paper.ID, strings.TrimSpace(paper.Title), abstract)
	}
	return builder.String()
}

const researchReviewPromptTemplate = `You are a scientific review committee (Methods Reviewer, Domain Oracle, Red-Team Critic) deciding how credible a candidate research hypothesis is, based ONLY on the evidence text below.

For EACH criterion answer:
- "yes" = the evidence CLEARLY and consistently supports it.
- "no" = the evidence clearly fails this criterion.
- "unknown" = there is NOT ENOUGH evidence to judge this criterion, OR the evidence is only a single source, OR the sources conflict. NEVER guess and NEVER force a "yes" from a single paper; unknown is the honest answer when the papers do not report the needed information or do not agree.

Return ONLY a valid JSON object: {"items":[{"id":"precision","answer":"yes|no|unknown","reason":"one short sentence","confidence":0.9}], "rationale":"1-2 SHORT plain-English sentences to a non-scientist: what this finding is, and the concrete reasons it should be approved, needs more evidence, or rejected. Do NOT quote paper text. Do NOT start with a verdict word.", "summary":"ONE short plain-English status line (max ~30 words) to a non-scientist: scan the checklist you just filled and state, in plain language, the net verdict - e.g. what is satisfied, what is missing or conflicting, and whether it is approvable as-is. This is a status, not an action: it describes the CURRENT evidence, so say 'the current evidence does not yet support it' instead of 'get more evidence'. It must honestly match your answers. Do NOT quote paper text. May start with a verdict word."}. Include an item for EVERY criterion below.

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
