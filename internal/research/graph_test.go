package research

import (
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func TestClaimPolarity(t *testing.T) {
	cases := map[string]claimPolarity{
		"The drug increases survival in patients.":         polarityPositive,
		"The drug does not increase survival in patients.": polarityNegative,
		"The method is described in section 2.":            polarityNeutral,
		"We observed no significant effect.":               polarityNegative,
	}
	for text, want := range cases {
		if got := claimPolarityOf(text); got != want {
			t.Errorf("claimPolarityOf(%q) = %d, want %d", text, got, want)
		}
	}
}

func TestBuildClaimRelations(t *testing.T) {
	claims := []models.Claim{
		{ID: "a", PaperID: "p1", Text: "The drug increases survival in patients.", Entities: []string{"[ORG:Acme]", "[PRODUCT:DrugX]"}},
		{ID: "b", PaperID: "p2", Text: "The drug does not increase survival in patients.", Entities: []string{"[ORG:Acme]", "[PRODUCT:DrugX]"}},
		{ID: "c", PaperID: "p3", Text: "The drug improves survival in patients.", Entities: []string{"[ORG:Acme]"}},
		{ID: "same", PaperID: "p1", Text: "Another claim about Acme.", Entities: []string{"[ORG:Acme]"}},
	}

	relations := buildClaimRelations(claims)

	contradictsAB := findRelation(relations, "a", "b")
	if contradictsAB == nil {
		t.Fatalf("expected a CONTRADICTS relation between a and b")
	}
	if contradictsAB.RelationKind != models.ClaimRelationContradicts {
		t.Errorf("kind = %q, want %q", contradictsAB.RelationKind, models.ClaimRelationContradicts)
	}
	if contradictsAB.Strength != 2 {
		t.Errorf("strength = %v, want 2", contradictsAB.Strength)
	}

	convergesAC := findRelation(relations, "a", "c")
	if convergesAC == nil {
		t.Fatalf("expected a CONVERGES relation between a and c")
	}
	if convergesAC.RelationKind != models.ClaimRelationConverges {
		t.Errorf("kind = %q, want %q", convergesAC.RelationKind, models.ClaimRelationConverges)
	}

	// Same paper (a, same) must not produce a cross-paper relation.
	if findRelation(relations, "a", "same") != nil {
		t.Errorf("should not create a relation between same-paper claims")
	}
}

func TestBuildSignals(t *testing.T) {
	claims := []models.Claim{
		{ID: "a", PaperID: "p1", Text: "The drug increases survival.", Entities: []string{"[ORG:Acme]"}},
		{ID: "b", PaperID: "p2", Text: "The drug does not increase survival.", Entities: []string{"[ORG:Acme]"}},
		{ID: "c", PaperID: "p3", Text: "The drug improves survival.", Entities: []string{"[ORG:Acme]"}},
	}
	relations := buildClaimRelations(claims)
	signals := buildSignals(relations, claims)

	foundContradiction := false
	foundConvergence := false
	for _, signal := range signals {
		switch signal.Kind {
		case models.ResearchSignalContradiction:
			foundContradiction = true
		case models.ResearchSignalConvergence:
			foundConvergence = true
		}
		if signal.ID == "" || signal.Title == "" {
			t.Errorf("signal missing id/title: %+v", signal)
		}
	}
	if !foundContradiction {
		t.Errorf("expected a contradiction signal, got %+v", signals)
	}
	if !foundConvergence {
		t.Errorf("expected a convergence signal, got %+v", signals)
	}
}

func TestStoreRelationsAndSignalsRoundTrip(t *testing.T) {
	store := NewStore(t.TempDir())

	relations := []models.ClaimRelation{
		{ID: "rel-1", SourceClaimID: "a", TargetClaimID: "b", RelationKind: models.ClaimRelationContradicts, Strength: 2},
	}
	if err := store.SaveRelations(relations); err != nil {
		t.Fatalf("SaveRelations: %v", err)
	}
	got, err := store.LoadRelations()
	if err != nil {
		t.Fatalf("LoadRelations: %v", err)
	}
	if len(got) != 1 || got[0].ID != "rel-1" {
		t.Fatalf("relations round trip: %+v", got)
	}

	signals := []models.ResearchSignal{
		{ID: "sig-1", Kind: models.ResearchSignalContradiction, ClaimIDs: []string{"a", "b"}},
	}
	if err := store.SaveSignals(signals); err != nil {
		t.Fatalf("SaveSignals: %v", err)
	}
	sigGot, err := store.LoadSignals()
	if err != nil {
		t.Fatalf("LoadSignals: %v", err)
	}
	if len(sigGot) != 1 || sigGot[0].ID != "sig-1" {
		t.Fatalf("signals round trip: %+v", sigGot)
	}
}

func TestServiceRebuildGraphPersists(t *testing.T) {
	svc := NewService(t.TempDir(), nil)
	_ = svc.store.SaveClaims([]models.Claim{
		{ID: "a", PaperID: "p1", Text: "The drug increases survival.", Entities: []string{"[ORG:Acme]"}},
		{ID: "b", PaperID: "p2", Text: "The drug does not increase survival.", Entities: []string{"[ORG:Acme]"}},
	})

	signals, err := svc.rebuildGraph()
	if err != nil {
		t.Fatalf("rebuildGraph: %v", err)
	}
	if len(signals) == 0 {
		t.Fatalf("expected at least one signal from the rebuild")
	}

	list, err := svc.ListSignals()
	if err != nil {
		t.Fatalf("ListSignals: %v", err)
	}
	if len(list) != len(signals) {
		t.Fatalf("signals not persisted: %d vs %d", len(list), len(signals))
	}
}

func findRelation(relations []models.ClaimRelation, aID, bID string) *models.ClaimRelation {
	for i := range relations {
		a, b := relations[i].SourceClaimID, relations[i].TargetClaimID
		if (a == aID && b == bID) || (a == bID && b == aID) {
			return &relations[i]
		}
	}
	return nil
}
