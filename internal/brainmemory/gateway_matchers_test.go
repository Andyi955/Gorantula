package brainmemory

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestExtractClaimMatches(t *testing.T) {
	text := "The MSCI EM Index delivering 33.6% total return while crude slid to $78/bbl and the fed held 3.50% to 3.75%."
	claims := extractClaimMatches(text, "node-1")

	values := map[string]string{}
	for _, claim := range claims {
		values[claim.Value] = claim.Evidence.Label
	}
	if _, ok := values["33.6%"]; !ok {
		t.Fatalf("expected 33.6%% claim, got %#v", values)
	}
	if _, ok := values["$78"]; !ok {
		t.Fatalf("expected $78 currency claim, got %#v", values)
	}
	if _, ok := values["3.50%-3.75%"]; !ok {
		t.Fatalf("expected normalized rate-range claim, got %#v", values)
	}
	if !strings.Contains(values["33.6%"], "index") {
		t.Fatalf("expected anchor context in claim label, got %q", values["33.6%"])
	}
	for _, claim := range claims {
		if claim.Evidence.Kind != GatewayClaims || claim.Evidence.NodeIDs == nil {
			t.Fatalf("expected claims evidence metadata, got %#v", claim)
		}
	}
}

func TestExtractPatternEvidence(t *testing.T) {
	entities := []extractedEvidence{
		{Value: "ORG|acme grid", Evidence: signalEvidence{Label: "Acme Grid", Kind: "ORG", NodeIDs: []string{"node-1"}}},
		{Value: "ORG|nvidia", Evidence: signalEvidence{Label: "Nvidia", Kind: "ORG", NodeIDs: []string{"node-1"}}},
	}
	patterns := extractPatternEvidence(entities, "node-1")
	if len(patterns) != 1 {
		t.Fatalf("expected one co-occurrence pair, got %#v", patterns)
	}
	if patterns[0].Value != "ORG|acme grid~ORG|nvidia" {
		t.Fatalf("unexpected pair value %q", patterns[0].Value)
	}
	if patterns[0].Evidence.Label != "Acme Grid + Nvidia" {
		t.Fatalf("unexpected pair label %q", patterns[0].Evidence.Label)
	}

	if pairs := extractPatternEvidence(entities[:1], "node-1"); pairs != nil {
		t.Fatalf("expected no pairs from a single entity, got %#v", pairs)
	}
}

func TestPatternGatewayFiresOnNamedCoOccurrence(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Chip Alliance Case"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"current-node",
			"data":{
				"summary":"[ORG:Acme Grid] partners with [ORG:Nvidia] on capacity planning."
			}
		}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Chip Alliance"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"old-node",
			"data":{
				"summary":"Archives show [ORG:Acme Grid] partners with [ORG:Nvidia] since last year."
			}
		}],
		"edges":[]
	}`, "")

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if len(signals) != 1 {
		t.Fatalf("expected one signal, got %#v", signals)
	}
	if !signals[0].HasGateway(GatewayPattern) {
		t.Fatalf("expected pattern gateway in signal, got %#v", signals[0])
	}
	found := false
	for _, reason := range signals[0].Reasons {
		if reason.Gateway == GatewayPattern {
			found = true
			if reason.Value != "ORG|acme grid~ORG|nvidia" {
				t.Fatalf("unexpected pattern value %q", reason.Value)
			}
			if !strings.Contains(reason.Detail, "Acme Grid + Nvidia") {
				t.Fatalf("expected explainable pattern detail, got %q", reason.Detail)
			}
		}
	}
	if !found {
		t.Fatalf("expected a pattern reason, got %#v", signals[0].Reasons)
	}
}

func TestClaimsGatewayFiresOnSharedQuantifiedValue(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "EM Returns Now"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"current-node",
			"data":{
				"summary":"Emerging market funds delivered 33.6% in 2025 according to the latest tally."
			}
		}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "EM Returns Earlier"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"old-node",
			"data":{
				"summary":"Earlier research logged the index returning 33.6% for the same window."
			}
		}],
		"edges":[]
	}`, "")

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if len(signals) != 1 {
		t.Fatalf("expected one signal, got %#v", signals)
	}
	if !signals[0].HasGateway(GatewayClaims) {
		t.Fatalf("expected claims gateway in signal, got %#v", signals[0])
	}
	found := false
	for _, reason := range signals[0].Reasons {
		if reason.Gateway == GatewayClaims {
			found = true
			if reason.Value != "33.6%" {
				t.Fatalf("unexpected claim value %q", reason.Value)
			}
		}
	}
	if !found {
		t.Fatalf("expected a claims reason, got %#v", signals[0].Reasons)
	}
}

func TestSemanticGatewayFiresOnTopicalOverlapOnly(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-a", "Quantum Watch"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"a-node",
			"data":{
				"summary":"Quantum processors break cryptography records as qubit error rates fall across superconducting chips and research teams track every correction milestone.",
				"fullText":"Superconducting quantum processors push qubit error correction further while cryptography labs watch processor records fall and chip scaling accelerates toward practical limits for the whole quantum computing field."
			}
		}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-b", "Quantum Ledger"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"b-node",
			"data":{
				"summary":"Superconducting quantum processors push qubit error correction milestones while cryptography researchers watch chip records fall.",
				"fullText":"Quantum computing teams track processor scaling as superconducting chips push error correction records toward practical cryptography limits this year."
			}
		}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-c", "Market Watch"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"c-node",
			"data":{
				"summary":"Analysts debate oil demand while energy shares lag the broader equity rally and gold steadies after a volatile week of trading.",
				"fullText":"The equity desk watched energy shares lag as gold steadied and analysts debated whether the rally broadens next quarter or stalls into summer."
			}
		}],
		"edges":[]
	}`, "")

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-a")
	if err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if len(signals) != 1 {
		t.Fatalf("expected exactly the quantum-to-quantum signal, got %#v", signals)
	}
	if signals[0].TargetInvestigationID != "inv-b" {
		t.Fatalf("expected target inv-b, got %#v", signals[0])
	}
	if !signals[0].HasGateway(GatewaySemantic) {
		t.Fatalf("expected semantic gateway in signal, got %#v", signals[0])
	}
	if len(signals[0].Reasons) != 1 || signals[0].Reasons[0].Gateway != GatewaySemantic {
		t.Fatalf("expected a single semantic reason, got %#v", signals[0].Reasons)
	}
	if strings.TrimSpace(signals[0].Reasons[0].Label) == "" {
		t.Fatalf("expected shared salient tokens as the route label, got %#v", signals[0].Reasons[0])
	}
}

func TestSemanticFingerprintRequiresMinimumVocabulary(t *testing.T) {
	fingerprint := buildSemanticFingerprint([]string{"Tiny summary with a few tokens only."})
	if fingerprint.Vector != nil {
		t.Fatalf("expected no fingerprint below the vocabulary floor, got %d dims", len(fingerprint.Vector))
	}
	rich := buildSemanticFingerprint([]string{strings.Repeat("quantum processors push qubit error correction across superconducting chips while cryptography labs track scaling milestones researchers journal calibration data per dilution refrigerator cycle publish replication benchmarks every fabricated device family ", 3)})
	if rich.Vector == nil || len(rich.Tokens) == 0 {
		t.Fatalf("expected a fingerprint above the vocabulary floor, got %#v", rich)
	}
}

func TestDatePairPatternDoesNotAutoPromote(t *testing.T) {
	// Calendar co-occurrence (two dates in one node) must enrich the signal,
	// not qualify thin date-only evidence for one-shot auto-promotion.
	current := buildProfileForTest(t, "inv-current", "[DATE:2026-05-20] and [DATE:2026-05-21] anchor the schedule.")
	target := buildProfileForTest(t, "inv-old", "[DATE:2026-05-20] and [DATE:2026-05-21] anchored the older schedule.")
	registry := map[string]bool{}
	for _, gateway := range builtinGatewayDefinitions("2026-09-04T00:00:00Z") {
		registry[gateway.Code] = gateway.Enabled
	}
	signal, ok := buildSignal(current, target, "2026-09-04T00:00:00Z", registry)
	if !ok {
		t.Fatal("expected the date-pair signal to fire")
	}
	if !signal.HasGateway(GatewayPattern) {
		t.Fatalf("expected pattern gateway, got %#v", signal)
	}
	if shouldAutoPromoteSignal(signal) {
		t.Fatalf("date-pair pattern must not auto-promote, got %#v", signal)
	}
}

func buildProfileForTest(t *testing.T, id string, summary string) memoryProfile {
	t.Helper()
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord(id, "Profile Fixture "+id), `{
		"mode":"strict-grid",
		"nodes":[{"id":"node-x","data":{"summary":"`+summary+`"}}],
		"edges":[]
	}`, "")
	service := NewService(root)
	profile, err := service.buildProfile(rootRecord(id, "Profile Fixture "+id))
	if err != nil {
		t.Fatalf("buildProfile failed: %v", err)
	}
	return profile
}
