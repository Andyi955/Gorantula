package brainmemory

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"spider-agent/models"
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

	request = httptest.NewRequest(http.MethodPut, "/api/brain/clusters/missing/pin", nil)
	recorder = httptest.NewRecorder()
	HandleAPI(recorder, request, service)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected missing cluster to return 404, got %d", recorder.Code)
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
