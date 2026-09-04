package brainmemory

import (
	"fmt"
	"hash/fnv"
	"math"
	"regexp"
	"sort"
	"strings"
)

// The pattern, claims and semantic gateways extend the pairwise recall
// matchers with structural, quantified and topical recall. Everything here is
// deterministic and local: extraction derives from the persisted boards the
// profiles already parse, and the semantic gateway uses a hashed bag-of-words
// embedding instead of a provider API, so no keys, no network, no new state.

const (
	// semanticVectorDim is the hashed bag-of-words dimensionality. 256 keeps
	// vectors small while spreading vocabulary collisions thin enough for a
	// useful cosine signal on investigation-sized text.
	semanticVectorDim = 256
	// semanticSignalThreshold is the minimum cosine similarity for the
	// semantic gateway to fire; below this, topical overlap is noise. Tuned on
	// live vault data: news corpora share enough boilerplate vocabulary that
	// 0.34 fired on nearly every pair.
	semanticSignalThreshold = 0.42
	// semanticMinDistinctTokens is the minimum vocabulary a board needs before
	// its cosine similarity means anything. Two one-line summaries sharing
	// their only nouns hit ~75% cosine while carrying no topical signal.
	semanticMinDistinctTokens = 24
	// semanticMinSharedTokens is the minimum shared salient vocabulary behind
	// a semantic reason, so the route label names real overlap.
	semanticMinSharedTokens = 3
	// patternEntitiesPerNode and patternPairsPerNode bound the pairwise
	// combination so a node tagged with dozens of entities cannot explode the
	// profile with co-occurrence pairs.
	patternEntitiesPerNode = 6
	patternPairsPerNode    = 8
	// claimAnchorWords bounds the context phrase kept with each quantified
	// value for the route-trail label.
	claimAnchorWords = 3
)

var (
	claimRatePattern     = regexp.MustCompile(`\d+(?:\.\d+)?\s?%?\s?(?:-|–|—|to)\s?\d+(?:\.\d+)?\s?%`)
	claimCurrencyPattern = regexp.MustCompile(`[$€£¥]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:billion|million|trillion|bbl|barrel|share))?`)
	claimPercentPattern  = regexp.MustCompile(`\d+(?:\.\d+)?\s?%`)
	claimWordPattern     = regexp.MustCompile(`[A-Za-z][A-Za-z'-]*`)
	semanticTokenPattern = regexp.MustCompile(`[a-z0-9]+`)
)

// gatewayStopwords are the high-frequency function words excluded from claims
// anchors and semantic fingerprints. Small and hand-picked: recall quality
// here comes from dropping boilerplate, not from linguistic precision.
var gatewayStopwords = map[string]bool{
	"the": true, "and": true, "for": true, "with": true, "that": true, "this": true,
	"from": true, "are": true, "was": true, "were": true, "been": true, "has": true,
	"have": true, "had": true, "will": true, "would": true, "can": true, "could": true,
	"should": true, "may": true, "might": true, "its": true, "their": true, "our": true,
	"your": true, "they": true, "them": true, "than": true, "then": true, "into": true,
	"over": true, "under": true, "about": true, "after": true, "before": true,
	"between": true, "during": true, "through": true, "when": true, "where": true,
	"which": true, "while": true, "who": true, "why": true, "how": true, "what": true,
	"not": true, "but": true, "nor": true, "also": true, "more": true, "most": true,
	"other": true, "some": true, "such": true, "only": true, "own": true, "same": true,
	"too": true, "very": true, "just": true, "now": true, "per": true, "via": true,
	"amid": true, "among": true, "onto": true, "upon": true, "said": true, "says": true,
	"new": true, "one": true, "two": true, "three": true, "his": true, "her": true,
	"him": true, "she": true, "yet": true, "still": true, "here": true, "there": true,
	"across": true, "these": true, "those": true, "whether": true, "because": true,
	"however": true, "including": true, "according": true, "told": true,
}

// semanticFingerprint is the per-investigation semantic gateway state: the
// normalized hashed embedding plus the salient tokens used for human-readable
// route labels. A zero fingerprint (nil vector) never fires.
type semanticFingerprint struct {
	Vector []float64
	Tokens map[string]int
}

type claimMatch struct {
	Value string // normalized quantified value, e.g. "33.6%", "$4385", "3.50%-3.75%"
	Label string // anchor words + value, e.g. "index delivering 33.6%"
}

// extractClaimMatches pulls quantified claims (rate ranges, currency amounts,
// percentages) out of one node's text. The anchor is up to claimAnchorWords
// significant words before the number in the same sentence, which gives route
// trails a readable label without pretending to understand the sentence.
func extractClaimMatches(text string, nodeID string) []extractedEvidence {
	type locatedClaim struct {
		start int
		end   int
		value string
	}
	located := make([]locatedClaim, 0)
	collect := func(pattern *regexp.Regexp) {
		for _, match := range pattern.FindAllStringIndex(text, -1) {
			located = append(located, locatedClaim{
				start: match[0],
				end:   match[1],
				value: normalizeClaimValue(text[match[0]:match[1]]),
			})
		}
	}
	// Rate ranges first so their inner percentages do not double-report.
	collect(claimRatePattern)
	collect(claimCurrencyPattern)
	collect(claimPercentPattern)
	sort.SliceStable(located, func(left, right int) bool {
		if located[left].start == located[right].start {
			return located[left].end > located[right].end
		}
		return located[left].start < located[right].start
	})

	result := make([]extractedEvidence, 0, len(located))
	seen := make(map[string]struct{})
	lastEnd := -1
	for _, claim := range located {
		if claim.start < lastEnd {
			continue // nested inside an already-kept (richer) claim
		}
		if _, exists := seen[claim.value]; exists {
			continue
		}
		seen[claim.value] = struct{}{}
		lastEnd = claim.end
		result = append(result, extractedEvidence{
			Value: claim.value,
			Evidence: signalEvidence{
				Label:   claimAnchorLabel(text, claim.start, claim.value),
				Kind:    GatewayClaims,
				NodeIDs: []string{nodeID},
			},
		})
	}
	return result
}

// normalizeClaimValue canonicalizes a matched quantified value so the same
// figure phrased differently ("$4,385" vs "$4385", "3.5 to 3.75%" vs
// "3.50%-3.75%") lands on one registry value.
func normalizeClaimValue(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	value = strings.ReplaceAll(value, " ", "")
	value = strings.ReplaceAll(value, ",", "")
	value = strings.ReplaceAll(value, "–", "-")
	value = strings.ReplaceAll(value, "—", "-")
	value = strings.ReplaceAll(value, "to", "-")
	return value
}

// claimAnchorLabel takes up to claimAnchorWords significant words directly
// before the quantified value (same sentence) as the claim's context label.
func claimAnchorLabel(text string, matchStart int, value string) string {
	sentenceStart := 0
	for index := matchStart - 2; index >= 0; index-- {
		if (text[index] == '.' || text[index] == '!' || text[index] == '?') && index+1 < matchStart {
			sentenceStart = index + 1
			break
		}
	}
	words := claimWordPattern.FindAllString(text[sentenceStart:matchStart], -1)
	anchor := make([]string, 0, claimAnchorWords)
	for _, word := range words {
		lowered := strings.ToLower(word)
		if len(lowered) < 3 || gatewayStopwords[lowered] {
			continue
		}
		anchor = append(anchor, lowered)
		if len(anchor) > claimAnchorWords {
			anchor = anchor[1:]
		}
	}
	if len(anchor) == 0 {
		return value
	}
	return strings.Join(anchor, " ") + " " + value
}

// extractPatternEvidence builds the entity co-occurrence pairs for one node:
// every pair of distinct tagged entities that appear in the same evidence is a
// structural pattern the pattern gateway can match across investigations.
func extractPatternEvidence(entities []extractedEvidence, nodeID string) []extractedEvidence {
	if len(entities) < 2 {
		return nil
	}
	sorted := make([]extractedEvidence, len(entities))
	copy(sorted, entities)
	sort.Slice(sorted, func(left, right int) bool {
		return sorted[left].Value < sorted[right].Value
	})
	if len(sorted) > patternEntitiesPerNode {
		sorted = sorted[:patternEntitiesPerNode]
	}
	result := make([]extractedEvidence, 0, patternPairsPerNode)
	for left := 0; left < len(sorted); left++ {
		for right := left + 1; right < len(sorted); right++ {
			if len(result) >= patternPairsPerNode {
				return result
			}
			result = append(result, extractedEvidence{
				Value: sorted[left].Value + "~" + sorted[right].Value,
				Evidence: signalEvidence{
					Label:   sorted[left].Evidence.Label + " + " + sorted[right].Evidence.Label,
					Kind:    GatewayPattern,
					NodeIDs: []string{nodeID},
				},
			})
		}
	}
	return result
}

// buildSemanticFingerprint hashes the token counts of a board's text into a
// normalized bag-of-words vector and keeps the salient tokens for labels.
func buildSemanticFingerprint(texts []string) semanticFingerprint {
	counts := make(map[string]int)
	for _, text := range texts {
		for _, token := range semanticTokenPattern.FindAllString(strings.ToLower(text), -1) {
			if len(token) < 3 || gatewayStopwords[token] {
				continue
			}
			counts[token]++
		}
	}
	if len(counts) == 0 {
		return semanticFingerprint{}
	}
	if len(counts) < semanticMinDistinctTokens {
		// Too little text for cosine to mean anything: thin summaries would
		// otherwise produce inflated similarity from one or two shared nouns.
		return semanticFingerprint{}
	}

	vector := make([]float64, semanticVectorDim)
	for token, count := range counts {
		hash := fnv32a(token)
		index := int(hash % semanticVectorDim)
		sign := 1.0
		if (hash>>8)&1 == 1 {
			sign = -1.0
		}
		vector[index] += sign * (1 + math.Log(float64(count)))
	}
	norm := 0.0
	for _, value := range vector {
		norm += value * value
	}
	norm = math.Sqrt(norm)
	if norm > 0 {
		for index := range vector {
			vector[index] /= norm
		}
	}

	tokens := make(map[string]int)
	for token, count := range counts {
		// Pure numbers ("2026") and short tokens are vector features but never
		// salient labels: a year appears in every news board and would top the
		// shared-token label while saying nothing about the topic.
		if len(token) < 4 || gatewayStopwords[token] || !containsLetter(token) {
			continue
		}
		tokens[token] = count
	}
	return semanticFingerprint{Vector: vector, Tokens: tokens}
}

func containsLetter(token string) bool {
	for _, char := range token {
		if char >= 'a' && char <= 'z' {
			return true
		}
	}
	return false
}

func fnv32a(token string) uint32 {
	hasher := fnv.New32a()
	_, _ = hasher.Write([]byte(token))
	return hasher.Sum32()
}

// cosineSimilarity expects L2-normalized vectors and returns 0 for anything
// degenerate, so empty profiles never fire the semantic gateway.
func cosineSimilarity(left []float64, right []float64) float64 {
	if len(left) == 0 || len(right) == 0 || len(left) != len(right) {
		return 0
	}
	dot := 0.0
	for index := range left {
		dot += left[index] * right[index]
	}
	if math.IsNaN(dot) || math.IsInf(dot, 0) {
		return 0
	}
	return dot
}

// sharedSalientTokenLabel names the strongest tokens both investigations
// share, so a semantic route trail reads "quantum processors qubit" instead
// of a bare cosine number. Fewer than semanticMinSharedTokens shared tokens
// is not topical overlap.
func sharedSalientTokenLabel(current map[string]int, target map[string]int) string {
	type sharedToken struct {
		token    string
		minCount int
	}
	shared := make([]sharedToken, 0, 4)
	for token, currentCount := range current {
		targetCount, ok := target[token]
		if !ok {
			continue
		}
		shared = append(shared, sharedToken{token: token, minCount: minInt(currentCount, targetCount)})
	}
	if len(shared) < semanticMinSharedTokens {
		return ""
	}
	sort.SliceStable(shared, func(left, right int) bool {		if shared[left].minCount == shared[right].minCount {
			return shared[left].token < shared[right].token
		}
		return shared[left].minCount > shared[right].minCount
	})
	if len(shared) > 3 {
		shared = shared[:3]
	}
	names := make([]string, 0, len(shared))
	for _, entry := range shared {
		names = append(names, entry.token)
	}
	return strings.Join(names, " ")
}

func matchingPatternReasons(current memoryProfile, target memoryProfile) []SignalReason {
	reasons := make([]SignalReason, 0)
	for value, currentEvidence := range current.Patterns {
		targetEvidence, ok := target.Patterns[value]
		if !ok {
			continue
		}
		reasons = append(reasons, SignalReason{
			Gateway:        GatewayPattern,
			Value:          value,
			Label:          currentEvidence.Label,
			Detail:         fmt.Sprintf("Entity pair %q recurs together in both investigations.", currentEvidence.Label),
			CurrentNodeIDs: cleanStringSet(currentEvidence.NodeIDs),
			TargetNodeIDs:  cleanStringSet(targetEvidence.NodeIDs),
		})
	}
	return limitReasons(reasons, 3)
}

func matchingClaimReasons(current memoryProfile, target memoryProfile) []SignalReason {
	reasons := make([]SignalReason, 0)
	for value, currentEvidence := range current.Claims {
		targetEvidence, ok := target.Claims[value]
		if !ok {
			continue
		}
		reasons = append(reasons, SignalReason{
			Gateway:        GatewayClaims,
			Value:          value,
			Label:          currentEvidence.Label,
			Detail:         fmt.Sprintf("Both investigations cite the same quantified value %q.", value),
			CurrentNodeIDs: cleanStringSet(currentEvidence.NodeIDs),
			TargetNodeIDs:  cleanStringSet(targetEvidence.NodeIDs),
		})
	}
	return limitReasons(reasons, 3)
}

func matchingSemanticReasons(current memoryProfile, target memoryProfile) []SignalReason {
	similarity := cosineSimilarity(current.Semantic.Vector, target.Semantic.Vector)
	if similarity < semanticSignalThreshold {
		return nil
	}
	label := sharedSalientTokenLabel(current.Semantic.Tokens, target.Semantic.Tokens)
	if strings.TrimSpace(label) == "" {
		return nil
	}
	return []SignalReason{{
		Gateway: GatewaySemantic,
		Value:   "overlap|" + normalizeKey(label),
		Label:   label,
		Detail:  fmt.Sprintf("Topical language overlap (%.0f%% similarity) around %q.", similarity*100, label),
		// Whole-board matchers have no single evidence node; empty slices
		// (not nil) so the persisted JSON never carries nulls the UI would
		// have to defend against.
		CurrentNodeIDs: cleanStringSet(nil),
		TargetNodeIDs:  cleanStringSet(nil),
	}}
}
