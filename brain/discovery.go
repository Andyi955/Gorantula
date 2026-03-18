package brain

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"spider-agent/models"
)

const (
	discoveryConfidenceThreshold   float32 = 0.86
	discoveryReviewConfidenceFloor float32 = 0.78
	discoveryCandidateStatus               = "candidate"
	discoveryApprovedStatus                = "approved"
	discoveryVerdictApprove                = "approve"
	discoveryVerdictRevise                 = "revise"
	discoveryVerdictReject                 = "reject"
)

var (
	discoveryMonthPattern         = regexp.MustCompile(`\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b`)
	discoveryYearPattern          = regexp.MustCompile(`\b(?:19|20)\d{2}\b`)
	discoveryNumericClaimPattern  = regexp.MustCompile(`\b\d[\d,]*(?:\.\d+)?(?:%|x|tb|gb|mb|kb|m|b|k)?\b`)
	discoveryAcronymPattern       = regexp.MustCompile(`\b[A-Z][A-Z0-9-]{1,}\b`)
	discoveryTitlePhrasePattern   = regexp.MustCompile(`\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b`)
	discoveryWhitespacePattern    = regexp.MustCompile(`\s+`)
	discoveryNonTitleCharsPattern = regexp.MustCompile(`[^a-z0-9\-\s]`)
)

type discoveryJSONResponse struct {
	Discoveries []models.Discovery `json:"discoveries"`
}

type reviewerSpec struct {
	Name         string
	Perspective  string
	SystemPrompt string
}

type discoveryReviewTrace struct {
	Candidate       models.Discovery
	Reviews         []models.DiscoveryReview
	Final           models.Discovery
	Approved        bool
	RejectionReason string
	DebugNotes      []string
}

// SynthesizeDiscoveries generates candidate discoveries from the evidence before review.
func (b *Brain) SynthesizeDiscoveries(ctx context.Context, vaultID string, nodes []models.MemoryNode, insights []PersonaInsight) ([]models.Discovery, error) {
	if len(nodes) < 2 {
		return nil, nil
	}

	provider := b.GetSearchProvider()
	if provider == nil {
		return nil, fmt.Errorf("no model providers available")
	}

	var findingsBuilder strings.Builder
	for _, node := range nodes {
		findingsBuilder.WriteString(fmt.Sprintf("[NodeID: %s]\nTitle: %s\nSummary: %s\nFull Text: %s\n\n", node.ID, node.Title, node.Summary, node.FullText))
	}

	if len(insights) > 0 {
		findingsBuilder.WriteString("=== PERSONA INSIGHTS ===\n")
		for _, insight := range insights {
			findingsBuilder.WriteString(fmt.Sprintf("[%s]\nConfidence: %.2f\nKey Findings: %s\nConnections: %s\nQuestions: %s\nAnalysis: %s\nNodeIDs: %s\n\n",
				insight.PersonaName,
				insight.Confidence,
				strings.Join(insight.KeyFindings, " | "),
				strings.Join(insight.Connections, " | "),
				strings.Join(insight.Questions, " | "),
				insight.FullAnalysis,
				strings.Join(insight.NodeIDs, ", "),
			))
		}
	}

	prompt := fmt.Sprintf(`You are a candidate discovery synthesis engine.
Your job is to PROPOSE possible discoveries, not to publish final discoveries.

Return only candidate discoveries that meet ALL of these rules:
1. The claim is novel or strategically important, not a generic summary.
2. The evidence is grounded in the exact node IDs provided.
3. Use plain, technical titles with no hype language.
4. Make "impact" a single sober sentence.
5. Ignore weak speculation, common overlaps, and obvious restatements.
6. Do NOT introduce any dates, deployments, organizations, locations, numbers, benchmarks, or hardware claims unless they appear explicitly in the cited evidence nodes.
7. Do NOT use absolutist hype language like "supremacy", "elimination", "universality", "proof", or "guarantee".
8. If a claim needs outside knowledge or interpretation beyond the cited evidence, omit it.

Return ONLY valid JSON in this shape:
{
  "discoveries": [
    {
      "title": "plain technical title",
      "claim": "candidate discovery claim",
      "impact": "one sober sentence about why it matters",
      "confidence": 0.0,
      "sourceNodeIDs": ["exact-node-id-1", "exact-node-id-2"]
    }
  ]
}

Use only exact node IDs from the evidence below.
%s

Evidence and insights:
%s`, buildNodeMapping(nodes), findingsBuilder.String())

	var response discoveryJSONResponse
	if err := provider.GenerateJSON(ctx, prompt, &response); err != nil {
		return nil, fmt.Errorf("failed to synthesize candidate discoveries: %w", err)
	}

	return normalizeDiscoveries(response.Discoveries, vaultID, nodes, discoveryCandidateStatus), nil
}

// ReviewDiscoveryCandidates runs a temporary expert cell on each candidate and returns only approved discoveries.
func (b *Brain) ReviewDiscoveryCandidates(ctx context.Context, candidates []models.Discovery, nodes []models.MemoryNode) ([]models.Discovery, error) {
	if len(candidates) == 0 {
		return nil, nil
	}

	approved := make([]models.Discovery, 0, len(candidates))
	traces := make([]discoveryReviewTrace, 0, len(candidates))
	for _, candidate := range candidates {
		trace, err := b.reviewSingleCandidate(ctx, candidate, nodes)
		if err != nil {
			return nil, err
		}
		traces = append(traces, trace)
		if trace.Approved {
			approved = append(approved, trace.Final)
		}
	}

	writeDiscoveryRunLog(candidates, traces, approved)
	return approved, nil
}

func (b *Brain) reviewSingleCandidate(ctx context.Context, candidate models.Discovery, nodes []models.MemoryNode) (discoveryReviewTrace, error) {
	provider := b.GetSearchProvider()
	if provider == nil {
		return discoveryReviewTrace{}, fmt.Errorf("no model providers available")
	}

	trace := discoveryReviewTrace{Candidate: candidate}

	nodeLookup := make(map[string]models.MemoryNode, len(nodes))
	for _, node := range nodes {
		nodeLookup[node.ID] = node
	}

	sourceCorpus := buildDiscoverySourceCorpus(candidate.SourceNodeIDs, nodeLookup)
	if sourceCorpus == "" {
		trace.RejectionReason = "missing_source_corpus"
		return trace, nil
	}

	candidate.Topic = classifyDiscoveryTopic(candidate, sourceCorpus)
	trace.Candidate.Topic = candidate.Topic
	reviewers := buildDiscoveryReviewTeam(candidate.Topic)
	if len(reviewers) == 0 {
		trace.RejectionReason = "no_review_team"
		return trace, nil
	}

	reviews := make([]models.DiscoveryReview, len(reviewers))
	errChan := make(chan error, len(reviewers))
	var waitGroup sync.WaitGroup

	for idx, reviewer := range reviewers {
		waitGroup.Add(1)
		go func(index int, spec reviewerSpec) {
			defer waitGroup.Done()
			review, err := runDiscoveryReview(ctx, provider, spec, candidate, sourceCorpus)
			if err != nil {
				errChan <- err
				return
			}
			reviews[index] = review
		}(idx, reviewer)
	}

	waitGroup.Wait()
	close(errChan)
	if err := <-errChan; err != nil {
		return discoveryReviewTrace{}, fmt.Errorf("temporary discovery review failed: %w", err)
	}
	trace.Reviews = reviews

	finalDiscovery, finalNotes := finalizeReviewedDiscovery(candidate, reviews, nodeLookup)
	trace.Final = finalDiscovery
	trace.DebugNotes = append(trace.DebugNotes, finalNotes...)
	if finalDiscovery.Confidence < discoveryReviewConfidenceFloor {
		trace.RejectionReason = "review_confidence_floor"
		return trace, nil
	}

	approved, rejectionReason := discoveryPassesConsensus(candidate, reviews)
	trace.Approved = approved
	trace.RejectionReason = rejectionReason
	if approved {
		trace.RejectionReason = ""
	}

	return trace, nil
}

func writeDiscoveryRunLog(candidates []models.Discovery, traces []discoveryReviewTrace, approved []models.Discovery) {
	if len(candidates) == 0 {
		return
	}

	vaultID := strings.TrimSpace(candidates[0].SourceVaultID)
	if vaultID == "" {
		vaultID = "unknown-vault"
	}

	logDir := filepath.Join("abdomen_vault", "discovery_logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return
	}

	filename := fmt.Sprintf("%s-%s.txt", sanitizeDiscoveryLogSlug(vaultID), time.Now().Format("20060102-150405"))
	logPath := filepath.Join(logDir, filename)

	var builder strings.Builder
	builder.WriteString("GORANTULA DISCOVERY REVIEW LOG\n")
	builder.WriteString(fmt.Sprintf("Generated: %s\n", time.Now().Format(time.RFC3339)))
	builder.WriteString(fmt.Sprintf("Vault: %s\n", vaultID))
	builder.WriteString(fmt.Sprintf("CandidateCount: %d\n", len(candidates)))
	builder.WriteString(fmt.Sprintf("ApprovedCount: %d\n\n", len(approved)))

	for index, trace := range traces {
		builder.WriteString(fmt.Sprintf("=== Candidate %d ===\n", index+1))
		builder.WriteString(fmt.Sprintf("Title: %s\n", trace.Candidate.Title))
		builder.WriteString(fmt.Sprintf("Status: %s\n", ternaryApproval(trace.Approved)))
		if trace.RejectionReason != "" {
			builder.WriteString(fmt.Sprintf("RejectionReason: %s\n", trace.RejectionReason))
		}
		builder.WriteString(fmt.Sprintf("Topic: %s\n", fallbackValue(trace.Candidate.Topic, "unclassified")))
		builder.WriteString(fmt.Sprintf("Confidence: %.2f\n", trace.Candidate.Confidence))
		builder.WriteString(fmt.Sprintf("Claim: %s\n", trace.Candidate.Claim))
		builder.WriteString(fmt.Sprintf("Impact: %s\n", trace.Candidate.Impact))
		builder.WriteString(fmt.Sprintf("SourceNodeIDs: %s\n\n", strings.Join(trace.Candidate.SourceNodeIDs, ", ")))
		for _, note := range trace.DebugNotes {
			builder.WriteString(fmt.Sprintf("DebugNote: %s\n", note))
		}
		if len(trace.DebugNotes) > 0 {
			builder.WriteString("\n")
		}

		reviews := append([]models.DiscoveryReview(nil), trace.Reviews...)
		sort.SliceStable(reviews, func(i, j int) bool {
			return reviews[i].Reviewer < reviews[j].Reviewer
		})

		for _, review := range reviews {
			builder.WriteString(fmt.Sprintf("- Reviewer: %s\n", review.Reviewer))
			builder.WriteString(fmt.Sprintf("  Verdict: %s\n", review.Verdict))
			builder.WriteString(fmt.Sprintf("  Confidence: %.2f\n", review.Confidence))
			builder.WriteString(fmt.Sprintf("  CriticalIssue: %t | Unsupported: %t | Overclaim: %t\n", review.FlagsCriticalIssue, review.FlagsUnsupportedClaims, review.FlagsOverclaim))
			builder.WriteString(fmt.Sprintf("  Rationale: %s\n", strings.TrimSpace(review.Rationale)))
			if strings.TrimSpace(review.RevisedTitle) != "" {
				builder.WriteString(fmt.Sprintf("  RevisedTitle: %s\n", strings.TrimSpace(review.RevisedTitle)))
			}
			if strings.TrimSpace(review.RevisedClaim) != "" {
				builder.WriteString(fmt.Sprintf("  RevisedClaim: %s\n", strings.TrimSpace(review.RevisedClaim)))
			}
			if strings.TrimSpace(review.RevisedImpact) != "" {
				builder.WriteString(fmt.Sprintf("  RevisedImpact: %s\n", strings.TrimSpace(review.RevisedImpact)))
			}
			builder.WriteString("\n")
		}

		if trace.Approved {
			builder.WriteString("Final Approved Discovery:\n")
			builder.WriteString(fmt.Sprintf("  Title: %s\n", trace.Final.Title))
			builder.WriteString(fmt.Sprintf("  Confidence: %.2f\n", trace.Final.Confidence))
			builder.WriteString(fmt.Sprintf("  Claim: %s\n", trace.Final.Claim))
			builder.WriteString(fmt.Sprintf("  Impact: %s\n\n", trace.Final.Impact))
		} else {
			builder.WriteString("Final Result: Rejected or suppressed after review.\n\n")
		}
	}

	if len(approved) == 0 {
		builder.WriteString("=== Final Output ===\nNo discoveries were approved for publication.\n")
	} else {
		builder.WriteString("=== Final Output ===\n")
		for index, discovery := range approved {
			builder.WriteString(fmt.Sprintf("%d. %s (%.2f)\n", index+1, discovery.Title, discovery.Confidence))
		}
	}

	_ = os.WriteFile(logPath, []byte(builder.String()), 0o644)
}

func sanitizeDiscoveryLogSlug(input string) string {
	normalized := strings.ToLower(strings.TrimSpace(input))
	normalized = discoveryNonTitleCharsPattern.ReplaceAllString(normalized, "-")
	normalized = discoveryWhitespacePattern.ReplaceAllString(normalized, "-")
	normalized = strings.Trim(normalized, "-")
	if normalized == "" {
		return "discovery-run"
	}
	return normalized
}

func ternaryApproval(approved bool) string {
	if approved {
		return "approved"
	}
	return "rejected"
}

func fallbackValue(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func runDiscoveryReview(ctx context.Context, provider ModelProvider, reviewer reviewerSpec, candidate models.Discovery, sourceCorpus string) (models.DiscoveryReview, error) {
	prompt := fmt.Sprintf(`%s

You are reviewing exactly one candidate discovery. Decide if it should be approved, revised, or rejected.

Candidate discovery:
Title: %s
Claim: %s
Impact: %s
Confidence: %.2f
Topic: %s
Supporting node IDs: %s

Supporting evidence:
%s

Return ONLY valid JSON in this shape:
{
  "reviewer": "%s",
  "verdict": "approve | revise | reject",
  "confidence": 0.0,
  "rationale": "1-2 sober sentences",
  "flagsCriticalIssue": false,
  "flagsUnsupportedClaims": false,
  "flagsOverclaim": false,
  "revisedTitle": "",
  "revisedClaim": "",
  "revisedImpact": ""
}

Rules:
- Reject if the candidate introduces unsupported facts that cannot be repaired from the cited evidence.
- Revise if the core idea is good but the title, claim, impact, or specificity needs correction to better match the cited evidence.
- Approve only if the wording is sober and well-grounded.
- RevisedImpact must be one short sentence if provided.
- RevisedTitle must be plain and technical if provided.
- If you can repair the claim by narrowing, correcting numbers/ranges, or softening wording using the cited evidence, use verdict "revise" and provide the corrected text instead of setting flagsUnsupportedClaims to true.
- Set flagsUnsupportedClaims to true only when the claim cannot be salvaged from the cited evidence.`, reviewer.SystemPrompt, candidate.Title, candidate.Claim, candidate.Impact, candidate.Confidence, candidate.Topic, strings.Join(candidate.SourceNodeIDs, ", "), sourceCorpus, reviewer.Name)

	var review models.DiscoveryReview
	if err := provider.GenerateJSON(ctx, prompt, &review); err != nil {
		return models.DiscoveryReview{}, err
	}
	if review.Reviewer == "" {
		review.Reviewer = reviewer.Name
	}
	review.Verdict = normalizeVerdict(review.Verdict)
	review = normalizeDiscoveryReview(review)
	return review, nil
}

func normalizeDiscoveries(raw []models.Discovery, vaultID string, nodes []models.MemoryNode, status string) []models.Discovery {
	validNodeIDs := make(map[string]bool, len(nodes))
	nodeLookup := make(map[string]models.MemoryNode, len(nodes))
	for _, node := range nodes {
		validNodeIDs[node.ID] = true
		nodeLookup[node.ID] = node
	}

	discoveries := make([]models.Discovery, 0, len(raw))
	seenTitles := make(map[string]bool)
	now := time.Now().Format(time.RFC3339)

	for idx, discovery := range raw {
		discovery.Title = sanitizeDiscoveryTitle(discovery.Title)
		discovery.Claim = strings.TrimSpace(discovery.Claim)
		discovery.Impact = sanitizeDiscoveryImpact(discovery.Impact)

		if discovery.Title == "" || discovery.Claim == "" || discovery.Impact == "" {
			continue
		}
		if discovery.Confidence < discoveryConfidenceThreshold {
			continue
		}
		if looksGenericDiscovery(discovery.Title, discovery.Claim, discovery.Impact) || usesAbsolutistDiscoveryLanguage(discovery.Title, discovery.Claim, discovery.Impact) {
			continue
		}

		filteredSourceIDs := make([]string, 0, len(discovery.SourceNodeIDs))
		seenNodeIDs := make(map[string]bool)
		for _, nodeID := range discovery.SourceNodeIDs {
			nodeID = strings.TrimSpace(nodeID)
			if nodeID == "" || seenNodeIDs[nodeID] || !validNodeIDs[nodeID] {
				continue
			}
			seenNodeIDs[nodeID] = true
			filteredSourceIDs = append(filteredSourceIDs, nodeID)
		}
		if len(filteredSourceIDs) < 2 {
			continue
		}

		sourceCorpus := buildDiscoverySourceCorpus(filteredSourceIDs, nodeLookup)
		if sourceCorpus == "" {
			continue
		}
		if containsUnsupportedDiscoveryReferences(discovery.Claim, discovery.Impact, sourceCorpus) {
			continue
		}

		key := strings.ToLower(discovery.Title)
		if seenTitles[key] {
			continue
		}
		seenTitles[key] = true

		discovery.ID = fmt.Sprintf("discovery-%s-%d", vaultID, idx)
		discovery.SourceNodeIDs = filteredSourceIDs
		discovery.SourceVaultID = vaultID
		discovery.CreatedAt = now
		discovery.NodeKind = "discovery"
		discovery.Status = status
		discovery.Topic = classifyDiscoveryTopic(discovery, sourceCorpus)
		discoveries = append(discoveries, discovery)
	}

	return discoveries
}

func buildDiscoveryReviewTeam(topic string) []reviewerSpec {
	reviewers := []reviewerSpec{
		{
			Name:         "Overclaim Auditor",
			Perspective:  "Rejects dramatic language, unsupported leaps, and claims that outrun the evidence.",
			SystemPrompt: "You are an overclaim auditor. Be strict about hype, unsupported facts, and exaggerated causal language.",
		},
		{
			Name:         "Methodology Reviewer",
			Perspective:  "Checks whether the candidate is methodologically justified by the cited evidence.",
			SystemPrompt: "You are a methodology reviewer. Evaluate whether the evidence actually supports the candidate claim at the stated level of confidence.",
		},
		{
			Name:         "Practical Impact Reviewer",
			Perspective:  "Checks whether the why-it-matters statement is sober, useful, and not inflated.",
			SystemPrompt: "You are a practical impact reviewer. Keep implications concrete, concise, and proportionate to the evidence.",
		},
	}

	switch topic {
	case "llm-architecture":
		reviewers = append(reviewers,
			reviewerSpec{
				Name:         "LLM Systems Reviewer",
				Perspective:  "Evaluates claims about model architecture, adaptation, and scaling behavior.",
				SystemPrompt: "You are an LLM systems reviewer. Scrutinize claims about architecture, fine-tuning, adaptation rank, and model scaling.",
			},
			reviewerSpec{
				Name:         "Retrieval Systems Reviewer",
				Perspective:  "Evaluates claims about retrievers, indexing, grounding, and non-parametric memory.",
				SystemPrompt: "You are a retrieval systems reviewer. Scrutinize claims about retrievers, indices, hot-swapping, grounding, and factual update mechanisms.",
			},
		)
	case "biomedical":
		reviewers = append(reviewers, reviewerSpec{
			Name:         "Biomedical Methods Reviewer",
			Perspective:  "Evaluates whether biomedical or clinical claims stay within what the evidence can support.",
			SystemPrompt: "You are a biomedical methods reviewer. Reject any biomedical claim that stretches beyond the stated study design, data, or evidence quality.",
		})
	case "geopolitics":
		reviewers = append(reviewers, reviewerSpec{
			Name:         "Geopolitical Analyst",
			Perspective:  "Evaluates geopolitical causality, actor claims, and real-world implications.",
			SystemPrompt: "You are a geopolitical analyst. Reject causal or predictive claims that are stronger than the evidence warrants.",
		})
	case "materials":
		reviewers = append(reviewers, reviewerSpec{
			Name:         "Materials Reviewer",
			Perspective:  "Evaluates claims about bottlenecks, mechanisms, and engineering constraints in materials systems.",
			SystemPrompt: "You are a materials systems reviewer. Keep claims tightly tied to the explicit mechanism or bottleneck described in the evidence.",
		})
	}

	return reviewers
}

func classifyDiscoveryTopic(discovery models.Discovery, sourceCorpus string) string {
	text := strings.ToLower(discovery.Title + " " + discovery.Claim + " " + discovery.Impact + " " + sourceCorpus)

	if containsAny(text, "llm", "gpt", "transformer", "lora", "rag", "retrieval", "fine-tuning", "parametric", "non-parametric") {
		return "llm-architecture"
	}
	if containsAny(text, "clinical", "biomedical", "patient", "disease", "protein", "trial", "therapy") {
		return "biomedical"
	}
	if containsAny(text, "sanction", "military", "election", "government", "war", "treaty", "diplomatic") {
		return "geopolitics"
	}
	if containsAny(text, "catalyst", "material", "alloy", "battery", "semiconductor", "manufacturing bottleneck") {
		return "materials"
	}

	return ""
}

func finalizeReviewedDiscovery(candidate models.Discovery, reviews []models.DiscoveryReview, nodeLookup map[string]models.MemoryNode) (models.Discovery, []string) {
	finalDiscovery := candidate
	debugNotes := []string{}

	for _, review := range reviews {
		if review.Verdict != discoveryVerdictRevise {
			continue
		}
		if strings.TrimSpace(review.RevisedTitle) != "" {
			finalDiscovery.Title = review.RevisedTitle
		}
		if strings.TrimSpace(review.RevisedClaim) != "" {
			finalDiscovery.Claim = review.RevisedClaim
		}
		if strings.TrimSpace(review.RevisedImpact) != "" {
			finalDiscovery.Impact = review.RevisedImpact
		}
	}

	finalDiscovery.Title = sanitizeDiscoveryTitle(finalDiscovery.Title)
	finalDiscovery.Impact = sanitizeDiscoveryImpact(finalDiscovery.Impact)
	finalDiscovery.Status = discoveryApprovedStatus
	debugNotes = append(debugNotes, fmt.Sprintf("normalized_title=%q", finalDiscovery.Title))
	debugNotes = append(debugNotes, fmt.Sprintf("normalized_impact=%q", finalDiscovery.Impact))

	var positiveConfidenceSum float32
	var positiveCount int
	for _, review := range reviews {
		if review.Verdict == discoveryVerdictApprove || review.Verdict == discoveryVerdictRevise {
			positiveConfidenceSum += review.Confidence
			positiveCount++
		}
	}
	if positiveCount > 0 {
		avgConfidence := positiveConfidenceSum / float32(positiveCount)
		if avgConfidence < finalDiscovery.Confidence {
			finalDiscovery.Confidence = avgConfidence
		}
	}
	debugNotes = append(debugNotes, fmt.Sprintf("final_confidence=%.2f", finalDiscovery.Confidence))

	sourceCorpus := buildDiscoverySourceCorpus(finalDiscovery.SourceNodeIDs, nodeLookup)
	if containsUnsupportedDiscoveryReferences(finalDiscovery.Claim, finalDiscovery.Impact, sourceCorpus) {
		debugNotes = append(debugNotes, "post_review_validation=unsupported_reference")
		finalDiscovery.Confidence = 0
	}
	if usesAbsolutistDiscoveryLanguage(finalDiscovery.Title, finalDiscovery.Claim, finalDiscovery.Impact) {
		debugNotes = append(debugNotes, "post_review_validation=absolutist_language")
		finalDiscovery.Confidence = 0
	}

	return finalDiscovery, debugNotes
}

func discoveryPassesConsensus(candidate models.Discovery, reviews []models.DiscoveryReview) (bool, string) {
	var approveCount int
	var rejectCount int

	for _, review := range reviews {
		if review.FlagsCriticalIssue || review.FlagsUnsupportedClaims {
			return false, "hard_veto_review_flag"
		}
		if review.FlagsOverclaim && review.Verdict != discoveryVerdictRevise {
			return false, "overclaim_without_revision"
		}
		if review.FlagsOverclaim && review.Verdict == discoveryVerdictRevise && !hasActionableDiscoveryRevision(review) {
			return false, "overclaim_without_actionable_revision"
		}
		switch review.Verdict {
		case discoveryVerdictApprove, discoveryVerdictRevise:
			approveCount++
		case discoveryVerdictReject:
			rejectCount++
		}
	}

	if approveCount <= len(reviews)/2 || approveCount <= rejectCount {
		return false, "consensus_not_reached"
	}
	if candidate.Confidence < discoveryConfidenceThreshold {
		return false, "candidate_confidence_below_threshold"
	}

	return true, ""
}

func hasActionableDiscoveryRevision(review models.DiscoveryReview) bool {
	return strings.TrimSpace(review.RevisedTitle) != "" ||
		strings.TrimSpace(review.RevisedClaim) != "" ||
		strings.TrimSpace(review.RevisedImpact) != ""
}

func normalizeDiscoveryReview(review models.DiscoveryReview) models.DiscoveryReview {
	if review.Verdict == discoveryVerdictRevise && hasActionableDiscoveryRevision(review) && !review.FlagsCriticalIssue {
		// A revise verdict with a concrete grounded correction should stay salvageable.
		// UnsupportedClaims is reserved for candidates that cannot be repaired from the cited evidence.
		review.FlagsUnsupportedClaims = false
	}

	if review.Verdict == discoveryVerdictApprove {
		review.FlagsOverclaim = false
	}

	return review
}

func normalizeVerdict(verdict string) string {
	switch strings.ToLower(strings.TrimSpace(verdict)) {
	case discoveryVerdictApprove:
		return discoveryVerdictApprove
	case discoveryVerdictRevise:
		return discoveryVerdictRevise
	default:
		return discoveryVerdictReject
	}
}

func sanitizeDiscoveryTitle(title string) string {
	title = strings.ToLower(strings.TrimSpace(title))
	title = discoveryNonTitleCharsPattern.ReplaceAllString(title, " ")
	title = discoveryWhitespacePattern.ReplaceAllString(title, " ")
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}

	words := strings.Fields(title)
	for idx, word := range words {
		if word == "" {
			continue
		}
		words[idx] = strings.ToUpper(word[:1]) + word[1:]
	}

	return strings.Join(words, " ")
}

func sanitizeDiscoveryImpact(impact string) string {
	impact = strings.TrimSpace(impact)
	if impact == "" {
		return ""
	}

	if idx := strings.IndexAny(impact, ".!?"); idx >= 0 {
		impact = strings.TrimSpace(impact[:idx+1])
	}

	replacements := map[string]string{
		"This explains the efficacy of":               "This suggests a mechanism for",
		"high-fidelity factual grounding":             "strong factual grounding",
		"high-fidelity natural language processing":   "strong language-task performance",
		"necessary trainable parameter density":       "model size",
		"maintain optimal performance metrics":        "maintain strong performance",
		"without duplicating general-domain features": "without relearning broad general features",
	}

	for oldValue, newValue := range replacements {
		impact = strings.ReplaceAll(impact, oldValue, newValue)
	}

	return impact
}

func looksGenericDiscovery(title, claim, impact string) bool {
	combined := strings.ToLower(strings.TrimSpace(title + " " + claim + " " + impact))
	if combined == "" {
		return true
	}

	genericPhrases := []string{
		"the evidence suggests",
		"there are connections",
		"further investigation is needed",
		"multiple sources mention",
		"this may be related",
		"there appears to be overlap",
		"information is limited",
		"could be important",
	}

	for _, phrase := range genericPhrases {
		if strings.Contains(combined, phrase) {
			return true
		}
	}

	return false
}

func usesAbsolutistDiscoveryLanguage(title, claim, impact string) bool {
	combined := strings.ToLower(strings.TrimSpace(title + " " + claim + " " + impact))
	absolutistPhrases := []string{
		"supremacy",
		"elimination",
		"universality",
		"guarantee",
		"guaranteed",
		"proves that",
		"proof that",
		"always",
		"never",
		"completely removes",
		"eliminates",
		"revolutionary",
	}

	for _, phrase := range absolutistPhrases {
		if strings.Contains(combined, phrase) {
			return true
		}
	}

	return false
}

func buildDiscoverySourceCorpus(sourceNodeIDs []string, nodeLookup map[string]models.MemoryNode) string {
	var builder strings.Builder
	for _, nodeID := range sourceNodeIDs {
		node, ok := nodeLookup[nodeID]
		if !ok {
			continue
		}
		builder.WriteString(" ")
		builder.WriteString(strings.ToLower(node.Title))
		builder.WriteString(" ")
		builder.WriteString(strings.ToLower(node.Summary))
		builder.WriteString(" ")
		builder.WriteString(strings.ToLower(node.FullText))
	}

	return builder.String()
}

func containsUnsupportedDiscoveryReferences(claim, impact, sourceCorpus string) bool {
	if containsUnsupportedDiscoveryMatches(strings.ToLower(claim+" "+impact), sourceCorpus, discoveryMonthPattern) {
		return true
	}
	if containsUnsupportedDiscoveryMatches(strings.ToLower(claim+" "+impact), sourceCorpus, discoveryYearPattern) {
		return true
	}
	if containsUnsupportedDiscoveryMatches(strings.ToLower(claim+" "+impact), sourceCorpus, discoveryNumericClaimPattern) {
		return true
	}
	if containsUnsupportedNamedReferences(claim+" "+impact, sourceCorpus) {
		return true
	}

	return false
}

func containsUnsupportedDiscoveryMatches(text, sourceCorpus string, pattern *regexp.Regexp) bool {
	matches := pattern.FindAllString(text, -1)
	for _, match := range matches {
		if !strings.Contains(sourceCorpus, strings.ToLower(match)) {
			return true
		}
	}

	return false
}

func containsUnsupportedNamedReferences(text, sourceCorpus string) bool {
	for _, match := range discoveryAcronymPattern.FindAllString(text, -1) {
		lowerMatch := strings.ToLower(match)
		if lowerMatch == "i" {
			continue
		}
		if !strings.Contains(sourceCorpus, lowerMatch) {
			return true
		}
	}

	for _, match := range discoveryTitlePhrasePattern.FindAllString(text, -1) {
		if !strings.Contains(sourceCorpus, strings.ToLower(match)) {
			return true
		}
	}

	return false
}

func containsAny(text string, values ...string) bool {
	for _, value := range values {
		if strings.Contains(text, value) {
			return true
		}
	}
	return false
}
