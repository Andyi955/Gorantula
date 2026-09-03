package brainmemory

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func writeTestInvestigation(t *testing.T, root string, record models.InvestigationRecord, board string, relationships string) {
	t.Helper()
	store := models.NewInvestigationStore(root)
	if err := store.SaveMetadata(record); err != nil {
		t.Fatalf("SaveMetadata(%s) failed: %v", record.ID, err)
	}
	if err := store.SaveJSON(record.ID, models.InvestigationBoardFilename, json.RawMessage(board)); err != nil {
		t.Fatalf("Save board for %s failed: %v", record.ID, err)
	}
	if relationships != "" {
		if err := store.SaveJSON(record.ID, models.InvestigationRelationshipsFilename, json.RawMessage(relationships)); err != nil {
			t.Fatalf("Save relationships for %s failed: %v", record.ID, err)
		}
	}
}

func rootRecord(id string, title string) models.InvestigationRecord {
	return models.InvestigationRecord{
		ID:           id,
		Topic:        title,
		Kind:         "root",
		DisplayTopic: title,
	}
}

func TestServiceGeneratesRecallBundleSignals(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Grid Case"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"current-node",
			"data":{
				"title":"Current Grid Lead",
				"summary":"[ORG:Acme Grid] resurfaces during [DATE:2026-05-20] capacity talks.",
				"fullText":"[ORG:Acme Grid] resurfaces during [DATE:2026-05-20] capacity talks.",
				"sourceURL":"https://intel.example.com/current"
			}
		}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Grid Memory"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"old-node",
			"data":{
				"title":"Older Grid Lead",
				"summary":"Prior notes tied [ORG:Acme Grid] to [DATE:2026-05-20] cooling stress.",
				"fullText":"Prior notes tied [ORG:Acme Grid] to [DATE:2026-05-20] cooling stress.",
				"sourceURL":"https://intel.example.com/archive"
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
		t.Fatalf("expected one signal, got %d: %#v", len(signals), signals)
	}

	signal := signals[0]
	if signal.TargetInvestigationID != "inv-old" {
		t.Fatalf("expected target inv-old, got %q", signal.TargetInvestigationID)
	}
	if signal.Score < 0.65 {
		t.Fatalf("expected useful recall score, got %.2f", signal.Score)
	}
	if signal.Relevance != RelevanceStrongMemory {
		t.Fatalf("expected strong memory relevance, got %#v", signal)
	}
	for _, gateway := range []string{GatewayEntityDate, GatewaySourceDomain} {
		if !signal.HasGateway(gateway) {
			t.Fatalf("expected gateway %s in %#v", gateway, signal.Gateways)
		}
	}
	if signal.SuggestedAction == "" {
		t.Fatal("expected suggested action text")
	}
	if !strings.Contains(strings.Join(signal.ReasonTexts(), " "), "Acme Grid") {
		t.Fatalf("expected explainable entity reason, got %#v", signal.Reasons)
	}
}

func TestServiceAutoPromotesStrongMultiGatewaySignals(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Grid Case"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"current-node",
			"data":{
				"summary":"[ORG:Acme Grid] appears during [DATE:2026-05-20].",
				"sourceURL":"https://intel.example.com/current"
			}
		}],
		"edges":[{
			"source":"current-node",
			"target":"current-node",
			"data":{"tag":"INFRASTRUCTURE_STRESS"}
		}]
	}`, `{
		"vaultId":"inv-current",
		"connections":[{"source":"current-node","target":"current-node","tag":"INFRASTRUCTURE_STRESS"}]
	}`)
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Grid Memory"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"old-node",
			"data":{
				"summary":"Prior notes tied [ORG:Acme Grid] to [DATE:2026-05-20].",
				"sourceURL":"https://intel.example.com/archive"
			}
		}],
		"edges":[{
			"source":"old-node",
			"target":"old-node",
			"data":{"tag":"INFRASTRUCTURE_STRESS"}
		}]
	}`, `{
		"vaultId":"inv-old",
		"connections":[{"source":"old-node","target":"old-node","tag":"INFRASTRUCTURE_STRESS"}]
	}`)

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if len(signals) != 0 {
		t.Fatalf("strong multi-gateway signal should auto-promote instead of remaining active, got %#v", signals)
	}

	links, err := service.LinksForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("LinksForInvestigation failed: %v", err)
	}
	if len(links) != 1 {
		t.Fatalf("expected one auto-promoted memory link, got %#v", links)
	}
	link := links[0]
	if link.Score < 0.85 {
		t.Fatalf("expected strong link score, got %.2f", link.Score)
	}
	for _, gateway := range []string{GatewayEntityDate, GatewaySourceDomain, GatewayRelationshipTag} {
		found := false
		for _, candidate := range link.Gateways {
			if candidate == gateway {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("expected gateway %s in %#v", gateway, link.Gateways)
		}
	}
	linkJSON := memoryLinkJSON(t, link)
	if linkJSON["promotionType"] != "auto" {
		t.Fatalf("expected auto promotion type, got %#v", linkJSON["promotionType"])
	}
	if linkJSON["activationCount"] != float64(1) {
		t.Fatalf("expected activationCount 1, got %#v", linkJSON["activationCount"])
	}
	if strings.TrimSpace(linkJSON["lastFiredAt"].(string)) == "" {
		t.Fatalf("expected lastFiredAt to be set in %#v", linkJSON)
	}
}

func TestServiceKeepsNoisyDateSourceSignalsManual(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Date Sweep"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{
			"summary":"[DATE:2026-05-20], [DATE:2026-05-21], [DATE:2026-05-22], and [DATE:2030] appear in a broad market scan.",
			"sourceURL":"https://wire.example.com/current",
			"sourceURLs":["https://archive.example.com/current","https://press.example.com/current"]
		}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Date Sweep"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-node","data":{
			"summary":"[DATE:2026-05-20], [DATE:2026-05-21], [DATE:2026-05-22], and [DATE:2030] appeared in prior broad coverage.",
			"sourceURL":"https://wire.example.com/old",
			"sourceURLs":["https://archive.example.com/old","https://press.example.com/old"]
		}}],
		"edges":[]
	}`, "")

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if len(signals) != 1 {
		t.Fatalf("expected noisy date/source overlap to stay active for manual review, got %#v", signals)
	}
	if signals[0].Score < autoPromotionScoreThreshold {
		t.Fatalf("test needs a hot noisy signal, got %.2f", signals[0].Score)
	}
	links, err := service.LinksForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("LinksForInvestigation failed: %v", err)
	}
	if len(links) != 0 {
		t.Fatalf("noisy date/source overlap should not auto-promote, got %#v", links)
	}
}

func TestServiceDampensBroadContextOnlySignals(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "China Robot Supply Chain"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{
			"summary":"[LOC:China] appears in a robotics supply-chain investigation."
		}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Olympics Broadcast Rights"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-node","data":{
			"summary":"[LOC:China] appears in an Olympics broadcasting investigation."
		}}],
		"edges":[]
	}`, "")

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if len(signals) != 1 {
		t.Fatalf("expected broad context signal to remain visible for context, got %#v", signals)
	}
	signal := signals[0]
	if signal.Score >= 0.35 {
		t.Fatalf("expected broad context-only signal to be dampened below weak threshold, got %.2f", signal.Score)
	}
	if signal.Relevance != RelevanceBackgroundNoise {
		t.Fatalf("expected broad context-only signal to be labeled background noise, got %#v", signal)
	}
	if signal.RelevanceLabel != "Background Noise" {
		t.Fatalf("expected readable background-noise label, got %q", signal.RelevanceLabel)
	}
	if !strings.Contains(signal.SuggestedAction, "bridge evidence") {
		t.Fatalf("expected bridge-evidence guidance for broad context signal, got %q", signal.SuggestedAction)
	}
	if !strings.Contains(strings.Join(signal.ReasonTexts(), " "), "broad context") {
		t.Fatalf("expected reason text to explain broad context distance, got %#v", signal.Reasons)
	}
}

func TestServiceKeepsDistantEchoesVisibleButManual(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "China Robotics Supply Chain"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{
			"summary":"[LOC:China] appears in a robotics supply-chain investigation.",
			"sourceURL":"https://wire.example.com/robotics"
		}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Olympics Broadcast Rights"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-node","data":{
			"summary":"[LOC:China] appears in an Olympics broadcasting investigation.",
			"sourceURL":"https://wire.example.com/olympics"
		}}],
		"edges":[]
	}`, "")

	service := NewService(root)
	var signals []BrainSignal
	var err error
	for pass := 0; pass < repeatedPromotionActivationCount+1; pass++ {
		signals, err = service.GenerateSignals("inv-current")
		if err != nil {
			t.Fatalf("GenerateSignals pass %d failed: %v", pass+1, err)
		}
		if len(signals) != 1 {
			t.Fatalf("expected distant echo to remain active for manual review, got %#v", signals)
		}
	}
	signal := signals[0]
	if signal.Relevance != RelevanceDistantEcho {
		t.Fatalf("expected broad clue plus source bridge to become distant echo, got %#v", signal)
	}
	if signal.Score > 0.58 || signal.Score < 0.35 {
		t.Fatalf("expected distant echo score to stay speculative but visible, got %.2f", signal.Score)
	}
	if !strings.Contains(signal.SuggestedAction, "speculative bridge") {
		t.Fatalf("expected speculative bridge action, got %q", signal.SuggestedAction)
	}
	if !strings.Contains(strings.Join(signal.ReasonTexts(), " "), "distant echo") {
		t.Fatalf("expected reason text to explain distant echo, got %#v", signal.Reasons)
	}
	links, err := service.LinksForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("LinksForInvestigation failed: %v", err)
	}
	if len(links) != 0 {
		t.Fatalf("distant echoes should not auto-promote, got %#v", links)
	}
}

func TestBrainAttentionPrefersSpecificBridgeOverBackgroundNoise(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "China Robotics Supply Chain"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{
			"summary":"[LOC:China] appears beside [ORG:Acme Grid] in a robotics supply-chain investigation."
		}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-broad", "Olympics Broadcast Rights"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"broad-node","data":{
			"summary":"[LOC:China] appears in an Olympics broadcasting investigation."
		}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-specific", "Acme Grid Supplier Note"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"specific-node","data":{
			"summary":"[ORG:Acme Grid] appears in a supplier-risk investigation."
		}}],
		"edges":[]
	}`, "")

	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	attention, err := service.AttentionForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AttentionForInvestigation failed: %v", err)
	}
	if attention.Focus.Relevance == RelevanceBackgroundNoise {
		t.Fatalf("background noise should not own the focus narrative, got %#v", attention.Focus)
	}
	// The specific bridge may own focus directly or through the Acme Grid
	// cluster it anchors; what matters is that the broad [LOC:China] echo
	// never wins and the bridge relevance stays visible.
	if !strings.Contains(attention.Focus.PrimaryTitle, "Acme Grid") {
		t.Fatalf("expected the specific Acme Grid bridge to own focus, got %#v", attention.Focus)
	}
	if !containsString(attention.Focus.SupportingFacts, "Possible Bridge") {
		t.Fatalf("expected focus supporting facts to explain relevance, got %#v", attention.Focus.SupportingFacts)
	}
}

func TestServiceAutoPromotesRepeatedMeaningfulWarmSignals(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Warm Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{
			"summary":"[ORG:Acme Grid] appears with [DATE:2026-05-20], [DATE:2026-05-21], and [DATE:2026-05-22].",
			"sourceURL":"https://intel.example.com/current"
		}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Warm Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-node","data":{
			"summary":"[ORG:Acme Grid] appeared with [DATE:2026-05-20], [DATE:2026-05-21], and [DATE:2026-05-22].",
			"sourceURL":"https://intel.example.com/archive"
		}}],
		"edges":[]
	}`, "")

	service := NewService(root)
	for pass := 1; pass < repeatedPromotionActivationCount; pass++ {
		signals, err := service.GenerateSignals("inv-current")
		if err != nil {
			t.Fatalf("GenerateSignals pass %d failed: %v", pass, err)
		}
		if len(signals) != 1 {
			t.Fatalf("expected warm signal to remain active before repeat threshold, got %#v", signals)
		}
	}
	signals, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals at repeat threshold failed: %v", err)
	}
	if len(signals) != 0 {
		t.Fatalf("expected repeated meaningful warm signal to auto-promote, got %#v", signals)
	}
	links, err := service.LinksForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("LinksForInvestigation failed: %v", err)
	}
	if len(links) != 1 {
		t.Fatalf("expected repeated warm memory link, got %#v", links)
	}
	linkJSON := memoryLinkJSON(t, links[0])
	if linkJSON["promotionType"] != "auto" {
		t.Fatalf("expected auto promotion type, got %#v", linkJSON["promotionType"])
	}
}

func TestServiceReinforcesExistingMemoryLinkWithNewSignalEvidence(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{"summary":"[ORG:Acme Grid] appears.","sourceURL":"https://current.example.com/report"}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Old Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-node","data":{"summary":"[ORG:Acme Grid] appeared before.","sourceURL":"https://old.example.com/archive"}}],
		"edges":[]
	}`, "")

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-current")
	if err != nil || len(signals) != 1 {
		t.Fatalf("expected initial manual signal, got signals=%#v err=%v", signals, err)
	}
	if _, err := service.PromoteSignal(signals[0].ID); err != nil {
		t.Fatalf("PromoteSignal failed: %v", err)
	}

	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{"summary":"[ORG:Acme Grid] appears.","sourceURL":"https://intel.example.com/current"}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Old Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-node","data":{"summary":"[ORG:Acme Grid] appeared before.","sourceURL":"https://intel.example.com/archive"}}],
		"edges":[]
	}`, "")

	signals, err = service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals after new evidence failed: %v", err)
	}
	if len(signals) != 0 {
		t.Fatalf("existing memory link should absorb duplicate pair evidence, got active signals %#v", signals)
	}

	links, err := service.LinksForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("LinksForInvestigation failed: %v", err)
	}
	if len(links) != 1 {
		t.Fatalf("expected one reinforced memory link, got %#v", links)
	}
	link := links[0]
	linkJSON := memoryLinkJSON(t, link)
	if linkJSON["promotionType"] != "manual" {
		t.Fatalf("expected original manual promotion type to remain, got %#v", linkJSON["promotionType"])
	}
	if linkJSON["activationCount"] != float64(2) {
		t.Fatalf("expected activationCount 2, got %#v", linkJSON["activationCount"])
	}
	if len(link.Reasons) != 2 {
		t.Fatalf("expected new source-domain evidence to merge into existing link, got %#v", link.Reasons)
	}
	foundSourceGateway := false
	for _, gateway := range link.Gateways {
		if gateway == GatewaySourceDomain {
			foundSourceGateway = true
		}
	}
	if !foundSourceGateway {
		t.Fatalf("expected reinforced link to include source-domain gateway, got %#v", link.Gateways)
	}
}

func memoryLinkJSON(t *testing.T, link MemoryLink) map[string]interface{} {
	t.Helper()
	data, err := json.Marshal(link)
	if err != nil {
		t.Fatalf("marshal MemoryLink failed: %v", err)
	}
	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("unmarshal MemoryLink failed: %v", err)
	}
	return result
}

func TestServiceDoesNotGenerateSelfSignals(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-only", "Only Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"node-1","data":{"summary":"[ORG:Solo Grid] appears.","sourceURL":"https://solo.example.com/a"}}],
		"edges":[]
	}`, "")

	signals, err := NewService(root).GenerateSignals("inv-only")
	if err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if len(signals) != 0 {
		t.Fatalf("expected no self signals, got %#v", signals)
	}
}

func TestServiceGeneratesEntityDateMemoryClusters(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Grid Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{
			"summary":"[ORG:Acme Grid] appears during [DATE:2026-05-20] power stress.",
			"sourceURL":"https://intel.example.com/current"
		}}],
		"edges":[{"source":"current-node","target":"current-node","data":{"tag":"POWER_RISK"}}]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old-a", "Older Grid Alpha"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-a-node","data":{
			"summary":"[ORG:Acme Grid] appeared during [DATE:2026-05-20] capacity talks.",
			"sourceURL":"https://intel.example.com/alpha"
		}}],
		"edges":[{"source":"old-a-node","target":"old-a-node","data":{"tag":"POWER_RISK"}}]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old-b", "Older Grid Beta"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-b-node","data":{
			"summary":"[ORG:Acme Grid] resurfaced in [DATE:2026-05-21] cooling notes.",
			"sourceURL":"https://archive.example.com/beta"
		}}],
		"edges":[]
	}`, "")

	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	clusters, err := service.ClustersForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}

	cluster := findCluster(t, clusters, GatewayEntityDate, "Acme Grid")
	if cluster.ID == "" {
		t.Fatal("expected deterministic cluster id")
	}
	if cluster.Label != "Acme Grid" {
		t.Fatalf("expected cluster label Acme Grid, got %q", cluster.Label)
	}
	if cluster.Status != "active" {
		t.Fatalf("expected active cluster, got %q", cluster.Status)
	}
	if cluster.GatewayCounts[GatewayEntityDate] != 3 {
		t.Fatalf("expected entity/date count for all member investigations, got %#v", cluster.GatewayCounts)
	}
	for _, investigationID := range []string{"inv-current", "inv-old-a", "inv-old-b"} {
		if !containsString(cluster.MemberInvestigationIDs, investigationID) {
			t.Fatalf("expected cluster members to include %s, got %#v", investigationID, cluster.MemberInvestigationIDs)
		}
	}
	if len(cluster.ReasonSamples) == 0 || !strings.Contains(cluster.ReasonSamples[0].Detail, "Acme Grid") {
		t.Fatalf("expected explainable reason samples, got %#v", cluster.ReasonSamples)
	}
	if len(cluster.SignalIDs) == 0 {
		t.Fatalf("expected cluster to associate generated signal ids, got %#v", cluster.SignalIDs)
	}
	if len(cluster.MemoryLinkIDs) == 0 {
		t.Fatalf("expected cluster to associate promoted memory links, got %#v", cluster.MemoryLinkIDs)
	}

	recomputed, err := service.ClustersForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("second ClustersForInvestigation failed: %v", err)
	}
	recomputedCluster := findCluster(t, recomputed, GatewayEntityDate, "Acme Grid")
	if recomputedCluster.ID != cluster.ID {
		t.Fatalf("expected deterministic cluster id to persist, got %q then %q", cluster.ID, recomputedCluster.ID)
	}
}

func TestServiceGeneratesSourceAndRelationshipMemoryClusters(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Supply Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{"summary":"No tagged entities here.","sourceURL":"https://intel.example.com/current"}}],
		"edges":[{"source":"current-node","target":"current-node","data":{"tag":"SUPPLY_RISK"}}]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Supply Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-node","data":{"summary":"Older notes with the same source network.","sourceURL":"https://intel.example.com/archive"}}],
		"edges":[{"source":"old-node","target":"old-node","data":{"tag":"SUPPLY_RISK"}}]
	}`, "")

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if len(signals) != 1 {
		t.Fatalf("expected active source/relationship signal, got %#v", signals)
	}
	clusters, err := service.ClustersForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}

	sourceCluster := findCluster(t, clusters, GatewaySourceDomain, "intel.example.com")
	if !containsString(sourceCluster.SignalIDs, signals[0].ID) {
		t.Fatalf("expected source cluster to include signal %s, got %#v", signals[0].ID, sourceCluster.SignalIDs)
	}
	relationshipCluster := findCluster(t, clusters, GatewayRelationshipTag, "SUPPLY_RISK")
	if relationshipCluster.Summary == "" {
		t.Fatalf("expected relationship cluster summary, got %#v", relationshipCluster)
	}
	if relationshipCluster.GatewayCounts[GatewayRelationshipTag] != 2 {
		t.Fatalf("expected relationship gateway count for both investigations, got %#v", relationshipCluster.GatewayCounts)
	}
}

func TestServiceDoesNotGenerateSelfOnlyMemoryClusters(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-only", "Only Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"node-1","data":{"summary":"[ORG:Solo Grid] appears.","sourceURL":"https://solo.example.com/a"}}],
		"edges":[{"source":"node-1","target":"node-1","data":{"tag":"SOLO_RISK"}}]
	}`, "")

	clusters, err := NewService(root).ClustersForInvestigation("inv-only")
	if err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	if len(clusters) != 0 {
		t.Fatalf("expected no self-only clusters, got %#v", clusters)
	}
}

func TestClusterPinHideStatePersistsAcrossRecompute(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Grid Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{"summary":"[ORG:Acme Grid] appears."}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Old Grid Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-node","data":{"summary":"[ORG:Acme Grid] appeared before."}}],
		"edges":[]
	}`, "")

	service := NewService(root)
	// Materialize the derived stores through the recompute pass before reading.
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	clusters, err := service.ClustersForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	cluster := findCluster(t, clusters, GatewayEntityDate, "Acme Grid")

	pinned, err := service.ToggleClusterPin(cluster.ID)
	if err != nil {
		t.Fatalf("ToggleClusterPin failed: %v", err)
	}
	if !pinned.Pinned {
		t.Fatalf("expected cluster to be pinned, got %#v", pinned)
	}
	hidden, err := service.HideCluster(cluster.ID)
	if err != nil {
		t.Fatalf("HideCluster failed: %v", err)
	}
	if !hidden.Hidden {
		t.Fatalf("expected cluster to be hidden, got %#v", hidden)
	}

	clusters, err = service.ClustersForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("ClustersForInvestigation after state changes failed: %v", err)
	}
	cluster = findCluster(t, clusters, GatewayEntityDate, "Acme Grid")
	if !cluster.Pinned || !cluster.Hidden {
		t.Fatalf("expected pin/hide state to persist across recompute, got %#v", cluster)
	}

	unhidden, err := service.UnhideCluster(cluster.ID)
	if err != nil {
		t.Fatalf("UnhideCluster failed: %v", err)
	}
	if unhidden.Hidden {
		t.Fatalf("expected cluster to be unhidden, got %#v", unhidden)
	}
}

func TestServiceGeneratesBrainSuggestionsFromMemoryState(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}

	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}

	for _, kind := range []string{
		SuggestionKindClusterReview,
		SuggestionKindSourceReview,
		SuggestionKindRelationshipMotif,
		SuggestionKindMemoryLinkCompare,
		SuggestionKindGapReview,
	} {
		suggestion := findSuggestion(t, suggestions, kind)
		if suggestion.ID == "" {
			t.Fatalf("expected deterministic id for %s", kind)
		}
		if suggestion.Status != SuggestionStatusActive {
			t.Fatalf("expected active suggestion for %s, got %#v", kind, suggestion)
		}
		if strings.TrimSpace(suggestion.SuggestedAction) == "" {
			t.Fatalf("expected suggested action for %s, got %#v", kind, suggestion)
		}
		if len(suggestion.TargetInvestigationIDs) == 0 {
			t.Fatalf("expected target investigations for %s, got %#v", kind, suggestion)
		}
	}

	clusterSuggestion := findSuggestion(t, suggestions, SuggestionKindClusterReview)
	if len(clusterSuggestion.RelatedClusterIDs) == 0 {
		t.Fatalf("expected cluster suggestion to reference clusters, got %#v", clusterSuggestion)
	}
	linkSuggestion := findSuggestion(t, suggestions, SuggestionKindMemoryLinkCompare)
	if len(linkSuggestion.RelatedMemoryLinkIDs) == 0 {
		t.Fatalf("expected memory link suggestion to reference links, got %#v", linkSuggestion)
	}
	sourceSuggestion := findSuggestion(t, suggestions, SuggestionKindSourceReview)
	if len(sourceSuggestion.RelatedSignalIDs) == 0 {
		t.Fatalf("expected source suggestion to reference signals, got %#v", sourceSuggestion)
	}
}

func TestBrainSuggestionsRouteThinkingGateways(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}

	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}

	clusterSuggestion := findSuggestion(t, suggestions, SuggestionKindClusterReview)
	if clusterSuggestion.ThinkingGateway != ThinkingGatewayPattern {
		t.Fatalf("expected cluster review thinking gateway pattern, got %#v", clusterSuggestion)
	}
	if clusterSuggestion.ActionMode != SuggestionActionLaunchFollowUp {
		t.Fatalf("expected strong cluster review to allow focused follow-up, got %#v", clusterSuggestion)
	}

	sourceSuggestion := findSuggestion(t, suggestions, SuggestionKindSourceReview)
	if sourceSuggestion.ThinkingGateway != ThinkingGatewayCompareBridge {
		t.Fatalf("expected source review to route through compare bridge, got %#v", sourceSuggestion)
	}
	if sourceSuggestion.ActionMode != SuggestionActionCompare {
		t.Fatalf("expected source review to compare before launch, got %#v", sourceSuggestion)
	}

	linkSuggestion := findSuggestion(t, suggestions, SuggestionKindMemoryLinkCompare)
	if linkSuggestion.ThinkingGateway == "" || linkSuggestion.ThinkingReason == "" {
		t.Fatalf("expected memory link suggestion to include thinking metadata, got %#v", linkSuggestion)
	}
}

func TestBrainGapSuggestionsDoNotPrepareFollowUps(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "China Robotics Supply Chain"), `{
		"nodes":[{
			"id":"current-node",
			"data":{
				"title":"Robot supply chain",
				"summary":"[LOC:China] appears in a robotics supply note.",
				"fullText":"[LOC:China] appears in a robotics supply note.",
				"sourceURL":"https://broad.example.com/robotics"
			}
		}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Olympics Broadcast Rights"), `{
		"nodes":[{
			"id":"old-node",
			"data":{
				"title":"Olympics broadcast rights",
				"summary":"[LOC:China] appears in a sports broadcast note.",
				"fullText":"[LOC:China] appears in a sports broadcast note.",
				"sourceURL":"https://broad.example.com/sports"
			}
		}],
		"edges":[]
	}`, "")

	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}

	gapSuggestion := findSuggestion(t, suggestions, SuggestionKindGapReview)
	if gapSuggestion.ThinkingGateway != ThinkingGatewayGap {
		t.Fatalf("expected gap thinking gateway for distant echo, got %#v", gapSuggestion)
	}
	if gapSuggestion.ActionMode != SuggestionActionFillGap {
		t.Fatalf("expected gap suggestion to require bridge evidence, got %#v", gapSuggestion)
	}
	if !strings.Contains(strings.ToLower(gapSuggestion.ThinkingReason), "bridge") {
		t.Fatalf("expected gap thinking reason to mention bridge evidence, got %#v", gapSuggestion)
	}

	_, err = service.PrepareFollowUp(PrepareFollowUpRequest{
		InvestigationID: "inv-current",
		SourceKind:      FollowUpSourceSuggestion,
		SourceID:        gapSuggestion.ID,
	})
	if !errors.Is(err, ErrInvalidFollowUp) {
		t.Fatalf("expected gap suggestion to reject focused follow-up preparation, got %v", err)
	}
}

func TestBrainContradictionCueCreatesVerifySuggestion(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Supplier Denial"), `{
		"nodes":[{
			"id":"current-node",
			"data":{
				"title":"Current denial",
				"summary":"[ORG:Acme Grid] denies using [ORG:Northgate Cooling]. [CONTRADICTION:supplier denial]",
				"fullText":"[ORG:Acme Grid] denies using [ORG:Northgate Cooling]. [CONTRADICTION:supplier denial]",
				"sourceURL":"https://intel.example.com/current-denial"
			}
		}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Supplier Evidence"), `{
		"nodes":[{
			"id":"old-node",
			"data":{
				"title":"Older supplier evidence",
				"summary":"Prior evidence ties [ORG:Acme Grid] to [ORG:Northgate Cooling]. [CONTRADICTION:supplier denial]",
				"fullText":"Prior evidence ties [ORG:Acme Grid] to [ORG:Northgate Cooling]. [CONTRADICTION:supplier denial]",
				"sourceURL":"https://intel.example.com/archive-supplier"
			}
		}],
		"edges":[]
	}`, "")

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if len(signals) != 1 || !signals[0].HasGateway(GatewayContradiction) {
		t.Fatalf("expected contradiction gateway signal, got %#v", signals)
	}

	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	contradiction := findSuggestion(t, suggestions, SuggestionKindContradictionReview)
	if contradiction.ThinkingGateway != ThinkingGatewayContradiction {
		t.Fatalf("expected contradiction thinking gateway, got %#v", contradiction)
	}
	if contradiction.ActionMode != SuggestionActionVerify {
		t.Fatalf("expected contradiction suggestion to verify instead of launch, got %#v", contradiction)
	}
	if !strings.Contains(strings.ToLower(contradiction.SuggestedAction), "verify") {
		t.Fatalf("expected verify suggested action, got %#v", contradiction)
	}

	_, err = service.PrepareFollowUp(PrepareFollowUpRequest{
		InvestigationID: "inv-current",
		SourceKind:      FollowUpSourceSuggestion,
		SourceID:        contradiction.ID,
	})
	if !errors.Is(err, ErrInvalidFollowUp) {
		t.Fatalf("expected contradiction suggestion to reject focused follow-up preparation, got %v", err)
	}
}

func TestBrainThinkingActionPayloadsAndOutcomesPersist(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Supplier Denial"), `{
		"nodes":[{
			"id":"current-denial-node",
			"data":{
				"title":"Current denial",
				"summary":"[ORG:Acme Grid] denies using [ORG:Northgate Cooling]. [CONTRADICTION:supplier denial]",
				"fullText":"[ORG:Acme Grid] denies using [ORG:Northgate Cooling]. [CONTRADICTION:supplier denial]",
				"sourceURL":"https://intel.example.com/current-denial"
			}
		}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Supplier Evidence"), `{
		"nodes":[{
			"id":"remembered-supplier-node",
			"data":{
				"title":"Older supplier evidence",
				"summary":"Prior evidence ties [ORG:Acme Grid] to [ORG:Northgate Cooling]. [CONTRADICTION:supplier denial]",
				"fullText":"Prior evidence ties [ORG:Acme Grid] to [ORG:Northgate Cooling]. [CONTRADICTION:supplier denial]",
				"sourceURL":"https://intel.example.com/archive-supplier"
			}
		}],
		"edges":[]
	}`, "")

	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	contradiction := findSuggestion(t, suggestions, SuggestionKindContradictionReview)
	if len(contradiction.ReasonSamples) == 0 {
		t.Fatalf("expected contradiction suggestion to include verification reason samples, got %#v", contradiction)
	}
	if !containsString(contradiction.ReasonSamples[0].CurrentNodeIDs, "current-denial-node") {
		t.Fatalf("expected current evidence ids in contradiction reason samples, got %#v", contradiction.ReasonSamples)
	}
	if !containsString(contradiction.ReasonSamples[0].TargetNodeIDs, "remembered-supplier-node") {
		t.Fatalf("expected remembered evidence ids in contradiction reason samples, got %#v", contradiction.ReasonSamples)
	}

	resolved, err := service.MarkSuggestionOutcome(contradiction.ID, SuggestionOutcomeResolved)
	if err != nil {
		t.Fatalf("MarkSuggestionOutcome failed: %v", err)
	}
	if resolved.Status != SuggestionStatusReviewed {
		t.Fatalf("expected resolved thinking action to be reviewed, got %#v", resolved)
	}
	if resolved.ReviewOutcome != SuggestionOutcomeResolved {
		t.Fatalf("expected resolved outcome, got %#v", resolved)
	}
	if strings.TrimSpace(resolved.ReviewedAt) == "" || strings.TrimSpace(resolved.ResolvedAt) == "" {
		t.Fatalf("expected reviewed and resolved timestamps, got %#v", resolved)
	}

	recomputed, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation after outcome failed: %v", err)
	}
	again := findSuggestionByID(t, recomputed, contradiction.ID)
	if again.ReviewOutcome != SuggestionOutcomeResolved || again.ResolvedAt != resolved.ResolvedAt {
		t.Fatalf("expected thinking action outcome to persist across recompute, got %#v", again)
	}
}

func TestBrainGapSuggestionIncludesActionPayload(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}

	gap := findSuggestion(t, suggestions, SuggestionKindGapReview)
	if len(gap.MissingEvidence) == 0 {
		t.Fatalf("expected gap suggestion to name missing evidence needs, got %#v", gap)
	}
	if !containsString(gap.MissingEvidence, SuggestionMissingCorroboration) {
		t.Fatalf("expected gap suggestion to ask for corroboration, got %#v", gap.MissingEvidence)
	}
	if strings.TrimSpace(gap.SearchPrompt) == "" {
		t.Fatalf("expected gap suggestion to include a prepared search prompt, got %#v", gap)
	}
	if !strings.Contains(gap.SearchPrompt, "Current Grid Case") {
		t.Fatalf("expected search prompt to mention the current case, got %q", gap.SearchPrompt)
	}
}

func TestBrainAutonomySettingsPersistDefaultOff(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)

	state, err := service.AutonomyForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AutonomyForInvestigation failed: %v", err)
	}
	if state.Settings.Mode != AutonomyModeOff {
		t.Fatalf("expected autonomy to default off, got %#v", state.Settings)
	}
	if state.Settings.MaxAutoPreparedPerInvestigation != 1 {
		t.Fatalf("expected default per-investigation budget, got %#v", state.Settings)
	}
	if len(state.Queue) != 0 || len(state.Audit) != 0 {
		t.Fatalf("expected default autonomy state to have no queue/audit entries, got %#v", state)
	}

	updated, err := service.UpdateAutonomySettings(BrainAutonomySettings{
		Mode:                            AutonomyModePrepareOnly,
		MaxAutoPreparedPerInvestigation: 1,
		MaxActivePrepared:               2,
	})
	if err != nil {
		t.Fatalf("UpdateAutonomySettings failed: %v", err)
	}
	if updated.Mode != AutonomyModePrepareOnly || updated.MaxActivePrepared != 2 {
		t.Fatalf("expected prepare-only settings to persist, got %#v", updated)
	}

	reloaded, err := service.AutonomyForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AutonomyForInvestigation after settings failed: %v", err)
	}
	if reloaded.Settings.Mode != AutonomyModePrepareOnly || reloaded.Settings.MaxActivePrepared != 2 {
		t.Fatalf("expected reloaded settings, got %#v", reloaded.Settings)
	}
}

func TestBrainAutonomyPrepareOnlyCreatesQueuedFollowUp(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	for index := 0; index < 3; index++ {
		if _, err := service.GenerateSignals("inv-current"); err != nil {
			t.Fatalf("GenerateSignals pass %d failed: %v", index+1, err)
		}
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	initial, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	gap := findSuggestion(t, initial, SuggestionKindGapReview)
	if _, err := service.MarkSuggestionOutcome(gap.ID, SuggestionOutcomeResolved); err != nil {
		t.Fatalf("MarkSuggestionOutcome gap resolved failed: %v", err)
	}
	if _, err := service.UpdateAutonomySettings(BrainAutonomySettings{
		Mode:                            AutonomyModePrepareOnly,
		MaxAutoPreparedPerInvestigation: 1,
		MaxActivePrepared:               3,
	}); err != nil {
		t.Fatalf("UpdateAutonomySettings failed: %v", err)
	}

	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation with autonomy failed: %v", err)
	}
	actions, err := service.FollowUpsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("FollowUpsForInvestigation failed: %v", err)
	}
	if len(actions) != 1 || actions[0].Status != FollowUpStatusPrepared {
		t.Fatalf("expected one auto-prepared follow-up, got %#v", actions)
	}
	preparedSuggestion := findSuggestionByID(t, suggestions, actions[0].SourceID)
	if preparedSuggestion.ActionMode != SuggestionActionLaunchFollowUp {
		t.Fatalf("expected follow-up to use a launch-ready suggestion, got %#v", preparedSuggestion)
	}

	state, err := service.AutonomyForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AutonomyForInvestigation failed: %v", err)
	}
	item := findAutonomyQueueItem(t, state.Queue, preparedSuggestion.ID)
	if item.Decision != AutonomyDecisionPrepared || item.Status != AutonomyQueueStatusPrepared {
		t.Fatalf("expected prepared queue item, got %#v", item)
	}
	if item.ActionID != actions[0].ID {
		t.Fatalf("expected queue item to reference prepared action, got item=%#v action=%#v", item, actions[0])
	}
	if actions[0].Status == FollowUpStatusLaunched {
		t.Fatalf("expected autonomy to require user approval before launch, got %#v", actions[0])
	}
	if !strings.Contains(strings.ToLower(item.Reason), "approve") {
		t.Fatalf("expected prepared autonomy item to explain approval requirement, got %q", item.Reason)
	}
	encoded, err := json.Marshal(item)
	if err != nil {
		t.Fatalf("marshal autonomy item failed: %v", err)
	}
	payload := map[string]any{}
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("unmarshal autonomy item payload failed: %v", err)
	}
	if payload["approvalRequired"] != true {
		t.Fatalf("expected autonomy queue payload to require approval, got %#v", payload)
	}
	preparedAuditFound := false
	for _, entry := range state.Audit {
		if entry.SuggestionID == preparedSuggestion.ID && entry.Decision == AutonomyDecisionPrepared {
			preparedAuditFound = true
			break
		}
	}
	if !preparedAuditFound {
		t.Fatalf("expected prepared audit entry for %s, got %#v", preparedSuggestion.ID, state.Audit)
	}
	// Stream provenance: the queue item and the audit entry must record which
	// live signals and gateway drove the decision.
	if len(item.SourceSignalIds) == 0 {
		t.Fatalf("expected prepared queue item to carry stream provenance, got %#v", item)
	}
	if !containsString(item.SourceSignalIds, preparedSuggestion.RelatedSignalIDs[0]) {
		t.Fatalf("expected queue provenance to match the suggestion signals, got item=%#v suggestion=%#v", item.SourceSignalIds, preparedSuggestion.RelatedSignalIDs)
	}
	if item.Gateway != strings.TrimSpace(preparedSuggestion.ThinkingGateway) || item.GatewayLabel != strings.TrimSpace(preparedSuggestion.ThinkingLabel) {
		t.Fatalf("expected queue item to carry the routing gateway, got item=%#v suggestion=%#v", item, preparedSuggestion)
	}
	if len(state.Audit[0].SourceSignalIds) == 0 {
		t.Fatalf("expected audit entry to carry stream provenance, got %#v", state.Audit[0])
	}
}

func TestBrainAutonomyRequiresHighConfidencePossibleBridge(t *testing.T) {
	lowConfidenceBridge := BrainSuggestion{
		ID:                     "brain-suggestion-bridge-low",
		InvestigationID:        "inv-current",
		Status:                 SuggestionStatusActive,
		Title:                  "Compare possible bridge",
		Summary:                "A possible bridge exists but confidence is not high yet.",
		Score:                  0.82,
		Relevance:              RelevancePossibleBridge,
		ActionMode:             SuggestionActionLaunchFollowUp,
		TargetInvestigationIDs: []string{"inv-older"},
	}
	if candidates := launchReadyAutonomySuggestions([]BrainSuggestion{lowConfidenceBridge}); len(candidates) != 0 {
		t.Fatalf("expected low-confidence possible bridge to be withheld, got %#v", candidates)
	}

	highConfidenceBridge := lowConfidenceBridge
	highConfidenceBridge.ID = "brain-suggestion-bridge-high"
	highConfidenceBridge.Score = 0.88
	candidates := launchReadyAutonomySuggestions([]BrainSuggestion{highConfidenceBridge})
	if len(candidates) != 1 || candidates[0].ID != highConfidenceBridge.ID {
		t.Fatalf("expected high-confidence possible bridge to pass, got %#v", candidates)
	}

	strongMemory := lowConfidenceBridge
	strongMemory.ID = "brain-suggestion-strong"
	strongMemory.Score = 0.80
	strongMemory.Relevance = RelevanceStrongMemory
	candidates = launchReadyAutonomySuggestions([]BrainSuggestion{strongMemory})
	if len(candidates) != 1 || candidates[0].ID != strongMemory.ID {
		t.Fatalf("expected strong memory at controlled threshold to pass, got %#v", candidates)
	}
}

func TestBrainAutonomyLimitedBackgroundQueuesWithoutPreparing(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	for index := 0; index < 3; index++ {
		if _, err := service.GenerateSignals("inv-current"); err != nil {
			t.Fatalf("GenerateSignals pass %d failed: %v", index+1, err)
		}
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	initial, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	gap := findSuggestion(t, initial, SuggestionKindGapReview)
	if _, err := service.MarkSuggestionOutcome(gap.ID, SuggestionOutcomeResolved); err != nil {
		t.Fatalf("MarkSuggestionOutcome gap resolved failed: %v", err)
	}
	if _, err := service.UpdateAutonomySettings(BrainAutonomySettings{
		Mode:                            AutonomyModeLimitedBackground,
		MaxAutoPreparedPerInvestigation: 1,
		MaxActivePrepared:               3,
	}); err != nil {
		t.Fatalf("UpdateAutonomySettings failed: %v", err)
	}

	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation with limited-background autonomy failed: %v", err)
	}
	if len(suggestions) == 0 {
		t.Fatalf("expected suggestions with limited-background autonomy, got %#v", suggestions)
	}

	actions, err := service.FollowUpsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("FollowUpsForInvestigation failed: %v", err)
	}
	if len(actions) != 0 {
		t.Fatalf("expected limited-background to avoid preparing V16 follow-ups, got %#v", actions)
	}

	state, err := service.AutonomyForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AutonomyForInvestigation failed: %v", err)
	}
	if len(state.Queue) == 0 {
		t.Fatalf("expected limited-background to queue would-prepare decisions, got none")
	}
	for _, item := range state.Queue {
		if item.Decision != AutonomyDecisionWouldPrepare || item.Status != AutonomyQueueStatusWaiting {
			t.Fatalf("expected every launch-ready candidate to queue a would-prepare decision, got %#v", item)
		}
	}
}

func TestBrainAutonomyBlocksUnresolvedGapSuggestions(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	for index := 0; index < 3; index++ {
		if _, err := service.GenerateSignals("inv-current"); err != nil {
			t.Fatalf("GenerateSignals pass %d failed: %v", index+1, err)
		}
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	if _, err := service.UpdateAutonomySettings(BrainAutonomySettings{
		Mode:                            AutonomyModePrepareOnly,
		MaxAutoPreparedPerInvestigation: 1,
		MaxActivePrepared:               3,
	}); err != nil {
		t.Fatalf("UpdateAutonomySettings failed: %v", err)
	}

	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation with blocker failed: %v", err)
	}
	if len(suggestions) == 0 {
		t.Fatalf("expected suggestions with blocker, got %#v", suggestions)
	}

	actions, err := service.FollowUpsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("FollowUpsForInvestigation failed: %v", err)
	}
	if len(actions) != 0 {
		t.Fatalf("expected unresolved gap to block auto-prepare, got %#v", actions)
	}

	state, err := service.AutonomyForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AutonomyForInvestigation failed: %v", err)
	}
	if len(state.Queue) == 0 {
		t.Fatalf("expected blocked autonomy queue items for every launch-ready candidate, got none")
	}
	for _, item := range state.Queue {
		if item.Decision != AutonomyDecisionBlocked || !containsString(item.Blockers, AutonomyBlockerUnresolvedGap) {
			t.Fatalf("expected every candidate to be blocked by unresolved-gap under multi-candidate evaluation, got %#v", item)
		}
		queuedSuggestion := findSuggestionByID(t, suggestions, item.SuggestionID)
		if queuedSuggestion.ActionMode != SuggestionActionLaunchFollowUp {
			t.Fatalf("expected blocked queue item to point at a launch-ready suggestion, got %#v", queuedSuggestion)
		}
	}
}

func TestBrainAutonomyStillBlocksReviewedGapWithoutOutcome(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	for index := 0; index < 3; index++ {
		if _, err := service.GenerateSignals("inv-current"); err != nil {
			t.Fatalf("GenerateSignals pass %d failed: %v", index+1, err)
		}
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	if _, err := service.UpdateAutonomySettings(BrainAutonomySettings{
		Mode:                            AutonomyModePrepareOnly,
		MaxAutoPreparedPerInvestigation: 1,
		MaxActivePrepared:               3,
	}); err != nil {
		t.Fatalf("UpdateAutonomySettings failed: %v", err)
	}

	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation with blocker failed: %v", err)
	}
	gap := findSuggestion(t, suggestions, SuggestionKindGapReview)
	if gap.ActionMode != SuggestionActionFillGap {
		t.Fatalf("expected fill-gap suggestion, got %#v", gap)
	}
	if _, err := service.MarkSuggestionReviewed(gap.ID); err != nil {
		t.Fatalf("MarkSuggestionReviewed gap failed: %v", err)
	}
	if _, err := service.SuggestionsForInvestigation("inv-current"); err != nil {
		t.Fatalf("SuggestionsForInvestigation after reviewed gap failed: %v", err)
	}

	actions, err := service.FollowUpsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("FollowUpsForInvestigation failed: %v", err)
	}
	if len(actions) != 0 {
		t.Fatalf("expected reviewed gap without outcome to block auto-prepare, got %#v", actions)
	}
	state, err := service.AutonomyForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AutonomyForInvestigation failed: %v", err)
	}
	if len(state.Queue) == 0 {
		t.Fatalf("expected blocked autonomy queue items after reviewed gap, got none")
	}
	for _, item := range state.Queue {
		if item.Decision != AutonomyDecisionBlocked || !containsString(item.Blockers, AutonomyBlockerUnresolvedGap) {
			t.Fatalf("expected unresolved-gap blocker after reviewed gap, got %#v", item)
		}
	}
}

func TestBrainAutonomyPreflightAutoClassifiesGapBlockers(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	for index := 0; index < 3; index++ {
		if _, err := service.GenerateSignals("inv-current"); err != nil {
			t.Fatalf("GenerateSignals pass %d failed: %v", index+1, err)
		}
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	if _, err := service.UpdateAutonomySettings(BrainAutonomySettings{
		Mode:                            AutonomyModePrepareOnly,
		MaxAutoPreparedPerInvestigation: 1,
		MaxActivePrepared:               3,
	}); err != nil {
		t.Fatalf("UpdateAutonomySettings failed: %v", err)
	}

	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	gap := findSuggestion(t, suggestions, SuggestionKindGapReview)
	if gap.Status != SuggestionStatusReviewed {
		t.Fatalf("expected autonomy preflight to review gap blocker, got %#v", gap)
	}
	if gap.ReviewOutcome != SuggestionOutcomeNeedsRelation {
		t.Fatalf("expected autonomy preflight to mark the specific relationship gap before generic corroboration, got %#v", gap)
	}
	if gap.ReviewSource != SuggestionReviewSourceAutonomyPreflight {
		t.Fatalf("expected autonomy preflight review source, got %#v", gap)
	}
	if strings.TrimSpace(gap.ReviewedAt) == "" {
		t.Fatalf("expected reviewed timestamp from autonomy preflight, got %#v", gap)
	}
}

func TestBrainAutonomyPreflightAutoClassifiesContradictionBlockers(t *testing.T) {
	contradiction, ok := autonomyPreflightBlockerSuggestion(BrainSuggestion{
		ID:         "brain-suggestion-contradiction",
		Status:     SuggestionStatusActive,
		ActionMode: SuggestionActionVerify,
		ReasonSamples: []SignalReason{{
			Gateway:        GatewayContradiction,
			Value:          "supplier denial",
			Label:          "supplier denial",
			Detail:         "Contradiction cue appears in both investigations.",
			CurrentNodeIDs: []string{"current-denial-node"},
			TargetNodeIDs:  []string{"remembered-supplier-node"},
		}},
	}, "2026-06-17T12:00:00Z")
	if !ok {
		t.Fatalf("expected autonomy preflight to classify contradiction blocker")
	}
	if contradiction.Status != SuggestionStatusReviewed {
		t.Fatalf("expected autonomy preflight to review contradiction blocker, got %#v", contradiction)
	}
	if contradiction.ReviewOutcome != SuggestionOutcomeVerifiedConflict {
		t.Fatalf("expected autonomy preflight to verify conflict, got %#v", contradiction)
	}
	if contradiction.ReviewSource != SuggestionReviewSourceAutonomyPreflight {
		t.Fatalf("expected autonomy preflight review source, got %#v", contradiction)
	}
	if strings.TrimSpace(contradiction.ReviewedAt) == "" {
		t.Fatalf("expected reviewed timestamp from autonomy preflight, got %#v", contradiction)
	}

	needsSource, ok := autonomyPreflightBlockerSuggestion(BrainSuggestion{
		ID:                     "brain-suggestion-contradiction-missing-evidence",
		InvestigationID:        "inv-current",
		Status:                 SuggestionStatusActive,
		Title:                  "Verify possible contradiction",
		Summary:                "Supplier denial may conflict with remembered evidence.",
		SuggestedAction:        "Verify conflicting claim",
		ActionMode:             SuggestionActionVerify,
		Reason:                 "Supplier denial may conflict with remembered evidence and needs verification.",
		TargetInvestigationIDs: []string{"inv-old"},
	}, "2026-06-17T12:00:00Z")
	if !ok {
		t.Fatalf("expected autonomy preflight to classify missing-evidence contradiction blocker")
	}
	if needsSource.ReviewOutcome != SuggestionOutcomeNeedsSource {
		t.Fatalf("expected missing-evidence contradiction to need source, got %#v", needsSource)
	}
	if !containsString(needsSource.MissingEvidence, SuggestionMissingSource) {
		t.Fatalf("expected missing-evidence contradiction to carry source checklist, got %#v", needsSource)
	}
	if strings.TrimSpace(needsSource.SearchPrompt) == "" {
		t.Fatalf("expected missing-evidence contradiction to prepare a source prompt, got %#v", needsSource)
	}
	if !strings.Contains(needsSource.SearchPrompt, "Find source evidence") {
		t.Fatalf("expected source prompt to direct evidence search, got %q", needsSource.SearchPrompt)
	}
	if needsSource.SuggestedAction != "Find source evidence" {
		t.Fatalf("expected suggested action to become source evidence work, got %#v", needsSource)
	}
}

func TestBrainAutonomyPreflightPrioritizesSpecificMissingEvidence(t *testing.T) {
	sourceGap, ok := autonomyPreflightBlockerSuggestion(BrainSuggestion{
		ID:                     "brain-suggestion-gap-needs-source",
		InvestigationID:        "inv-current",
		Status:                 SuggestionStatusActive,
		Title:                  "Decide whether this firing becomes memory",
		Summary:                "Active firings have not become durable memory links yet.",
		SuggestedAction:        "Review before promoting memory",
		ActionMode:             SuggestionActionFillGap,
		Reason:                 "Active firings need bridge evidence before they become durable memory.",
		MissingEvidence:        []string{SuggestionMissingCorroboration, SuggestionMissingSource},
		TargetInvestigationIDs: []string{"inv-old"},
	}, "2026-06-17T12:00:00Z")
	if !ok {
		t.Fatalf("expected autonomy preflight to classify gap blocker")
	}
	if sourceGap.ReviewOutcome != SuggestionOutcomeNeedsSource {
		t.Fatalf("expected source gap to need source before corroboration, got %#v", sourceGap)
	}
	if !containsString(sourceGap.MissingEvidence, SuggestionMissingSource) {
		t.Fatalf("expected source gap to keep source checklist, got %#v", sourceGap)
	}
	if strings.TrimSpace(sourceGap.SearchPrompt) == "" {
		t.Fatalf("expected source gap to prepare a source prompt, got %#v", sourceGap)
	}
}

type recordingSourceEvidenceFinder struct {
	calls    int
	evidence []BrainSuggestionSourceEvidence
}

func (f *recordingSourceEvidenceFinder) FindSourceEvidence(context.Context, SourceEvidenceLookupRequest) ([]BrainSuggestionSourceEvidence, error) {
	f.calls++
	return f.evidence, nil
}

func TestAutoResolveSkipsResolvedSuggestions(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	finder := &recordingSourceEvidenceFinder{evidence: []BrainSuggestionSourceEvidence{{
		SourceURL: "https://sources.example.com/acme-grid",
	}}}
	service.SetSourceEvidenceFinder(finder)

	// A resolved review whose recomputed missing list still mentions source
	// must NOT re-trigger the evidence lookup (the Leg 0 storm).
	resolved := BrainSuggestion{
		ID:              "brain-suggestion-verify-source",
		InvestigationID: "inv-current",
		Status:          SuggestionStatusReviewed,
		ActionMode:      SuggestionActionVerify,
		Title:           "Verify conflicting claim",
		ReviewOutcome:   SuggestionOutcomeResolved,
		MissingEvidence: []string{SuggestionMissingSource},
		ReasonSamples: []SignalReason{{
			Gateway:        GatewayEntityDate,
			Value:          "ORG|Acme Grid",
			Label:          "Acme Grid",
			CurrentNodeIDs: []string{"current-node"},
		}},
		TargetInvestigationIDs: []string{"inv-old-strong"},
	}
	_, changed, err := service.autoResolveSuggestionSourceEvidence(resolved, "2026-06-17T12:00:00Z")
	if err != nil {
		t.Fatalf("autoResolveSuggestionSourceEvidence failed: %v", err)
	}
	if changed {
		t.Fatalf("expected a resolved suggestion to stay untouched")
	}
	if finder.calls != 0 {
		t.Fatalf("expected no lookup for a resolved suggestion, got %d", finder.calls)
	}
}

func TestAutoResolveCooldownSkipsRepeatLookups(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	finder := &recordingSourceEvidenceFinder{evidence: []BrainSuggestionSourceEvidence{{
		SourceURL: "https://sources.example.com/acme-grid",
	}}}
	service.SetSourceEvidenceFinder(finder)
	// Synchronous dispatch so the out-of-band lookup completes inside the
	// test and its effects are assertable.
	service.sourceLookupDispatcher = func(work func()) { work() }

	needsSource := func(lastLookup string) BrainSuggestion {
		return BrainSuggestion{
			ID:                 "brain-suggestion-verify-source",
			InvestigationID:    "inv-current",
			Status:             SuggestionStatusReviewed,
			ActionMode:         SuggestionActionVerify,
			Title:              "Verify conflicting claim",
			ReviewOutcome:      SuggestionOutcomeNeedsSource,
			LastSourceLookupAt: lastLookup,
			// ReasonSamples reference nodes that do not exist in the board:
			// no saved evidence, so the web finder path (and its cooldown)
			// is what gets exercised.
			ReasonSamples: []SignalReason{{
				Gateway:        GatewayEntityDate,
				Value:          "ORG|Acme Grid",
				Label:          "Acme Grid",
				CurrentNodeIDs: []string{"ghost-node"},
			}},
			TargetInvestigationIDs: []string{"inv-old-strong"},
		}
	}

	// A lookup attempted 5 minutes ago is inside the cooldown: skipped.
	_, changed, err := service.autoResolveSuggestionSourceEvidence(needsSource("2026-06-17T11:55:00Z"), "2026-06-17T12:00:00Z")
	if err != nil {
		t.Fatalf("autoResolve inside cooldown failed: %v", err)
	}
	if changed {
		t.Fatalf("expected the cooldown to skip the lookup")
	}
	if finder.calls != 0 {
		t.Fatalf("expected no lookup inside the cooldown, got %d", finder.calls)
	}

	// After the cooldown the lookup is dispatched out-of-band.
	persisted := needsSource("2026-06-17T10:00:00Z")
	if err := service.saveSuggestions(map[string]BrainSuggestion{persisted.ID: persisted}); err != nil {
		t.Fatalf("saveSuggestions failed: %v", err)
	}
	after, changed, err := service.autoResolveSuggestionSourceEvidence(persisted, "2026-06-17T12:00:00Z")
	if err != nil {
		t.Fatalf("autoResolve after cooldown failed: %v", err)
	}
	if !changed {
		t.Fatalf("expected the post-cooldown lookup to be dispatched")
	}
	if finder.calls != 1 {
		t.Fatalf("expected exactly one lookup after the cooldown, got %d", finder.calls)
	}
	if after.LastSourceLookupAt != "2026-06-17T12:00:00Z" {
		t.Fatalf("expected the lookup attempt marker to persist, got %q", after.LastSourceLookupAt)
	}

	// The out-of-band result applied: the suggestion resolved with the
	// found source attached.
	resolvedSuggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	resolved := findSuggestionByID(t, resolvedSuggestions, "brain-suggestion-verify-source")
	if resolved.ReviewOutcome != SuggestionOutcomeResolved || resolved.ReviewSource != SuggestionReviewSourceSourceEvidence {
		t.Fatalf("expected the async lookup to resolve the suggestion, got %#v", resolved)
	}
	if len(resolved.SourceEvidence) != 1 || resolved.SourceEvidence[0].SourceURL != "https://sources.example.com/acme-grid" {
		t.Fatalf("expected the found source attached, got %#v", resolved.SourceEvidence)
	}
}

func TestAutoResolveDispatchesLookupOutOfBand(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	finder := &recordingSourceEvidenceFinder{evidence: []BrainSuggestionSourceEvidence{{
		SourceURL: "https://sources.example.com/verification",
	}}}
	service.SetSourceEvidenceFinder(finder)
	var inlineRuns int
	service.sourceLookupDispatcher = func(work func()) {
		inlineRuns++
		work()
	}

	needsSource := BrainSuggestion{
		ID:              "brain-suggestion-verify-source",
		InvestigationID: "inv-current",
		Status:          SuggestionStatusReviewed,
		ActionMode:      SuggestionActionVerify,
		Title:           "Verify conflicting claim",
		ReviewOutcome:   SuggestionOutcomeNeedsSource,
		// ReasonSamples reference nodes that do not exist in the board, so
		// no saved evidence exists and the out-of-band finder runs.
		ReasonSamples: []SignalReason{{
			Gateway:        GatewayEntityDate,
			Value:          "ORG|Acme Grid",
			Label:          "Acme Grid",
			CurrentNodeIDs: []string{"ghost-node"},
		}},
		TargetInvestigationIDs: []string{"inv-old-strong"},
	}
	// The suggestion must be persisted: the out-of-band lookup applies its
	// result against the saved suggestions, exactly like production.
	if err := service.saveSuggestions(map[string]BrainSuggestion{needsSource.ID: needsSource}); err != nil {
		t.Fatalf("saveSuggestions failed: %v", err)
	}

	_, changed, err := service.autoResolveSuggestionSourceEvidence(needsSource, "2026-06-17T12:00:00Z")
	if err != nil {
		t.Fatalf("autoResolveSuggestionSourceEvidence failed: %v", err)
	}
	if !changed {
		t.Fatalf("expected the dispatch to record the attempt marker")
	}
	if inlineRuns != 1 || finder.calls != 1 {
		t.Fatalf("expected exactly one dispatched lookup, got runs=%d calls=%d", inlineRuns, finder.calls)
	}

	// The dispatched lookup applied its result: the suggestion resolved with
	// the found source attached.
	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	resolved := findSuggestionByID(t, suggestions, "brain-suggestion-verify-source")
	if resolved.ReviewOutcome != SuggestionOutcomeResolved || len(resolved.SourceEvidence) != 1 {
		t.Fatalf("expected the async lookup to resolve the suggestion, got %#v", resolved)
	}
	if resolved.SourceEvidence[0].SourceURL != "https://sources.example.com/verification" {
		t.Fatalf("expected the found source URL attached, got %#v", resolved.SourceEvidence)
	}
}

func TestSavedSourceEvidenceForNodesScansBoardSources(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)

	evidence, err := service.savedSourceEvidenceForNodes("brain-suggestion-1", "inv-current", []string{"current-node"}, "2026-06-17T12:00:00Z")
	if err != nil {
		t.Fatalf("savedSourceEvidenceForNodes failed: %v", err)
	}
	if len(evidence) != 1 {
		t.Fatalf("expected one saved source evidence, got %#v", evidence)
	}
	if evidence[0].SourceURL != "https://intel.example.com/current" {
		t.Fatalf("expected the board node source URL, got %#v", evidence[0])
	}
	if evidence[0].EvidenceID != "current-node" {
		t.Fatalf("expected evidence to reference the board node, got %#v", evidence[0])
	}

	unknown, err := service.savedSourceEvidenceForNodes("brain-suggestion-1", "inv-current", []string{"missing-node"}, "2026-06-17T12:00:00Z")
	if err != nil {
		t.Fatalf("savedSourceEvidenceForNodes for unknown node failed: %v", err)
	}
	if len(unknown) != 0 {
		t.Fatalf("expected no evidence for unknown nodes, got %#v", unknown)
	}
}

func TestAddSuggestionSourceEvidenceResolvesNeedsSource(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	target := suggestions[0]
	if _, err := service.MarkSuggestionOutcome(target.ID, SuggestionOutcomeNeedsSource); err != nil {
		t.Fatalf("MarkSuggestionOutcome needs-source failed: %v", err)
	}

	if _, err := service.AddSuggestionSourceEvidence(target.ID, SuggestionSourceEvidenceRequest{SourceURL: "notaurl"}); !errors.Is(err, ErrInvalidSourceEvidence) {
		t.Fatalf("expected invalid source URL to be rejected, got err=%v", err)
	}

	updated, err := service.AddSuggestionSourceEvidence(target.ID, SuggestionSourceEvidenceRequest{
		SourceURL:  "https://sources.example.com/acme-grid",
		EvidenceID: "web-source",
		Note:       "Auto-found online by Brain source lookup.",
	})
	if err != nil {
		t.Fatalf("AddSuggestionSourceEvidence failed: %v", err)
	}
	if updated.ReviewOutcome != SuggestionOutcomeResolved || updated.ReviewSource != SuggestionReviewSourceSourceEvidence {
		t.Fatalf("expected evidence to resolve the needs-source review, got %#v", updated)
	}
	if len(updated.SourceEvidence) != 1 || updated.SourceEvidence[0].SourceURL != "https://sources.example.com/acme-grid" {
		t.Fatalf("expected attached source evidence, got %#v", updated.SourceEvidence)
	}
	if containsString(updated.MissingEvidence, SuggestionMissingSource) {
		t.Fatalf("expected missing source to be cleared, got %#v", updated.MissingEvidence)
	}
}

func TestHandleAPIRoutesSuggestionSourceEvidence(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	target := suggestions[0]
	if _, err := service.MarkSuggestionOutcome(target.ID, SuggestionOutcomeNeedsSource); err != nil {
		t.Fatalf("MarkSuggestionOutcome needs-source failed: %v", err)
	}

	invalidRequest := httptest.NewRequest(http.MethodPut, "/api/brain/suggestions/"+target.ID+"/source-evidence", strings.NewReader(`{"sourceUrl":"notaurl"}`))
	invalidRecorder := httptest.NewRecorder()
	HandleAPI(invalidRecorder, invalidRequest, service)
	if invalidRecorder.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid source URL to 400, got %d body=%s", invalidRecorder.Code, invalidRecorder.Body.String())
	}

	validRequest := httptest.NewRequest(http.MethodPut, "/api/brain/suggestions/"+target.ID+"/source-evidence", strings.NewReader(`{"sourceUrl":"https://sources.example.com/acme-grid","note":"Found online."}`))
	validRecorder := httptest.NewRecorder()
	HandleAPI(validRecorder, validRequest, service)
	if validRecorder.Code != http.StatusOK {
		t.Fatalf("expected source evidence PUT 200, got %d body=%s", validRecorder.Code, validRecorder.Body.String())
	}
	var updated BrainSuggestion
	if err := json.Unmarshal(validRecorder.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode updated suggestion failed: %v", err)
	}
	if updated.ReviewOutcome != SuggestionOutcomeResolved || len(updated.SourceEvidence) != 1 {
		t.Fatalf("expected resolved suggestion with attached evidence, got %#v", updated)
	}
}

func TestAutoResolveSuggestionSourceEvidenceUsesSavedBoardEvidence(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)

	// A verify suggestion whose reason references the fixture board node: the
	// saved-evidence scan should attach that node's source URL and resolve.
	suggestion := BrainSuggestion{
		ID:              "brain-suggestion-verify-source",
		InvestigationID: "inv-current",
		Status:          SuggestionStatusActive,
		ActionMode:      SuggestionActionVerify,
		Title:           "Verify possible contradiction",
		ReviewOutcome:   SuggestionOutcomeNeedsSource,
		ReasonSamples: []SignalReason{{
			Gateway:        GatewayEntityDate,
			Value:          "ORG|Acme Grid",
			Label:          "Acme Grid",
			CurrentNodeIDs: []string{"current-node"},
		}},
		TargetInvestigationIDs: []string{"inv-old-strong"},
	}
	resolved, changed, err := service.autoResolveSuggestionSourceEvidence(suggestion, "2026-06-17T12:00:00Z")
	if err != nil {
		t.Fatalf("autoResolveSuggestionSourceEvidence failed: %v", err)
	}
	if !changed {
		t.Fatalf("expected saved board evidence to auto-resolve the suggestion, got %#v", resolved)
	}
	if resolved.ReviewOutcome != SuggestionOutcomeResolved || resolved.ReviewSource != SuggestionReviewSourceSourceEvidence {
		t.Fatalf("expected resolved-by-evidence review, got %#v", resolved)
	}
	if len(resolved.SourceEvidence) == 0 || resolved.SourceEvidence[0].SourceURL != "https://intel.example.com/current" {
		t.Fatalf("expected the board node source URL attached, got %#v", resolved.SourceEvidence)
	}
	if containsString(resolved.MissingEvidence, SuggestionMissingSource) {
		t.Fatalf("expected missing source cleared, got %#v", resolved.MissingEvidence)
	}
}

type stubEmptySourceEvidenceFinder struct{}

func (stubEmptySourceEvidenceFinder) FindSourceEvidence(context.Context, SourceEvidenceLookupRequest) ([]BrainSuggestionSourceEvidence, error) {
	return nil, nil
}

func TestAddSuggestionSourceEvidenceUnblocksAutonomyQueue(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	// An empty finder: the only source evidence available is what the
	// operator attaches by hand.
	service.SetSourceEvidenceFinder(stubEmptySourceEvidenceFinder{})

	candidate := BrainSuggestion{
		ID:                     "brain-suggestion-launch",
		InvestigationID:        "inv-current",
		Status:                 SuggestionStatusActive,
		Kind:                   "cluster-review",
		Title:                  "Review durable memory link",
		ActionMode:             SuggestionActionLaunchFollowUp,
		Relevance:              RelevanceStrongMemory,
		Score:                  0.9,
		TargetInvestigationIDs: []string{"inv-old-strong"},
	}
	blocker := BrainSuggestion{
		ID:                     "brain-suggestion-verify",
		InvestigationID:        "inv-current",
		Status:                 SuggestionStatusReviewed,
		ActionMode:             SuggestionActionVerify,
		Title:                  "Verify conflicting claim",
		ReviewOutcome:          SuggestionOutcomeNeedsSource,
		TargetInvestigationIDs: []string{"inv-old-strong"},
	}
	if err := service.saveSuggestions(map[string]BrainSuggestion{
		candidate.ID: candidate,
		blocker.ID:   blocker,
	}); err != nil {
		t.Fatalf("saveSuggestions failed: %v", err)
	}

	if _, err := service.UpdateAutonomySettings(BrainAutonomySettings{
		Mode:                            AutonomyModePrepareOnly,
		MaxAutoPreparedPerInvestigation: 1,
		MaxActivePrepared:               3,
	}); err != nil {
		t.Fatalf("UpdateAutonomySettings failed: %v", err)
	}

	// The unresolved needs-source review keeps the launch-ready candidate
	// blocked: no saved evidence exists and the finder returns nothing.
	state, err := service.AutonomyForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AutonomyForInvestigation before attach failed: %v", err)
	}
	blockedItem := findAutonomyQueueItem(t, state.Queue, candidate.ID)
	if blockedItem.Decision != AutonomyDecisionBlocked || !containsString(blockedItem.Blockers, AutonomyBlockerUnresolvedContradiction) {
		t.Fatalf("expected the candidate blocked by the unresolved review, got %#v", blockedItem)
	}

	// Attaching source evidence resolves the review and re-evaluates the
	// queue immediately, so the candidate gets prepared.
	if _, err := service.AddSuggestionSourceEvidence(blocker.ID, SuggestionSourceEvidenceRequest{
		SourceURL: "https://sources.example.com/verification",
		Note:      "Found by operator.",
	}); err != nil {
		t.Fatalf("AddSuggestionSourceEvidence failed: %v", err)
	}

	state, err = service.AutonomyForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AutonomyForInvestigation after attach failed: %v", err)
	}
	preparedItem := findAutonomyQueueItem(t, state.Queue, candidate.ID)
	if preparedItem.Decision != AutonomyDecisionPrepared || preparedItem.Status != AutonomyQueueStatusPrepared {
		t.Fatalf("expected the candidate prepared after evidence attached, got %#v", preparedItem)
	}
}

func TestClusterSuggestionsDownrankNoisyBroadClusters(t *testing.T) {
	timestamp := "2026-06-08T10:00:00Z"
	clusters := []MemoryCluster{
		{
			ID:                     "cluster-date",
			Label:                  "2026-02-28",
			Summary:                "2026-02-28 links 7 investigations through entity/date recall.",
			Score:                  0.98,
			Status:                 "active",
			DominantGateway:        GatewayEntityDate,
			MemberInvestigationIDs: testClusterMemberIDs(7),
			SignalIDs:              []string{"sig-1", "sig-2", "sig-3", "sig-4", "sig-5", "sig-6", "sig-7", "sig-8"},
			MemoryLinkIDs:          []string{"link-1", "link-2", "link-3", "link-4", "link-5", "link-6", "link-7"},
			ReasonSamples: []SignalReason{{
				Gateway: GatewayEntityDate,
				Value:   "DATE|2026-02-28",
				Label:   "2026-02-28",
			}},
		},
		{
			ID:                     "cluster-broad-person",
			Label:                  "Donald Trump",
			Summary:                "Donald Trump links 27 investigations through entity/date recall.",
			Score:                  0.98,
			Status:                 "active",
			DominantGateway:        GatewayEntityDate,
			MemberInvestigationIDs: testClusterMemberIDs(27),
			SignalIDs:              []string{"sig-9", "sig-10", "sig-11"},
			MemoryLinkIDs:          []string{"link-8"},
			ReasonSamples: []SignalReason{{
				Gateway: GatewayEntityDate,
				Value:   "PERSON|donald trump",
				Label:   "Donald Trump",
			}},
		},
		{
			ID:                     "cluster-focused-org",
			Label:                  "AI data centers",
			Summary:                "AI data centers links 5 investigations through entity/date recall.",
			Score:                  0.82,
			Status:                 "active",
			DominantGateway:        GatewayEntityDate,
			MemberInvestigationIDs: testClusterMemberIDs(5),
			SignalIDs:              []string{"sig-12", "sig-13"},
			MemoryLinkIDs:          []string{"link-9"},
			ReasonSamples: []SignalReason{{
				Gateway: GatewayEntityDate,
				Value:   "ORG|ai data centers",
				Label:   "AI data centers",
			}},
		},
	}

	suggestions := clusterReviewSuggestions("inv-current", clusters, map[string]BrainSuggestion{}, timestamp)

	dateSuggestion := findSuggestionByClusterID(t, suggestions, "cluster-date")
	if dateSuggestion.Priority == "high" || dateSuggestion.Score >= 0.78 {
		t.Fatalf("expected pure date cluster to be down-ranked, got %#v", dateSuggestion)
	}
	if dateSuggestion.Relevance != RelevanceDistantEcho {
		t.Fatalf("expected pure date cluster to remain as distant echo, got %#v", dateSuggestion)
	}
	broadPersonSuggestion := findSuggestionByClusterID(t, suggestions, "cluster-broad-person")
	if broadPersonSuggestion.Priority == "high" || broadPersonSuggestion.Score >= 0.78 {
		t.Fatalf("expected broad person cluster to be down-ranked, got %#v", broadPersonSuggestion)
	}
	if broadPersonSuggestion.Relevance != RelevanceBackgroundNoise {
		t.Fatalf("expected very broad person cluster to be background noise, got %#v", broadPersonSuggestion)
	}
	focusedSuggestion := findSuggestionByClusterID(t, suggestions, "cluster-focused-org")
	if focusedSuggestion.Priority != "high" || focusedSuggestion.Score < 0.78 {
		t.Fatalf("expected focused entity cluster to stay high priority, got %#v", focusedSuggestion)
	}
	if focusedSuggestion.Relevance != RelevanceStrongMemory {
		t.Fatalf("expected focused entity cluster to be strong memory, got %#v", focusedSuggestion)
	}
}

func TestClusterReviewSuggestionsUseSpecificTitles(t *testing.T) {
	timestamp := "2026-06-08T10:00:00Z"
	clusters := []MemoryCluster{
		{
			ID:                     "cluster-timeline",
			Label:                  "2026-02-28",
			Summary:                "2026-02-28 links repeated recall.",
			Score:                  0.82,
			Status:                 "active",
			DominantGateway:        GatewayEntityDate,
			MemberInvestigationIDs: testClusterMemberIDs(3),
			ReasonSamples: []SignalReason{{
				Gateway: GatewayEntityDate,
				Value:   "DATE|2026-02-28",
				Label:   "2026-02-28",
			}},
		},
		{
			ID:                     "cluster-source",
			Label:                  "intel.example.com",
			Summary:                "intel.example.com links repeated recall.",
			Score:                  0.82,
			Status:                 "active",
			DominantGateway:        GatewaySourceDomain,
			MemberInvestigationIDs: testClusterMemberIDs(3),
		},
		{
			ID:                     "cluster-relationship",
			Label:                  "POWER_RISK",
			Summary:                "POWER_RISK links repeated recall.",
			Score:                  0.82,
			Status:                 "active",
			DominantGateway:        GatewayRelationshipTag,
			MemberInvestigationIDs: testClusterMemberIDs(3),
		},
		{
			ID:                     "cluster-entity",
			Label:                  "AI data centers",
			Summary:                "AI data centers links repeated recall.",
			Score:                  0.82,
			Status:                 "active",
			DominantGateway:        GatewayEntityDate,
			MemberInvestigationIDs: testClusterMemberIDs(3),
		},
	}

	suggestions := clusterReviewSuggestions("inv-current", clusters, map[string]BrainSuggestion{}, timestamp)

	expectedTitles := map[string]string{
		"cluster-timeline":     "Review 2026-02-28 timeline cluster",
		"cluster-source":       "Compare intel.example.com source cluster",
		"cluster-relationship": "Inspect POWER_RISK relationship cluster",
		"cluster-entity":       "Review AI data centers memory cluster",
	}
	for clusterID, expected := range expectedTitles {
		suggestion := findSuggestionByClusterID(t, suggestions, clusterID)
		if suggestion.Title != expected {
			t.Fatalf("expected title %q for %s, got %#v", expected, clusterID, suggestion)
		}
	}
}

func TestBrainSuggestionFeedbackPersistsAcrossRecompute(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}

	dismissed := findSuggestion(t, suggestions, SuggestionKindSourceReview)
	if _, err := service.DismissSuggestion(dismissed.ID); err != nil {
		t.Fatalf("DismissSuggestion failed: %v", err)
	}
	reviewed := findSuggestion(t, suggestions, SuggestionKindClusterReview)
	if _, err := service.MarkSuggestionReviewed(reviewed.ID); err != nil {
		t.Fatalf("MarkSuggestionReviewed failed: %v", err)
	}

	recomputed, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation after feedback failed: %v", err)
	}
	if hasSuggestionID(recomputed, dismissed.ID) {
		t.Fatalf("dismissed suggestion should stay hidden after recompute, got %#v", recomputed)
	}
	reviewedAgain := findSuggestionByID(t, recomputed, reviewed.ID)
	if reviewedAgain.ID != reviewed.ID {
		t.Fatalf("expected reviewed suggestion id to persist, got %q then %q", reviewed.ID, reviewedAgain.ID)
	}
	if reviewedAgain.Status != SuggestionStatusReviewed {
		t.Fatalf("expected reviewed state to persist, got %#v", reviewedAgain)
	}
	if strings.TrimSpace(reviewedAgain.ReviewedAt) == "" {
		t.Fatalf("expected reviewed timestamp, got %#v", reviewedAgain)
	}
}

func TestBrainSuggestionsEncodeEmptyCollectionsAsArrays(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}

	data, err := json.Marshal(suggestions)
	if err != nil {
		t.Fatalf("marshal suggestions failed: %v", err)
	}
	encoded := string(data)
	for _, field := range []string{
		"relatedSignalIds",
		"relatedMemoryLinkIds",
		"relatedClusterIds",
		"targetInvestigationIds",
	} {
		if strings.Contains(encoded, `"`+field+`":null`) {
			t.Fatalf("expected %s to encode as [] instead of null in %s", field, encoded)
		}
	}
}

func TestServiceBuildsBrainAttentionSummary(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	for index := 0; index < 3; index++ {
		if _, err := service.GenerateSignals("inv-current"); err != nil {
			t.Fatalf("GenerateSignals pass %d failed: %v", index+1, err)
		}
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	reviewed := findSuggestion(t, suggestions, SuggestionKindClusterReview)
	if _, err := service.MarkSuggestionReviewed(reviewed.ID); err != nil {
		t.Fatalf("MarkSuggestionReviewed failed: %v", err)
	}

	attention, err := service.AttentionForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AttentionForInvestigation failed: %v", err)
	}
	if attention.InvestigationID != "inv-current" {
		t.Fatalf("expected attention for inv-current, got %#v", attention)
	}
	if attention.OverallScore <= 0 {
		t.Fatalf("expected non-zero attention score, got %#v", attention)
	}
	if attention.DominantState == "" {
		t.Fatalf("expected dominant state, got %#v", attention)
	}
	if attention.Counts.LinkedMemories == 0 {
		t.Fatalf("expected linked memories in counts, got %#v", attention.Counts)
	}
	if attention.Counts.ReviewedNextMoves == 0 {
		t.Fatalf("expected reviewed next move feedback in counts, got %#v", attention.Counts)
	}
	if len(attention.MemoryStrengths) == 0 {
		t.Fatalf("expected memory strengths, got %#v", attention)
	}
	if len(attention.Items) == 0 {
		t.Fatalf("expected attention items, got %#v", attention)
	}
	if strings.TrimSpace(attention.Focus.Headline) == "" {
		t.Fatalf("expected focus narrative headline, got %#v", attention.Focus)
	}
	if !strings.Contains(attention.Focus.Summary, "Current Grid Case") {
		t.Fatalf("expected focus narrative to name current investigation, got %#v", attention.Focus)
	}
	if strings.TrimSpace(attention.Focus.WhyItMatters) == "" {
		t.Fatalf("expected focus narrative why-it-matters text, got %#v", attention.Focus)
	}
	if strings.TrimSpace(attention.Focus.RecommendedAction) == "" {
		t.Fatalf("expected focus narrative recommended action, got %#v", attention.Focus)
	}
	if len(attention.Focus.SupportingFacts) == 0 {
		t.Fatalf("expected focus narrative supporting facts, got %#v", attention.Focus)
	}
	if len(attention.Focus.Guidance) < 3 {
		t.Fatalf("expected focus narrative guidance cards, got %#v", attention.Focus.Guidance)
	}
	nextGuidance := findFocusGuidance(t, attention.Focus.Guidance, BrainGuidanceKindNextAction)
	if strings.TrimSpace(nextGuidance.Title) == "" || strings.TrimSpace(nextGuidance.Detail) == "" {
		t.Fatalf("expected next-action guidance to be explainable, got %#v", nextGuidance)
	}
	evidenceGuidance := findFocusGuidance(t, attention.Focus.Guidance, BrainGuidanceKindEvidenceTrail)
	if !strings.Contains(evidenceGuidance.Detail, "Repeated clues") {
		t.Fatalf("expected evidence-trail guidance to explain the repeated evidence, got %#v", evidenceGuidance)
	}
	thinkingGuidance := findFocusThinkingGuidance(t, attention.Focus.Guidance)
	if strings.TrimSpace(thinkingGuidance.Detail) == "" {
		t.Fatalf("expected thinking guidance to explain what to watch, got %#v", thinkingGuidance)
	}

	strength := findMemoryStrength(t, attention.MemoryStrengths, "inv-old-strong")
	if strength.Score < 0.8 {
		t.Fatalf("expected strong reinforced memory score, got %#v", strength)
	}
	if strength.State != BrainMemoryStateReinforced && strength.State != BrainMemoryStateHot {
		t.Fatalf("expected reinforced or hot memory state, got %#v", strength)
	}
	if strength.ActivationCount < 3 {
		t.Fatalf("expected repeated activation count, got %#v", strength)
	}
	if len(strength.ReasonSamples) == 0 {
		t.Fatalf("expected strength reason samples, got %#v", strength)
	}

	item := findAttentionItem(t, attention.Items, AttentionKindMemoryReinforced)
	if item.Score < 0.8 {
		t.Fatalf("expected reinforced attention item to stay high score, got %#v", item)
	}
	if item.TargetInvestigationID == "" {
		t.Fatalf("expected attention item to point at target memory, got %#v", item)
	}
}

func TestServiceBuildsBrainThinkingGuidance(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	for index := 0; index < 3; index++ {
		if _, err := service.GenerateSignals("inv-current"); err != nil {
			t.Fatalf("GenerateSignals pass %d failed: %v", index+1, err)
		}
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	if _, err := service.SuggestionsForInvestigation("inv-current"); err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	attention, err := service.AttentionForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AttentionForInvestigation failed: %v", err)
	}
	followUp := findFocusGuidance(t, attention.Focus.Guidance, BrainGuidanceKindFollowUp)
	if !strings.Contains(followUp.Detail, "focused Rabbit Hole") {
		t.Fatalf("expected focused Rabbit Hole follow-up guidance, got %#v", followUp)
	}

	broadRoot := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, broadRoot, rootRecord("inv-current", "China Robot Supply Chain"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{"summary":"[LOC:China] appears in a robotics supply-chain investigation."}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, broadRoot, rootRecord("inv-old", "Olympics Broadcast Rights"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-node","data":{"summary":"[LOC:China] appears in an Olympics broadcasting investigation."}}],
		"edges":[]
	}`, "")
	broadService := NewService(broadRoot)
	if _, err := broadService.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals for broad context failed: %v", err)
	}
	broadAttention, err := broadService.AttentionForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AttentionForInvestigation for broad context failed: %v", err)
	}
	gap := findFocusGuidance(t, broadAttention.Focus.Guidance, BrainGuidanceKindGap)
	if !strings.Contains(gap.Detail, "bridge") {
		t.Fatalf("expected bridge-evidence gap guidance, got %#v", gap)
	}
}

func TestServiceBuildsBrainMapView(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	signals, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals second pass failed: %v", err)
	}
	if len(signals) == 0 {
		t.Fatalf("expected active signals for map fixture")
	}
	if _, err := service.PromoteSignal(signals[0].ID); err != nil {
		t.Fatalf("PromoteSignal failed: %v", err)
	}

	brainMap, err := service.MapForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("MapForInvestigation failed: %v", err)
	}
	if brainMap.InvestigationID != "inv-current" {
		t.Fatalf("expected current investigation id, got %#v", brainMap)
	}
	if brainMap.Summary.VisibleNodeCount < 3 {
		t.Fatalf("expected current, cluster, and memory/signal nodes, got %#v", brainMap.Summary)
	}
	if !hasBrainMapNodeKind(brainMap.Nodes, "current") {
		t.Fatalf("expected current node in %#v", brainMap.Nodes)
	}
	if !hasBrainMapNodeKind(brainMap.Nodes, "cluster") {
		t.Fatalf("expected cluster node in %#v", brainMap.Nodes)
	}
	if !hasBrainMapNodeKind(brainMap.Nodes, "memory") {
		t.Fatalf("expected memory node in %#v", brainMap.Nodes)
	}
	if !hasBrainMapEdgeKind(brainMap.Edges, "cluster") {
		t.Fatalf("expected cluster edge in %#v", brainMap.Edges)
	}
	if !hasBrainMapEdgeKind(brainMap.Edges, "link") {
		t.Fatalf("expected link edge in %#v", brainMap.Edges)
	}
	if len(brainMap.Regions) == 0 {
		t.Fatalf("expected cluster regions in %#v", brainMap)
	}
	if len(brainMap.Digest) == 0 {
		t.Fatalf("expected digest items in %#v", brainMap)
	}
}

func TestHandleAPIRoutesBrainMap(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	// The map GET reads persisted state; seed it through the recompute pass.
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/brain/map?investigationId=inv-current", nil)
	recorder := httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected map GET 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var brainMap BrainMapView
	if err := json.Unmarshal(recorder.Body.Bytes(), &brainMap); err != nil {
		t.Fatalf("decode brain map failed: %v", err)
	}
	if brainMap.InvestigationID != "inv-current" {
		t.Fatalf("expected brain map for inv-current, got %#v", brainMap)
	}
	if len(brainMap.Nodes) == 0 {
		t.Fatalf("expected brain map nodes, got %#v", brainMap)
	}
}

func TestHandleAPIRoutesBrainSuggestions(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/brain/suggestions?investigationId=inv-current", nil)
	recorder := httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected suggestions GET 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var suggestions []BrainSuggestion
	if err := json.Unmarshal(recorder.Body.Bytes(), &suggestions); err != nil {
		t.Fatalf("decode suggestions failed: %v", err)
	}
	if len(suggestions) < 2 {
		t.Fatalf("expected multiple suggestions, got %#v", suggestions)
	}

	reviewRequest := httptest.NewRequest(http.MethodPut, "/api/brain/suggestions/"+suggestions[0].ID+"/review", nil)
	reviewRecorder := httptest.NewRecorder()
	HandleAPI(reviewRecorder, reviewRequest, service)
	if reviewRecorder.Code != http.StatusOK {
		t.Fatalf("expected review PUT 200, got %d body=%s", reviewRecorder.Code, reviewRecorder.Body.String())
	}
	var reviewed BrainSuggestion
	if err := json.Unmarshal(reviewRecorder.Body.Bytes(), &reviewed); err != nil {
		t.Fatalf("decode reviewed suggestion failed: %v", err)
	}
	if reviewed.Status != SuggestionStatusReviewed {
		t.Fatalf("expected reviewed status, got %#v", reviewed)
	}

	outcomeRequest := httptest.NewRequest(http.MethodPut, "/api/brain/suggestions/"+suggestions[0].ID+"/outcome", strings.NewReader(`{"outcome":"verified-conflict"}`))
	outcomeRecorder := httptest.NewRecorder()
	HandleAPI(outcomeRecorder, outcomeRequest, service)
	if outcomeRecorder.Code != http.StatusOK {
		t.Fatalf("expected outcome PUT 200, got %d body=%s", outcomeRecorder.Code, outcomeRecorder.Body.String())
	}
	var outcome BrainSuggestion
	if err := json.Unmarshal(outcomeRecorder.Body.Bytes(), &outcome); err != nil {
		t.Fatalf("decode outcome suggestion failed: %v", err)
	}
	if outcome.ReviewOutcome != SuggestionOutcomeVerifiedConflict {
		t.Fatalf("expected verified conflict outcome, got %#v", outcome)
	}

	dismissRequest := httptest.NewRequest(http.MethodPut, "/api/brain/suggestions/"+suggestions[1].ID+"/dismiss", nil)
	dismissRecorder := httptest.NewRecorder()
	HandleAPI(dismissRecorder, dismissRequest, service)
	if dismissRecorder.Code != http.StatusOK {
		t.Fatalf("expected dismiss PUT 200, got %d body=%s", dismissRecorder.Code, dismissRecorder.Body.String())
	}
	var dismissed BrainSuggestion
	if err := json.Unmarshal(dismissRecorder.Body.Bytes(), &dismissed); err != nil {
		t.Fatalf("decode dismissed suggestion failed: %v", err)
	}
	if dismissed.Status != SuggestionStatusDismissed {
		t.Fatalf("expected dismissed status, got %#v", dismissed)
	}
}

func TestServicePreparesAndPersistsFocusedFollowUpAction(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	for index := 0; index < 3; index++ {
		if _, err := service.GenerateSignals("inv-current"); err != nil {
			t.Fatalf("GenerateSignals pass %d failed: %v", index+1, err)
		}
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	suggestion := findSuggestion(t, suggestions, SuggestionKindClusterReview)

	action, err := service.PrepareFollowUp(PrepareFollowUpRequest{
		InvestigationID: "inv-current",
		SourceKind:      FollowUpSourceSuggestion,
		SourceID:        suggestion.ID,
	})
	if err != nil {
		t.Fatalf("PrepareFollowUp failed: %v", err)
	}
	if action.Status != FollowUpStatusPrepared {
		t.Fatalf("expected prepared status, got %#v", action)
	}
	if action.DescentMode != "guided" {
		t.Fatalf("expected guided Rabbit Hole descent, got %#v", action)
	}
	if !strings.Contains(action.Prompt, "Current Grid Case") || !strings.Contains(action.Prompt, "Acme Grid") {
		t.Fatalf("expected prompt to include current case and repeated clue, got %q", action.Prompt)
	}
	if len(action.RelatedClusterIDs) == 0 || len(action.TargetInvestigationIDs) == 0 {
		t.Fatalf("expected persisted reason references, got %#v", action)
	}

	launched, err := service.LaunchFollowUp(action.ID)
	if err != nil {
		t.Fatalf("LaunchFollowUp failed: %v", err)
	}
	if launched.Status != FollowUpStatusLaunched || strings.TrimSpace(launched.LaunchedAt) == "" {
		t.Fatalf("expected launched action with timestamp, got %#v", launched)
	}

	actions, err := service.FollowUpsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("FollowUpsForInvestigation failed: %v", err)
	}
	if len(actions) != 1 || actions[0].Status != FollowUpStatusLaunched {
		t.Fatalf("expected launched action to persist, got %#v", actions)
	}

	cancelled, err := service.CancelFollowUp(action.ID)
	if err != nil {
		t.Fatalf("CancelFollowUp failed: %v", err)
	}
	if cancelled.Status != FollowUpStatusCancelled || strings.TrimSpace(cancelled.CancelledAt) == "" {
		t.Fatalf("expected cancelled action with timestamp, got %#v", cancelled)
	}
}

func TestHandleAPIRoutesBrainFollowUps(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	suggestion := findSuggestion(t, suggestions, SuggestionKindClusterReview)

	request := httptest.NewRequest(
		http.MethodPut,
		"/api/brain/followups/prepare",
		strings.NewReader(`{"investigationId":"inv-current","sourceKind":"suggestion","sourceId":"`+suggestion.ID+`"}`),
	)
	recorder := httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected follow-up prepare 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var action BrainFollowUpAction
	if err := json.Unmarshal(recorder.Body.Bytes(), &action); err != nil {
		t.Fatalf("decode follow-up action failed: %v", err)
	}
	if action.Status != FollowUpStatusPrepared {
		t.Fatalf("expected prepared follow-up action, got %#v", action)
	}

	launchRequest := httptest.NewRequest(http.MethodPut, "/api/brain/followups/"+action.ID+"/launch", nil)
	launchRecorder := httptest.NewRecorder()
	HandleAPI(launchRecorder, launchRequest, service)
	if launchRecorder.Code != http.StatusOK {
		t.Fatalf("expected follow-up launch 200, got %d body=%s", launchRecorder.Code, launchRecorder.Body.String())
	}
	var launched BrainFollowUpAction
	if err := json.Unmarshal(launchRecorder.Body.Bytes(), &launched); err != nil {
		t.Fatalf("decode launched action failed: %v", err)
	}
	if launched.Status != FollowUpStatusLaunched {
		t.Fatalf("expected launched status, got %#v", launched)
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/api/brain/followups?investigationId=inv-current", nil)
	listRecorder := httptest.NewRecorder()
	HandleAPI(listRecorder, listRequest, service)
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("expected follow-up list 200, got %d body=%s", listRecorder.Code, listRecorder.Body.String())
	}
	var actions []BrainFollowUpAction
	if err := json.Unmarshal(listRecorder.Body.Bytes(), &actions); err != nil {
		t.Fatalf("decode follow-up list failed: %v", err)
	}
	if len(actions) != 1 || actions[0].Status != FollowUpStatusLaunched {
		t.Fatalf("expected launched action in list, got %#v", actions)
	}
}

func TestHandleAPIRoutesBrainAutonomy(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)

	updateRequest := httptest.NewRequest(
		http.MethodPut,
		"/api/brain/autonomy/settings",
		strings.NewReader(`{"mode":"prepare-only","maxAutoPreparedPerInvestigation":2,"maxActivePrepared":4}`),
	)
	updateRecorder := httptest.NewRecorder()
	HandleAPI(updateRecorder, updateRequest, service)
	if updateRecorder.Code != http.StatusOK {
		t.Fatalf("expected autonomy settings PUT 200, got %d body=%s", updateRecorder.Code, updateRecorder.Body.String())
	}
	var updated BrainAutonomySettings
	if err := json.Unmarshal(updateRecorder.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode autonomy settings failed: %v", err)
	}
	if updated.Mode != AutonomyModePrepareOnly || updated.MaxActivePrepared != 4 {
		t.Fatalf("expected persisted autonomy settings, got %#v", updated)
	}

	stateRequest := httptest.NewRequest(http.MethodGet, "/api/brain/autonomy?investigationId=inv-current", nil)
	stateRecorder := httptest.NewRecorder()
	HandleAPI(stateRecorder, stateRequest, service)
	if stateRecorder.Code != http.StatusOK {
		t.Fatalf("expected autonomy GET 200, got %d body=%s", stateRecorder.Code, stateRecorder.Body.String())
	}
	var state BrainAutonomyState
	if err := json.Unmarshal(stateRecorder.Body.Bytes(), &state); err != nil {
		t.Fatalf("decode autonomy state failed: %v", err)
	}
	if state.Settings.Mode != AutonomyModePrepareOnly || state.Settings.MaxAutoPreparedPerInvestigation != 2 {
		t.Fatalf("expected autonomy state to include settings, got %#v", state)
	}

	invalidRequest := httptest.NewRequest(
		http.MethodPut,
		"/api/brain/autonomy/settings",
		strings.NewReader(`{"mode":"launch-everything"}`),
	)
	invalidRecorder := httptest.NewRecorder()
	HandleAPI(invalidRecorder, invalidRequest, service)
	if invalidRecorder.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid autonomy settings 400, got %d body=%s", invalidRecorder.Code, invalidRecorder.Body.String())
	}
}

func TestDismissAndPromotePersistAcrossRecompute(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{"summary":"[ORG:Acme Grid] appears.","sourceURL":"https://intel.example.com/current"}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Old Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-node","data":{"summary":"[ORG:Acme Grid] appeared before.","sourceURL":"https://intel.example.com/archive"}}],
		"edges":[]
	}`, "")

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-current")
	if err != nil || len(signals) != 1 {
		t.Fatalf("expected initial signal, got signals=%#v err=%v", signals, err)
	}
	signalID := signals[0].ID

	if _, err := service.PromoteSignal(signalID); err != nil {
		t.Fatalf("PromoteSignal failed: %v", err)
	}
	if _, err := service.PromoteSignal(signalID); err != nil {
		t.Fatalf("second PromoteSignal failed: %v", err)
	}
	links, err := service.LinksForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("LinksForInvestigation failed: %v", err)
	}
	if len(links) != 1 {
		t.Fatalf("expected one deduped memory link, got %#v", links)
	}
	signals, err = service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals after link failed: %v", err)
	}
	if len(signals) != 0 {
		t.Fatalf("linked signal should no longer be active, got %#v", signals)
	}

	writeTestInvestigation(t, root, rootRecord("inv-another", "Another Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"another-node","data":{"summary":"[ORG:Beta Grid] appears.","sourceURL":"https://beta.example.com/report"}}],
		"edges":[]
	}`, "")
	signals, err = service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals before dismiss failed: %v", err)
	}
	if len(signals) != 0 {
		t.Fatalf("expected no unrelated signal before adding overlap, got %#v", signals)
	}

	writeTestInvestigation(t, root, rootRecord("inv-beta", "Beta Memory"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"beta-node","data":{"summary":"[ORG:Beta Grid] was previously noted.","sourceURL":"https://beta.example.com/archive"}}],
		"edges":[]
	}`, "")
	signals, err = service.GenerateSignals("inv-current")
	if err != nil || len(signals) != 0 {
		t.Fatalf("current case should not activate beta without current beta evidence, got signals=%#v err=%v", signals, err)
	}
}

func writeSuggestionFixture(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Grid Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{
			"summary":"[ORG:Acme Grid] appears during [DATE:2026-05-20] power stress.",
			"sourceURL":"https://intel.example.com/current"
		}}],
		"edges":[{"source":"current-node","target":"current-node","data":{"tag":"POWER_RISK"}}]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old-strong", "Older Strong Grid"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-strong-node","data":{
			"summary":"[ORG:Acme Grid] appeared during [DATE:2026-05-20] power stress.",
			"sourceURL":"https://intel.example.com/strong"
		}}],
		"edges":[{"source":"old-strong-node","target":"old-strong-node","data":{"tag":"POWER_RISK"}}]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old-warm", "Older Warm Grid"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-warm-node","data":{
			"summary":"[ORG:Acme Grid] resurfaced during [DATE:2026-05-21] cooling talks.",
			"sourceURL":"https://intel.example.com/warm"
		}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-source-only", "Source Network Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"source-node","data":{
			"summary":"A source-only archive note with no tagged entities.",
			"sourceURL":"https://intel.example.com/source"
		}}],
		"edges":[]
	}`, "")
	return root
}

func TestHandleAPIRoutesBrainAttention(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	if _, err := service.SuggestionsForInvestigation("inv-current"); err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/brain/attention?investigationId=inv-current", nil)
	recorder := httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected attention GET 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var attention BrainAttentionSummary
	if err := json.Unmarshal(recorder.Body.Bytes(), &attention); err != nil {
		t.Fatalf("decode attention failed: %v", err)
	}
	if attention.InvestigationID != "inv-current" {
		t.Fatalf("expected attention for inv-current, got %#v", attention)
	}
	if len(attention.Items) == 0 {
		t.Fatalf("expected attention route to include items, got %#v", attention)
	}
	if strings.TrimSpace(attention.Focus.Headline) == "" {
		t.Fatalf("expected attention route to include focus narrative, got %#v", attention.Focus)
	}
}

func findSuggestion(t *testing.T, suggestions []BrainSuggestion, kind string) BrainSuggestion {
	t.Helper()
	for _, suggestion := range suggestions {
		if suggestion.Kind == kind {
			return suggestion
		}
	}
	t.Fatalf("expected suggestion kind=%q in %#v", kind, suggestions)
	return BrainSuggestion{}
}

func hasSuggestionID(suggestions []BrainSuggestion, id string) bool {
	for _, suggestion := range suggestions {
		if suggestion.ID == id {
			return true
		}
	}
	return false
}

func testClusterMemberIDs(count int) []string {
	ids := []string{"inv-current"}
	for index := 1; index < count; index++ {
		ids = append(ids, "inv-old-"+strconv.Itoa(index))
	}
	return ids
}

func findSuggestionByClusterID(t *testing.T, suggestions []BrainSuggestion, clusterID string) BrainSuggestion {
	t.Helper()
	for _, suggestion := range suggestions {
		for _, candidate := range suggestion.RelatedClusterIDs {
			if candidate == clusterID {
				return suggestion
			}
		}
	}
	t.Fatalf("expected suggestion for cluster %q in %#v", clusterID, suggestions)
	return BrainSuggestion{}
}

func hasBrainMapNodeKind(nodes []BrainMapNode, kind string) bool {
	for _, node := range nodes {
		if node.Kind == kind {
			return true
		}
	}
	return false
}

func hasBrainMapEdgeKind(edges []BrainMapEdge, kind string) bool {
	for _, edge := range edges {
		if edge.Kind == kind {
			return true
		}
	}
	return false
}

func findSuggestionByID(t *testing.T, suggestions []BrainSuggestion, id string) BrainSuggestion {
	t.Helper()
	for _, suggestion := range suggestions {
		if suggestion.ID == id {
			return suggestion
		}
	}
	t.Fatalf("expected suggestion id=%q in %#v", id, suggestions)
	return BrainSuggestion{}
}

func findAutonomyQueueItem(t *testing.T, items []BrainAutonomyQueueItem, suggestionID string) BrainAutonomyQueueItem {
	t.Helper()
	for _, item := range items {
		if item.SuggestionID == suggestionID {
			return item
		}
	}
	t.Fatalf("expected autonomy queue item for suggestion id=%q in %#v", suggestionID, items)
	return BrainAutonomyQueueItem{}
}

func findMemoryStrength(t *testing.T, strengths []BrainMemoryStrength, targetID string) BrainMemoryStrength {
	t.Helper()
	for _, strength := range strengths {
		if strength.TargetInvestigationID == targetID {
			return strength
		}
	}
	t.Fatalf("expected memory strength for target %q in %#v", targetID, strengths)
	return BrainMemoryStrength{}
}

func findAttentionItem(t *testing.T, items []BrainAttentionItem, kind string) BrainAttentionItem {
	t.Helper()
	for _, item := range items {
		if item.Kind == kind {
			return item
		}
	}
	t.Fatalf("expected attention item kind=%q in %#v", kind, items)
	return BrainAttentionItem{}
}

func findFocusGuidance(t *testing.T, cards []BrainGuidanceCard, kind string) BrainGuidanceCard {
	t.Helper()
	for _, card := range cards {
		if card.Kind == kind {
			return card
		}
	}
	t.Fatalf("expected focus guidance kind=%q in %#v", kind, cards)
	return BrainGuidanceCard{}
}

func findFocusThinkingGuidance(t *testing.T, cards []BrainGuidanceCard) BrainGuidanceCard {
	t.Helper()
	for _, card := range cards {
		switch card.Kind {
		case BrainGuidanceKindCaution, BrainGuidanceKindGap, BrainGuidanceKindFreshness, BrainGuidanceKindFollowUp:
			return card
		}
	}
	t.Fatalf("expected focus thinking guidance in %#v", cards)
	return BrainGuidanceCard{}
}

func TestForgetMemoryLinkRemovesLinkAndDismissesExistingSignal(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{"summary":"[ORG:Acme Grid] appears.","sourceURL":"https://intel.example.com/current"}}],
		"edges":[{"source":"current-node","target":"current-node","data":{"tag":"POWER_RISK"}}]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Old Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-node","data":{"summary":"[ORG:Acme Grid] appeared before.","sourceURL":"https://intel.example.com/archive"}}],
		"edges":[{"source":"old-node","target":"old-node","data":{"tag":"POWER_RISK"}}]
	}`, "")

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-current")
	if err != nil || len(signals) != 0 {
		t.Fatalf("expected strong signal to auto-promote, got signals=%#v err=%v", signals, err)
	}
	links, err := service.LinksForInvestigation("inv-current")
	if err != nil || len(links) != 1 {
		t.Fatalf("expected one memory link, got links=%#v err=%v", links, err)
	}

	if _, err := service.ForgetLink(links[0].ID); err != nil {
		t.Fatalf("ForgetLink failed: %v", err)
	}
	links, err = service.LinksForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("LinksForInvestigation after forget failed: %v", err)
	}
	if len(links) != 0 {
		t.Fatalf("forgotten link should not remain visible, got %#v", links)
	}
	signals, err = service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals after forget failed: %v", err)
	}
	if len(signals) != 0 {
		t.Fatalf("forgotten memory should not immediately regenerate active signal, got %#v", signals)
	}
}

func TestDismissPersistsAcrossRecompute(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"current-node","data":{"summary":"[ORG:Acme Grid] appears."}}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Old Case"), `{
		"mode":"strict-grid",
		"nodes":[{"id":"old-node","data":{"summary":"[ORG:Acme Grid] appeared before."}}],
		"edges":[]
	}`, "")

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-current")
	if err != nil || len(signals) != 1 {
		t.Fatalf("expected initial signal, got signals=%#v err=%v", signals, err)
	}
	if _, err := service.DismissSignal(signals[0].ID); err != nil {
		t.Fatalf("DismissSignal failed: %v", err)
	}
	signals, err = service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals after dismiss failed: %v", err)
	}
	if len(signals) != 0 {
		t.Fatalf("dismissed signal should stay hidden, got %#v", signals)
	}
}

func TestHandleAPIRejectsInvalidBrainRoutes(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	service := NewService(root)

	request := httptest.NewRequest(http.MethodGet, "/api/brain/signals?investigationId=../escape", nil)
	recorder := httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid investigation id to be rejected, got %d", recorder.Code)
	}

	request = httptest.NewRequest(http.MethodPut, "/api/brain/signals/missing/dismiss", nil)
	recorder = httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected missing signal to return 404, got %d", recorder.Code)
	}

	request = httptest.NewRequest(http.MethodGet, "/api/brain/clusters?investigationId=../escape", nil)
	recorder = httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid cluster investigation id to be rejected, got %d", recorder.Code)
	}

	request = httptest.NewRequest(http.MethodGet, "/api/brain/suggestions?investigationId=../escape", nil)
	recorder = httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid suggestion investigation id to be rejected, got %d", recorder.Code)
	}

	request = httptest.NewRequest(http.MethodGet, "/api/brain/attention?investigationId=../escape", nil)
	recorder = httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid attention investigation id to be rejected, got %d", recorder.Code)
	}

	request = httptest.NewRequest(http.MethodPut, "/api/brain/clusters/missing/pin", nil)
	recorder = httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected missing cluster to return 404, got %d", recorder.Code)
	}

	request = httptest.NewRequest(http.MethodPut, "/api/brain/suggestions/missing/dismiss", nil)
	recorder = httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected missing suggestion to return 404, got %d", recorder.Code)
	}

	if _, err := os.Stat(filepath.Join(root, "brain")); err == nil {
		t.Fatal("invalid API calls should not create brain storage")
	}
}

func findCluster(t *testing.T, clusters []MemoryCluster, gateway string, label string) MemoryCluster {
	t.Helper()
	for _, cluster := range clusters {
		if cluster.DominantGateway == gateway && cluster.Label == label {
			return cluster
		}
	}
	t.Fatalf("expected cluster gateway=%q label=%q in %#v", gateway, label, clusters)
	return MemoryCluster{}
}

func TestNotifyEvidenceReportsFiredSynapses(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Grid Case"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"current-node",
			"data":{
				"title":"Current Grid Lead",
				"summary":"[ORG:Acme Grid] resurfaces during [DATE:2026-05-20] capacity talks.",
				"sourceURL":"https://intel.example.com/current"
			}
		}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Grid Memory"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"old-node",
			"data":{
				"title":"Older Grid Lead",
				"summary":"Prior notes tied [ORG:Acme Grid] to [DATE:2026-05-20] cooling stress.",
				"sourceURL":"https://intel.example.com/archive"
			}
		}],
		"edges":[]
	}`, "")

	service := NewService(root)

	firing, err := service.NotifyEvidence("inv-current", models.InvestigationBoardFilename)
	if err != nil {
		t.Fatalf("NotifyEvidence failed: %v", err)
	}
	if firing.FiredCount != 1 || firing.PromotedCount != 0 {
		t.Fatalf("expected one fired synapse and no promotion, got %#v", firing)
	}
	if firing.InvestigationID != "inv-current" {
		t.Fatalf("expected investigation id inv-current, got %q", firing.InvestigationID)
	}
	if firing.Source != models.InvestigationBoardFilename {
		t.Fatalf("expected source %q, got %q", models.InvestigationBoardFilename, firing.Source)
	}
	if firing.TopTitle != "Older Grid Memory" {
		t.Fatalf("expected top firing target Older Grid Memory, got %#v", firing)
	}
	if firing.TopScore < 0.65 {
		t.Fatalf("expected strong top score, got %.2f", firing.TopScore)
	}
	if strings.TrimSpace(firing.FiredAt) == "" {
		t.Fatal("expected firedAt timestamp to be set")
	}

	// A second evidence event re-activates the same synapse; the diff must
	// still report it even if both events land inside the same second.
	repeat, err := service.NotifyEvidence("inv-current", models.InvestigationBoardFilename)
	if err != nil {
		t.Fatalf("repeat NotifyEvidence failed: %v", err)
	}
	if repeat.FiredCount != 1 {
		t.Fatalf("expected repeat evidence to re-fire the synapse, got %#v", repeat)
	}

	// Dismissed signals must stay quiet on later evidence events.
	signals, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if len(signals) != 1 {
		t.Fatalf("expected one active signal, got %#v", signals)
	}
	if _, err := service.DismissSignal(signals[0].ID); err != nil {
		t.Fatalf("DismissSignal failed: %v", err)
	}
	quiet, err := service.NotifyEvidence("inv-current", models.InvestigationBoardFilename)
	if err != nil {
		t.Fatalf("NotifyEvidence after dismissal failed: %v", err)
	}
	if quiet.FiredCount != 0 || quiet.PromotedCount != 0 {
		t.Fatalf("expected dismissed signal to stay quiet, got %#v", quiet)
	}
}

func TestNotifyEvidenceCountsAutoPromotion(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Grid Case"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"current-node",
			"data":{
				"summary":"[ORG:Acme Grid] appears during [DATE:2026-05-20].",
				"sourceURL":"https://intel.example.com/current"
			}
		}],
		"edges":[{
			"source":"current-node",
			"target":"current-node",
			"data":{"tag":"INFRASTRUCTURE_STRESS"}
		}]
	}`, `{
		"vaultId":"inv-current",
		"connections":[{"source":"current-node","target":"current-node","tag":"INFRASTRUCTURE_STRESS"}]
	}`)
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Grid Memory"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"old-node",
			"data":{
				"summary":"Prior notes tied [ORG:Acme Grid] to [DATE:2026-05-20].",
				"sourceURL":"https://intel.example.com/archive"
			}
		}],
		"edges":[{
			"source":"old-node",
			"target":"old-node",
			"data":{"tag":"INFRASTRUCTURE_STRESS"}
		}]
	}`, `{
		"vaultId":"inv-old",
		"connections":[{"source":"old-node","target":"old-node","tag":"INFRASTRUCTURE_STRESS"}]
	}`)

	service := NewService(root)
	firing, err := service.NotifyEvidence("inv-current", models.InvestigationRelationshipsFilename)
	if err != nil {
		t.Fatalf("NotifyEvidence failed: %v", err)
	}
	if firing.PromotedCount != 1 || firing.FiredCount != 0 {
		t.Fatalf("expected one auto-promotion and no plain firing, got %#v", firing)
	}
	if firing.TopTitle != "Older Grid Memory" {
		t.Fatalf("expected promotion target Older Grid Memory, got %#v", firing)
	}

	links, err := service.LinksForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("LinksForInvestigation failed: %v", err)
	}
	if len(links) != 1 {
		t.Fatalf("expected one durable memory link, got %#v", links)
	}
}

func TestNotifyEvidenceRejectsInvalidInvestigationID(t *testing.T) {
	service := NewService(filepath.Join(t.TempDir(), "abdomen_vault"))
	if _, err := service.NotifyEvidence("../escape", models.InvestigationBoardFilename); !errors.Is(err, models.ErrInvalidInvestigationID) {
		t.Fatalf("expected invalid investigation id error, got %v", err)
	}
}

func TestSignalsReadDoesNotReactivate(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Grid Case"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"current-node",
			"data":{
				"summary":"[ORG:Acme Grid] resurfaces during [DATE:2026-05-20] capacity talks.",
				"sourceURL":"https://intel.example.com/current"
			}
		}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Grid Memory"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"old-node",
			"data":{
				"summary":"Prior notes tied [ORG:Acme Grid] to [DATE:2026-05-20] cooling stress.",
				"sourceURL":"https://intel.example.com/archive"
			}
		}],
		"edges":[]
	}`, "")

	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}

	for read := 0; read < 3; read++ {
		signals, err := service.SignalsForInvestigation("inv-current")
		if err != nil {
			t.Fatalf("SignalsForInvestigation read %d failed: %v", read, err)
		}
		if len(signals) != 1 {
			t.Fatalf("expected one persisted signal on read %d, got %#v", read, signals)
		}
		if signals[0].ActivationCount != 1 {
			t.Fatalf("expected read %d to leave activation count at 1, got %d", read, signals[0].ActivationCount)
		}
	}

	firing, err := service.NotifyEvidence("inv-current", models.InvestigationBoardFilename)
	if err != nil {
		t.Fatalf("NotifyEvidence failed: %v", err)
	}
	if firing.FiredCount != 1 {
		t.Fatalf("expected evidence event to re-fire the synapse, got %#v", firing)
	}
	signals, err := service.SignalsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SignalsForInvestigation failed: %v", err)
	}
	if signals[0].ActivationCount != 2 {
		t.Fatalf("expected activation count 2 after evidence event, got %d", signals[0].ActivationCount)
	}
}

func TestRecomputeEndpointFiresSynapses(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)

	getRequest := httptest.NewRequest(http.MethodGet, "/api/brain/signals?investigationId=inv-current", nil)
	getRecorder := httptest.NewRecorder()
	HandleAPI(getRecorder, getRequest, service)
	if getRecorder.Code != http.StatusOK {
		t.Fatalf("expected signals GET 200, got %d body=%s", getRecorder.Code, getRecorder.Body.String())
	}
	var before []BrainSignal
	if err := json.Unmarshal(getRecorder.Body.Bytes(), &before); err != nil {
		t.Fatalf("decode signals failed: %v", err)
	}
	if len(before) != 0 {
		t.Fatalf("expected empty persisted signals before any recompute, got %#v", before)
	}

	recomputeRequest := httptest.NewRequest(http.MethodPut, "/api/brain/signals/recompute?investigationId=inv-current", nil)
	recomputeRecorder := httptest.NewRecorder()
	HandleAPI(recomputeRecorder, recomputeRequest, service)
	if recomputeRecorder.Code != http.StatusOK {
		t.Fatalf("expected recompute PUT 200, got %d body=%s", recomputeRecorder.Code, recomputeRecorder.Body.String())
	}
	var firing EvidenceFiring
	if err := json.Unmarshal(recomputeRecorder.Body.Bytes(), &firing); err != nil {
		t.Fatalf("decode firing failed: %v", err)
	}
	if firing.FiredCount < 1 {
		t.Fatalf("expected manual recompute to fire synapses, got %#v", firing)
	}
	if firing.Source != "manual-refresh" {
		t.Fatalf("expected manual-refresh source, got %q", firing.Source)
	}

	getRecorder = httptest.NewRecorder()
	HandleAPI(getRecorder, getRequest, service)
	if getRecorder.Code != http.StatusOK {
		t.Fatalf("expected signals GET 200 after recompute, got %d", getRecorder.Code)
	}
	var after []BrainSignal
	if err := json.Unmarshal(getRecorder.Body.Bytes(), &after); err != nil {
		t.Fatalf("decode signals failed: %v", err)
	}
	if len(after) != firing.FiredCount {
		t.Fatalf("expected %d persisted active signals, got %#v", firing.FiredCount, after)
	}
}

func TestGatewayRegistrySeedsBuiltIns(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	service := NewService(root)

	gateways, err := service.ListGateways()
	if err != nil {
		t.Fatalf("ListGateways failed: %v", err)
	}
	codes := map[string]GatewayUsage{}
	for _, gateway := range gateways {
		codes[gateway.Definition.Code] = gateway
		if gateway.Definition.Name == "" || gateway.Definition.Description == "" || !gateway.Definition.Enabled {
			t.Fatalf("expected complete built-in definition, got %#v", gateway.Definition)
		}
	}
	for _, expected := range []string{GatewayEntityDate, GatewaySourceDomain, GatewayRelationshipTag, GatewayContradiction} {
		if _, ok := codes[expected]; !ok {
			t.Fatalf("expected built-in gateway %q in %#v", expected, gateways)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "brain", "gateways.json")); err != nil {
		t.Fatalf("expected gateway registry persisted in vault state: %v", err)
	}

	again, err := service.ListGateways()
	if err != nil {
		t.Fatalf("second ListGateways failed: %v", err)
	}
	if len(again) != len(gateways) {
		t.Fatalf("expected registry seeding to be idempotent, got %d then %d", len(gateways), len(again))
	}
}

func TestGatewayDetailRoutesFirings(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Grid Case"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"current-node",
			"data":{
				"summary":"[ORG:Acme Grid] resurfaces during [DATE:2026-05-20] capacity talks.",
				"sourceURL":"https://intel.example.com/current"
			}
		}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Grid Memory"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"old-node",
			"data":{
				"summary":"Prior notes tied [ORG:Acme Grid] to [DATE:2026-05-20] cooling stress.",
				"sourceURL":"https://intel.example.com/archive"
			}
		}],
		"edges":[]
	}`, "")

	service := NewService(root)
	if _, err := service.GenerateSignals("inv-current"); err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}

	detail, err := service.GatewayDetail(GatewayEntityDate, "", 0)
	if err != nil {
		t.Fatalf("GatewayDetail failed: %v", err)
	}
	if detail.Definition.Code != GatewayEntityDate {
		t.Fatalf("expected entity-date definition, got %#v", detail.Definition)
	}
	if len(detail.Routes) == 0 || detail.TotalRoutes != len(detail.Routes) {
		t.Fatalf("expected routed firings through entity-date, got %#v", detail)
	}
	if len(detail.Values) == 0 {
		t.Fatalf("expected value rollup, got %#v", detail.Values)
	}

	capped, err := service.GatewayDetail(GatewayEntityDate, "", 1)
	if err != nil {
		t.Fatalf("capped GatewayDetail failed: %v", err)
	}
	if len(capped.Routes) != 1 || capped.TotalRoutes != detail.TotalRoutes || capped.Limit != 1 {
		t.Fatalf("expected one capped route with full total, got %#v", capped)
	}
	route := capped.Routes[0]
	if route.SignalID == "" || route.TargetTitle != "Older Grid Memory" {
		t.Fatalf("expected route pointing at Older Grid Memory, got %#v", route)
	}
	foundAcme := false
	for _, candidate := range detail.Routes {
		if candidate.Label == "Acme Grid" {
			foundAcme = true
			route = candidate
		}
	}
	if !foundAcme {
		t.Fatalf("expected an Acme Grid reason route, got %#v", detail.Routes)
	}

	filtered, err := service.GatewayDetail(GatewayEntityDate, route.Value, 0)
	if err != nil {
		t.Fatalf("filtered GatewayDetail failed: %v", err)
	}
	if filtered.TotalRoutes == 0 {
		t.Fatalf("expected value-filtered routes, got %#v", filtered)
	}
	for _, candidate := range filtered.Routes {
		if candidate.Value != route.Value {
			t.Fatalf("expected only %q routes, got %#v", route.Value, candidate)
		}
	}
	if len(filtered.Values) != 1 || filtered.Values[0].Value != route.Value {
		t.Fatalf("expected single-value rollup, got %#v", filtered.Values)
	}

	none, err := service.GatewayDetail(GatewayEntityDate, "ORG|nowhere", 0)
	if err != nil {
		t.Fatalf("empty GatewayDetail failed: %v", err)
	}
	if none.TotalRoutes != 0 || none.Definition.Code != GatewayEntityDate {
		t.Fatalf("expected definition with zero routes for unknown value, got %#v", none)
	}

	if _, err := service.GatewayDetail("GW-NOPE", "", 0); !errors.Is(err, ErrGatewayNotFound) {
		t.Fatalf("expected gateway-not-found error, got %v", err)
	}
}

func TestUpdateGatewayDefinitionPersistsOperatorEdits(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	service := NewService(root)

	renamed, err := service.UpdateGatewayDefinition(GatewayEntityDate, GatewayUpdate{
		Name:        strPtr("Entity & Date (grid)"),
		Description: strPtr("Operator-tuned description."),
	})
	if err != nil {
		t.Fatalf("UpdateGatewayDefinition rename failed: %v", err)
	}
	if renamed.Name != "Entity & Date (grid)" || renamed.Description != "Operator-tuned description." {
		t.Fatalf("expected renamed definition, got %#v", renamed)
	}

	disabled, err := service.UpdateGatewayDefinition(GatewayEntityDate, GatewayUpdate{Enabled: boolPtr(false)})
	if err != nil {
		t.Fatalf("UpdateGatewayDefinition disable failed: %v", err)
	}
	if disabled.Enabled {
		t.Fatalf("expected disabled gateway, got %#v", disabled)
	}

	// A fresh service on the same vault must see the persisted edits: reseeding
	// must not resurrect built-in names or the enabled flag.
	reopened := NewService(root)
	usages, err := reopened.ListGateways()
	if err != nil {
		t.Fatalf("ListGateways failed: %v", err)
	}
	found := false
	for _, usage := range usages {
		if usage.Definition.Code != GatewayEntityDate {
			continue
		}
		found = true
		if usage.Definition.Enabled {
			t.Fatalf("expected persisted disable, got %#v", usage.Definition)
		}
		if usage.Definition.Name != "Entity & Date (grid)" {
			t.Fatalf("expected persisted rename, got %#v", usage.Definition)
		}
	}
	if !found {
		t.Fatalf("expected entity-date gateway in registry, got %#v", usages)
	}

	if _, err := service.UpdateGatewayDefinition("GW-NOPE", GatewayUpdate{Enabled: boolPtr(false)}); !errors.Is(err, ErrGatewayNotFound) {
		t.Fatalf("expected gateway-not-found error, got %v", err)
	}
	if _, err := service.UpdateGatewayDefinition(GatewayEntityDate, GatewayUpdate{Name: strPtr("   ")}); !errors.Is(err, ErrInvalidGatewayUpdate) {
		t.Fatalf("expected invalid-update error for blank name, got %v", err)
	}
	if _, err := service.UpdateGatewayDefinition(GatewayEntityDate, GatewayUpdate{}); !errors.Is(err, ErrInvalidGatewayUpdate) {
		t.Fatalf("expected invalid-update error for empty update, got %v", err)
	}
}

func TestGenerateSignalsSkipDisabledGateways(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	writeTestInvestigation(t, root, rootRecord("inv-current", "Current Grid Case"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"current-node",
			"data":{
				"title":"Current Grid Lead",
				"summary":"[ORG:Acme Grid] resurfaces during [DATE:2026-05-20] capacity talks.",
				"fullText":"[ORG:Acme Grid] resurfaces during [DATE:2026-05-20] capacity talks.",
				"sourceURL":"https://intel.example.com/current"
			}
		}],
		"edges":[]
	}`, "")
	writeTestInvestigation(t, root, rootRecord("inv-old", "Older Grid Memory"), `{
		"mode":"strict-grid",
		"nodes":[{
			"id":"old-node",
			"data":{
				"title":"Older Grid Lead",
				"summary":"Prior notes tied [ORG:Acme Grid] to [DATE:2026-05-20] cooling stress.",
				"fullText":"Prior notes tied [ORG:Acme Grid] to [DATE:2026-05-20] cooling stress.",
				"sourceURL":"https://intel.example.com/archive"
			}
		}],
		"edges":[]
	}`, "")

	service := NewService(root)
	signals, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals failed: %v", err)
	}
	if len(signals) != 1 || !signals[0].HasGateway(GatewayEntityDate) {
		t.Fatalf("expected baseline entity-date signal, got %#v", signals)
	}

	if _, err := service.UpdateGatewayDefinition(GatewayEntityDate, GatewayUpdate{Enabled: boolPtr(false)}); err != nil {
		t.Fatalf("disable entity-date failed: %v", err)
	}
	filtered, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals after disable failed: %v", err)
	}
	if len(filtered) != 1 {
		t.Fatalf("expected source-domain signal to survive, got %#v", filtered)
	}
	if filtered[0].HasGateway(GatewayEntityDate) {
		t.Fatalf("expected entity-date reasons dropped, got %#v", filtered[0])
	}
	if !filtered[0].HasGateway(GatewaySourceDomain) {
		t.Fatalf("expected source-domain reasons kept, got %#v", filtered[0])
	}

	if _, err := service.UpdateGatewayDefinition(GatewaySourceDomain, GatewayUpdate{Enabled: boolPtr(false)}); err != nil {
		t.Fatalf("disable source-domain failed: %v", err)
	}
	quiet, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals after disabling both gateways failed: %v", err)
	}
	if len(quiet) != 0 {
		t.Fatalf("expected no signals with all gateways disabled, got %#v", quiet)
	}

	if _, err := service.UpdateGatewayDefinition(GatewayEntityDate, GatewayUpdate{Enabled: boolPtr(true)}); err != nil {
		t.Fatalf("re-enable entity-date failed: %v", err)
	}
	restored, err := service.GenerateSignals("inv-current")
	if err != nil {
		t.Fatalf("GenerateSignals after re-enable failed: %v", err)
	}
	if len(restored) != 1 || !restored[0].HasGateway(GatewayEntityDate) {
		t.Fatalf("expected entity-date signal restored, got %#v", restored)
	}
}

func TestHandleAPIRoutesGatewayUpdate(t *testing.T) {
	root := filepath.Join(t.TempDir(), "abdomen_vault")
	service := NewService(root)

	request := httptest.NewRequest(http.MethodPut, "/api/brain/gateways/"+GatewaySourceDomain, strings.NewReader(`{"name":"Source Domain (renamed)","enabled":false}`))
	recorder := httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected gateway PUT 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var definition GatewayDefinition
	if err := json.Unmarshal(recorder.Body.Bytes(), &definition); err != nil {
		t.Fatalf("decode gateway definition failed: %v", err)
	}
	if definition.Name != "Source Domain (renamed)" || definition.Enabled {
		t.Fatalf("expected renamed disabled gateway, got %#v", definition)
	}

	detailRequest := httptest.NewRequest(http.MethodGet, "/api/brain/gateways/"+GatewaySourceDomain, nil)
	detailRecorder := httptest.NewRecorder()
	HandleAPI(detailRecorder, detailRequest, service)
	if detailRecorder.Code != http.StatusOK {
		t.Fatalf("expected gateway GET 200, got %d body=%s", detailRecorder.Code, detailRecorder.Body.String())
	}
	var detail GatewayDetail
	if err := json.Unmarshal(detailRecorder.Body.Bytes(), &detail); err != nil {
		t.Fatalf("decode gateway detail failed: %v", err)
	}
	if detail.Definition.Name != "Source Domain (renamed)" || detail.Definition.Enabled {
		t.Fatalf("expected persisted edit in gateway detail, got %#v", detail.Definition)
	}

	missingRequest := httptest.NewRequest(http.MethodPut, "/api/brain/gateways/GW-NOPE", strings.NewReader(`{"enabled":false}`))
	missingRecorder := httptest.NewRecorder()
	HandleAPI(missingRecorder, missingRequest, service)
	if missingRecorder.Code == http.StatusOK {
		t.Fatalf("expected gateway PUT for unknown code to fail, got %s", missingRecorder.Body.String())
	}

	invalidRequest := httptest.NewRequest(http.MethodPut, "/api/brain/gateways/"+GatewaySourceDomain, strings.NewReader(`{not json`))
	invalidRecorder := httptest.NewRecorder()
	HandleAPI(invalidRecorder, invalidRequest, service)
	if invalidRecorder.Code == http.StatusOK {
		t.Fatalf("expected invalid body to fail, got %s", invalidRecorder.Body.String())
	}
}

func strPtr(value string) *string {
	return &value
}

func boolPtr(value bool) *bool {
	return &value
}

func TestBrainAutonomyMultiCandidatePreparesEveryQualifiedCandidate(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	for index := 0; index < 3; index++ {
		if _, err := service.GenerateSignals("inv-current"); err != nil {
			t.Fatalf("GenerateSignals pass %d failed: %v", index+1, err)
		}
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	initial, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	gap := findSuggestion(t, initial, SuggestionKindGapReview)
	if _, err := service.MarkSuggestionOutcome(gap.ID, SuggestionOutcomeResolved); err != nil {
		t.Fatalf("MarkSuggestionOutcome gap resolved failed: %v", err)
	}
	if _, err := service.UpdateAutonomySettings(BrainAutonomySettings{
		Mode:                            AutonomyModePrepareOnly,
		MaxAutoPreparedPerInvestigation: 5,
		MaxActivePrepared:               5,
	}); err != nil {
		t.Fatalf("UpdateAutonomySettings failed: %v", err)
	}

	suggestions, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation with autonomy failed: %v", err)
	}
	candidates := launchReadyAutonomySuggestions(suggestions)
	if len(candidates) < 2 {
		t.Fatalf("fixture must surface multiple launch-ready candidates for the multi-candidate test, got %d", len(candidates))
	}

	if _, err := service.AutonomyForInvestigation("inv-current"); err != nil {
		t.Fatalf("AutonomyForInvestigation failed: %v", err)
	}

	actions, err := service.FollowUpsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("FollowUpsForInvestigation failed: %v", err)
	}
	if len(actions) != len(candidates) {
		t.Fatalf("expected every qualified candidate to be prepared (multi-candidate), got %d actions for %d candidates: %#v", len(actions), len(candidates), actions)
	}
	preparedSources := map[string]bool{}
	for _, action := range actions {
		if action.Status != FollowUpStatusPrepared {
			t.Fatalf("expected prepared follow-up, got %#v", action)
		}
		preparedSources[action.SourceID] = true
	}
	for _, candidate := range candidates {
		if !preparedSources[candidate.ID] {
			t.Fatalf("expected candidate %s to be prepared, got sources %#v", candidate.ID, preparedSources)
		}
	}

	state, err := service.AutonomyForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AutonomyForInvestigation read failed: %v", err)
	}
	for _, candidate := range candidates {
		item := findAutonomyQueueItem(t, state.Queue, candidate.ID)
		if item.Decision != AutonomyDecisionPrepared || item.ActionID == "" {
			t.Fatalf("expected prepared queue item with action for candidate %s, got %#v", candidate.ID, item)
		}
	}
}

func TestBrainAutonomyMultiCandidateRespectsBudgetAndKeepsPrepared(t *testing.T) {
	root := writeSuggestionFixture(t)
	service := NewService(root)
	for index := 0; index < 3; index++ {
		if _, err := service.GenerateSignals("inv-current"); err != nil {
			t.Fatalf("GenerateSignals pass %d failed: %v", index+1, err)
		}
	}
	if _, err := service.ClustersForInvestigation("inv-current"); err != nil {
		t.Fatalf("ClustersForInvestigation failed: %v", err)
	}
	initial, err := service.SuggestionsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("SuggestionsForInvestigation failed: %v", err)
	}
	gap := findSuggestion(t, initial, SuggestionKindGapReview)
	if _, err := service.MarkSuggestionOutcome(gap.ID, SuggestionOutcomeResolved); err != nil {
		t.Fatalf("MarkSuggestionOutcome gap resolved failed: %v", err)
	}
	if _, err := service.UpdateAutonomySettings(BrainAutonomySettings{
		Mode:                            AutonomyModePrepareOnly,
		MaxAutoPreparedPerInvestigation: 1,
		MaxActivePrepared:               5,
	}); err != nil {
		t.Fatalf("UpdateAutonomySettings failed: %v", err)
	}

	state, err := service.AutonomyForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("AutonomyForInvestigation failed: %v", err)
	}
	preparedCount := 0
	var preparedItem BrainAutonomyQueueItem
	for _, item := range state.Queue {
		if item.Decision == AutonomyDecisionPrepared {
			preparedCount++
			preparedItem = item
		}
	}
	if preparedCount != 1 {
		t.Fatalf("expected investigation budget to cap preparation at one, got %d prepared items: %#v", preparedCount, state.Queue)
	}

	// A second evaluation pass (next evidence event) must not flip the
	// prepared item to blocked on its own now-existing follow-up.
	state, err = service.AutonomyForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("second AutonomyForInvestigation failed: %v", err)
	}
	var stillPrepared BrainAutonomyQueueItem
	for _, item := range state.Queue {
		if item.SuggestionID == preparedItem.SuggestionID {
			stillPrepared = item
		}
	}
	if stillPrepared.Decision != AutonomyDecisionPrepared || stillPrepared.Status != AutonomyQueueStatusPrepared || stillPrepared.ActionID != preparedItem.ActionID {
		t.Fatalf("expected prepared item to survive re-evaluation, got %#v (was %#v)", stillPrepared, preparedItem)
	}
	actions, err := service.FollowUpsForInvestigation("inv-current")
	if err != nil {
		t.Fatalf("FollowUpsForInvestigation failed: %v", err)
	}
	if len(actions) != 1 {
		t.Fatalf("expected budget to keep exactly one prepared follow-up across passes, got %#v", actions)
	}
}
