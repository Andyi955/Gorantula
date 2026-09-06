package brain

import (
	"context"
	"fmt"
	"log"
	"regexp"
	"strings"

	"github.com/Andyi955/Gorantula/models"
)

// The maximum source characters sent to the claim-extractor persona. Abstracts
// are usually well under this; full texts are truncated defensively so a long
// paper cannot blow the prompt budget.
const researchClaimSourceLimit = 6000

// ExtractClaims runs the claim-extractor persona over a paper and returns
// entity-tagged evidence claims, each grounded to a source snippet + offset.
// Grounding is computed deterministically here (not trusted from the model):
// each returned claim text is located in the source, so provenance always
// points at real paper text.
func (b *Brain) ExtractClaims(ctx context.Context, paper models.Paper) ([]models.Claim, error) {
	provider := b.GetSearchProvider()
	if provider == nil {
		return nil, fmt.Errorf("no model providers available for claim extraction")
	}

	sourceLabel, source := claimSourceForPaper(paper)
	if strings.TrimSpace(source) == "" {
		return nil, fmt.Errorf("paper %s has no extractable text", paper.ID)
	}

	prompt := fmt.Sprintf(
		researchClaimPromptTemplate,
		paper.Title,
		researchClaimEntityVocabulary,
		sourceLabel,
		truncateRunes(source, researchClaimSourceLimit),
	)

	var resp models.ClaimExtractionResponse
	if err := provider.GenerateJSON(ctx, prompt, &resp); err != nil {
		return nil, err
	}
	log.Printf("[claim-extract] paper=%s got %d claim(s): %+v", paper.ID, len(resp.Claims), resp.Claims)

	claims := make([]models.Claim, 0, len(resp.Claims))
	for i, claim := range resp.Claims {
		claim.ID = strings.TrimSpace(claim.ID)
		if claim.ID == "" {
			claim.ID = fmt.Sprintf("%s-claim-%d", paper.ID, i+1)
		}
		claim.PaperID = paper.ID
		claim.Text = strings.TrimSpace(claim.Text)
		claim.Kind = strings.ToLower(strings.TrimSpace(claim.Kind))
		claim.Entities = mergeEntityTags(claim.Entities, supplementEntityTags(claim.Text))
		claim.Provenance = sourceLabel

		snippet, offset, ok := groundClaimText(source, claim.Text)
		if ok {
			claim.SourceSnippet = snippet
			claim.SourceOffset = offset
		}

		if claim.Text == "" {
			continue
		}
		claims = append(claims, claim)
	}
	return claims, nil
}

const researchClaimPromptTemplate = `You are a rigorous scientific claim-extraction analyst. From the paper text below, extract the key EVIDENCE CLAIMS - the falsifiable statements, results, methodological choices, or statistics the paper asserts.

For EACH claim return:
- "text": a short, faithful statement of the claim, barely paraphrased from the paper.
- "kind": one of "finding" | "method" | "model" | "statistic".
- "entities": the important entities tagged EXACTLY using the vocabulary below, e.g. [PERSON:Prebisch], [ORG:OpenAI], [GPE:Germany], [DATE:2026], [EVENT:launch], [PRODUCT:GPT-5], [MONEY:$2.4B], [PERCENT:38%%], [LAW:DSA].
- "confidence": a float 0-1 for how directly the paper supports this claim.

Entity vocabulary: %s

CRITICAL:
1. Ground every claim in the actual paper text - do not invent claims the paper does not make.
2. Return ONLY a valid JSON object: {"claims":[{"text":"...","kind":"...","entities":["..."],"confidence":0.9}]}.
3. If the text is empty or illegible, return {"claims":[]}.
4. Use ONLY the entity tags listed in the vocabulary - never invent a new tag type (e.g. do NOT use [SAMPLE:], [TOPIC:], [KEY:], [CONTEXT:]).

PAPER TITLE: %s
SOURCE: %s

PAPER TEXT:
%s`

const researchClaimEntityVocabulary = `PERSON, ORG, LOC, GPE, DATE, TIME, EVENT, PRODUCT, MONEY, PERCENT, LAW`

// canonicalResearchEntityTypes is the closed set of entity tag prefixes the
// claim extractor may emit. Any other [TYPE:value] tag the model invents is
// dropped by cleanClaimEntities so the corpus stays on the shared vocabulary.
var canonicalResearchEntityTypes = map[string]struct{}{
	"PERSON": {}, "ORG": {}, "LOC": {}, "GPE": {}, "DATE": {}, "TIME": {},
	"EVENT": {}, "PRODUCT": {}, "MONEY": {}, "PERCENT": {}, "LAW": {},
}

func claimSourceForPaper(paper models.Paper) (label, source string) {
	// Prefer real article body text over a summary: evidence extraction is more
	// faithful to the paper when full text is available, and grounding still
	// points at actual paper text. The abstract is the fallback.
	if strings.TrimSpace(paper.FullText) != "" {
		return "fullText", paper.FullText
	}
	if strings.TrimSpace(paper.Abstract) != "" {
		return "abstract", paper.Abstract
	}
	return "", ""
}

// groundClaimText locates claimText inside source and returns a grounding
// snippet + char offset. Exact (case-insensitive) substring match is tried
// first; otherwise the best word-overlap sentence in the source is used, so a
// lightly-paraphrased claim still points at real paper text.
func groundClaimText(source, claimText string) (string, int, bool) {
	needle := strings.TrimSpace(claimText)
	if needle == "" {
		return "", 0, false
	}

	lowerSource := strings.ToLower(source)
	lowerNeedle := strings.ToLower(needle)
	if idx := strings.Index(lowerSource, lowerNeedle); idx >= 0 {
		return snippetAround(source, idx, len(needle)), idx, true
	}

	best := bestOverlapSentence(source, needle)
	if best == "" {
		return "", 0, false
	}
	idx := strings.Index(lowerSource, strings.ToLower(best))
	if idx < 0 {
		idx = 0
	}
	return snippetAround(source, idx, len(best)), idx, true
}

func snippetAround(source string, start, length int) string {
	const window = 80
	left := start - window
	if left < 0 {
		left = 0
	}
	right := start + length + window
	if right > len(source) {
		right = len(source)
	}
	snippet := strings.TrimSpace(source[left:right])
	if left > 0 {
		snippet = "…" + snippet
	}
	if right < len(source) {
		snippet = snippet + "…"
	}
	return snippet
}

// bestOverlapSentence returns the sentence in source sharing the most words
// with needle (a cheap proxy for "best grounded sentence").
func bestOverlapSentence(source, needle string) string {
	needleWords := wordSet(needle)
	if len(needleWords) == 0 {
		return ""
	}

	best := ""
	bestScore := 0.0
	for _, sentence := range splitSentences(source) {
		words := wordSet(sentence)
		if len(words) == 0 {
			continue
		}
		overlap := 0
		for word := range words {
			if _, ok := needleWords[word]; ok {
				overlap++
			}
		}
		// Prefer high shared-absolute-overlap with a mild short-sentence bias.
		score := float64(overlap) / (float64(len(words)) + 4.0)
		if score > bestScore {
			bestScore = score
			best = sentence
		}
	}
	return best
}

func splitSentences(source string) []string {
	return strings.FieldsFunc(source, func(r rune) bool {
		return r == '.' || r == '!' || r == '?' || r == '\n' || r == ';'
	})
}

func wordSet(text string) map[string]struct{} {
	words := strings.Fields(strings.ToLower(text))
	set := make(map[string]struct{}, len(words))
	for _, word := range words {
		word = strings.Trim(word, ".,;:!?\"'()[]—-")
		if word == "" {
			continue
		}
		set[word] = struct{}{}
	}
	return set
}

var (
	researchPercentRe = regexp.MustCompile(`\b\d+(?:\.\d+)?\s*%`)
	researchMoneyRe   = regexp.MustCompile(`\$\s?\d[\d,]*(?:\.\d+)?\s?(?:million|billion|trillion|[KMB])?`)
	researchYearRe    = regexp.MustCompile(`\b(?:19|20)\d{2}\b`)
	// A capitalized proper noun following these tokens is most likely a product /
	// drug / intervention, so it tags as PRODUCT. Mid-sentence (it follows a
	// preposition), so it never collides with a sentence-initial word.
	researchProductRe = regexp.MustCompile(`\b(?:with|of|using|treating|administered|therapy)\s+([A-Z][a-zA-Z][a-zA-Z-]*)\b`)
)

var researchEntityStopwords = map[string]struct{}{
	"the": {}, "and": {}, "or": {}, "but": {}, "a": {}, "an": {}, "in": {}, "on": {},
	"at": {}, "to": {}, "for": {}, "of": {}, "with": {}, "by": {}, "from": {},
	"that": {}, "this": {}, "these": {}, "those": {}, "is": {}, "are": {}, "was": {},
	"were": {}, "it": {}, "its": {}, "as": {}, "than": {}, "when": {}, "where": {},
	"which": {}, "while": {}, "study": {}, "reported": {}, "treatment": {},
	"significantly": {}, "survival": {}, "rates": {}, "cohort": {}, "results": {},
	"data": {}, "effect": {}, "method": {}, "methods": {}, "model": {}, "models": {},
}

// supplementEntityTags deterministically tags unambiguous entities (percentages,
// money, years, products after a preposition, and all-caps acronyms) so the
// claim graph stays useful even when the model under-tags entities.
func supplementEntityTags(text string) []string {
	var tags []string
	seen := make(map[string]struct{})

	add := func(tag string) {
		if _, ok := seen[tag]; ok {
			return
		}
		seen[tag] = struct{}{}
		tags = append(tags, tag)
	}

	for _, match := range researchPercentRe.FindAllString(text, -1) {
		add("[PERCENT:" + strings.TrimSpace(match) + "]")
	}
	for _, match := range researchMoneyRe.FindAllString(text, -1) {
		add("[MONEY:" + strings.TrimSpace(match) + "]")
	}
	for _, match := range researchYearRe.FindAllString(text, -1) {
		add("[DATE:" + match + "]")
	}
	for _, match := range researchProductRe.FindAllStringSubmatch(text, -1) {
		if len(match) >= 2 && !isResearchStopword(strings.ToLower(match[1])) {
			add("[PRODUCT:" + match[1] + "]")
		}
	}
	return tags
}

func isResearchStopword(word string) bool {
	_, ok := researchEntityStopwords[word]
	return ok
}

// mergeEntityTags unions two sets of entity tags, de-duplicating on the
// normalized TYPE|value key.
func mergeEntityTags(left, right []string) []string {
	seen := make(map[string]struct{}, len(left)+len(right))
	next := make([]string, 0, len(left)+len(right))
	for _, tag := range append(append([]string(nil), left...), right...) {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		prefix, value, ok := splitEntityTag(tag)
		if !ok || value == "" || prefix == "" {
			continue
		}
		if _, allowed := canonicalResearchEntityTypes[prefix]; !allowed {
			continue
		}
		key := prefix + "|" + strings.ToLower(value)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		next = append(next, tag)
	}
	return next
}

func splitEntityTag(entity string) (prefix, value string, ok bool) {
	entity = strings.TrimSpace(entity)
	if len(entity) < 4 || entity[0] != '[' || entity[len(entity)-1] != ']' {
		return "", "", false
	}
	inner := entity[1 : len(entity)-1]
	colon := strings.Index(inner, ":")
	if colon <= 0 {
		return "", "", false
	}
	return strings.ToUpper(strings.TrimSpace(inner[:colon])), strings.TrimSpace(inner[colon+1:]), true
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "\n…"
}
