package research

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Andyi955/Gorantula/models"
)

// claimPolarity is a cheap directional signal used to separate contradictory
// claims from converging ones. This is the deterministic "negation/contrast
// resolution" the plan flagged; it is a heuristic, not an NER/NLI model, so it
// covers the clear cases and is always auditable.
type claimPolarity int

const (
	polarityNeutral claimPolarity = iota
	polarityPositive
	polarityNegative
)

var researchPositiveMarkers = []string{
	"increase", "improve", "enhanc", "boost", "raise", "promot", "accelerat",
	"grow", "rise", "elevat", "augment", "ameliorat", "higher", "more", "faster",
}

var researchNegativeMarkers = []string{
	"does not", "do not", "did not", "no effect", "no significant", "fails to",
	"fail to", "cannot", "without", "absent", "lack", "inhibit", "reduc",
	"decreas", "suppress", "block", "prevent", "lower", "fewer", "declin",
	"negat", "not",
}

func claimPolarityOf(text string) claimPolarity {
	lower := strings.ToLower(text)
	negative := containsAny(lower, researchNegativeMarkers)
	positive := containsAny(lower, researchPositiveMarkers)
	switch {
	case negative && !positive:
		return polarityNegative
	case positive && !negative:
		return polarityPositive
	case positive && negative:
		return polarityNegative // explicit negation wins over a trailing adverb
	default:
		return polarityNeutral
	}
}

func containsAny(haystack string, needles []string) bool {
	for _, needle := range needles {
		if strings.Contains(haystack, needle) {
			return true
		}
	}
	return false
}

// entityKey normalizes an entity tag into a stable equality key ("TYPE|value").
func entityKey(tag string) (string, bool) {
	tag = strings.TrimSpace(tag)
	if len(tag) < 4 || tag[0] != '[' || tag[len(tag)-1] != ']' {
		return "", false
	}
	inner := tag[1 : len(tag)-1]
	colon := strings.Index(inner, ":")
	if colon <= 0 {
		return "", false
	}
	prefix := strings.ToUpper(strings.TrimSpace(inner[:colon]))
	value := strings.ToLower(strings.TrimSpace(inner[colon+1:]))
	if prefix == "" || value == "" {
		return "", false
	}
	return prefix + "|" + value, true
}

func sharedEntityKeys(aEntities, bEntities []string) []string {
	aSet := make(map[string]struct{}, len(aEntities))
	for _, tag := range aEntities {
		if key, ok := entityKey(tag); ok {
			aSet[key] = struct{}{}
		}
	}
	var shared []string
	seen := make(map[string]struct{}, len(bEntities))
	for _, tag := range bEntities {
		if key, ok := entityKey(tag); ok {
			if _, inA := aSet[key]; inA {
				if _, dup := seen[key]; !dup {
					seen[key] = struct{}{}
					shared = append(shared, key)
				}
			}
		}
	}
	return shared
}

// buildClaimRelations returns deterministic cross-paper relations between
// claims that share at least one entity, using polarity to pick the kind.
func buildClaimRelations(claims []models.Claim) []models.ClaimRelation {
	var relations []models.ClaimRelation
	for i := 0; i < len(claims); i++ {
		for j := i + 1; j < len(claims); j++ {
			a := claims[i]
			b := claims[j]
			if a.PaperID == b.PaperID || a.PaperID == "" || b.PaperID == "" {
				continue // only cross-paper relations surface as signals
			}
			shared := sharedEntityKeys(a.Entities, b.Entities)
			if len(shared) == 0 {
				continue
			}
			kind := relationKindForPolarities(claimPolarityOf(a.Text), claimPolarityOf(b.Text))
			relations = append(relations, models.ClaimRelation{
				ID:            relationID(a.ID, b.ID, kind),
				SourceClaimID: a.ID,
				TargetClaimID: b.ID,
				RelationKind:  kind,
				Basis:         shared,
				Strength:      float32(len(shared)),
				CreatedBy:     "overlap",
			})
		}
	}
	return relations
}

func relationKindForPolarities(a, b claimPolarity) string {
	if (a == polarityPositive && b == polarityNegative) ||
		(a == polarityNegative && b == polarityPositive) {
		return models.ClaimRelationContradicts
	}
	if a != polarityNeutral && a == b {
		return models.ClaimRelationConverges
	}
	return models.ClaimRelationSupports
}

func relationID(aID, bID, kind string) string {
	pair := []string{aID, bID}
	sort.Strings(pair)
	return fmt.Sprintf("rel-%s-%s-%s", pair[0], pair[1], kind)
}

// buildSignals surfaces the contradiction and convergence relations as the
// findable signals of the corpus.
func buildSignals(relations []models.ClaimRelation, claims []models.Claim) []models.ResearchSignal {
	claimByID := make(map[string]models.Claim, len(claims))
	for _, claim := range claims {
		claimByID[claim.ID] = claim
	}

	var signals []models.ResearchSignal
	seen := make(map[string]struct{}, len(relations))
	for _, rel := range relations {
		var kind, title, reasoning string
		switch rel.RelationKind {
		case models.ClaimRelationContradicts:
			kind = models.ResearchSignalContradiction
			title = "Contradiction: " + relationPhrase(rel, claimByID)
			reasoning = "Two claims about a shared entity point in opposite directions."
		case models.ClaimRelationConverges:
			kind = models.ResearchSignalConvergence
			title = "Convergence: " + relationPhrase(rel, claimByID)
			reasoning = "Two independent claims about a shared entity agree in direction."
		default:
			continue
		}

		sig := researchSignalFromRelation(rel, kind, title, reasoning, claimByID)
		if _, ok := seen[sig.ID]; ok {
			continue
		}
		seen[sig.ID] = struct{}{}
		signals = append(signals, sig)
	}
	return signals
}

func researchSignalFromRelation(
	rel models.ClaimRelation,
	kind, title, reasoning string,
	claimByID map[string]models.Claim,
) models.ResearchSignal {
	a := claimByID[rel.SourceClaimID]
	b := claimByID[rel.TargetClaimID]
	claimIDs := []string{a.ID, b.ID}
	paperIDs := uniqueSorted([]string{a.PaperID, b.PaperID})
	idClaimIDs := append([]string(nil), claimIDs...)
	sort.Strings(idClaimIDs)
	return models.ResearchSignal{
		ID:        fmt.Sprintf("signal-%s-%s", kind, strings.Join(idClaimIDs, "|")),
		Kind:      kind,
		Title:     title,
		ClaimIDs:  claimIDs,
		PaperIDs:  paperIDs,
		Reasoning: reasoning,
		Strength:  rel.Strength,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

func relationPhrase(rel models.ClaimRelation, claimByID map[string]models.Claim) string {
	a := claimByID[rel.SourceClaimID]
	b := claimByID[rel.TargetClaimID]
	entity := ""
	if len(rel.Basis) > 0 {
		entity = humanizeEntityKey(rel.Basis[0])
	}
	if entity != "" {
		return fmt.Sprintf("%s (%s) vs %s (%s)", shortClaim(a), a.PaperID, shortClaim(b), entity)
	}
	return fmt.Sprintf("%s (%s) vs %s (%s)", shortClaim(a), a.PaperID, shortClaim(b), b.PaperID)
}

// shortClaim keeps the signal headline human-sized but not chopped: it only
// truncates very long claims, and the frontend can expand to the full text.
func shortClaim(claim models.Claim) string {
	text := strings.TrimSpace(claim.Text)
	runes := []rune(text)
	if len(runes) > 180 {
		return string(runes[:180]) + "…"
	}
	return text
}

func humanizeEntityKey(key string) string {
	parts := strings.SplitN(key, "|", 2)
	if len(parts) != 2 {
		return key
	}
	return parts[1]
}

func uniqueSorted(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	next := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		next = append(next, value)
	}
	sort.Strings(next)
	return next
}
