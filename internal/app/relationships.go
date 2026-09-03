package app

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/internal/investigations"
	"github.com/Andyi955/Gorantula/internal/pipeline"
	"github.com/Andyi955/Gorantula/internal/synthesis"
	"github.com/Andyi955/Gorantula/models"
)

var activeConnectDotsClaims sync.Map

func connectDotsClaimKey(meta pipeline.RunMetadata) string {
	runID := strings.TrimSpace(meta.RunID)
	if runID == "" {
		return ""
	}

	vaultID := strings.TrimSpace(meta.VaultID)
	return vaultID + "::" + runID
}

func claimConnectDotsRun(meta pipeline.RunMetadata) (func(), bool) {
	key := connectDotsClaimKey(meta)
	if key == "" {
		return func() {}, true
	}

	if _, loaded := activeConnectDotsClaims.LoadOrStore(key, struct{}{}); loaded {
		return func() {}, false
	}

	var releaseOnce sync.Once
	return func() {
		releaseOnce.Do(func() {
			activeConnectDotsClaims.Delete(key)
		})
	}, true
}

func resetActiveConnectDotsClaimsForTest() {
	activeConnectDotsClaims.Range(func(key, value interface{}) bool {
		activeConnectDotsClaims.Delete(key)
		return true
	})
}

func filterConnectionsByPendingNodeIDs(connections []models.BoardConnection, pendingNodeIDs []string) []models.BoardConnection {
	if len(pendingNodeIDs) == 0 {
		return connections
	}

	pendingNodeIDSet := make(map[string]struct{}, len(pendingNodeIDs))
	for _, nodeID := range pendingNodeIDs {
		pendingNodeIDSet[nodeID] = struct{}{}
	}

	filtered := make([]models.BoardConnection, 0, len(connections))
	for _, connection := range connections {
		if _, ok := pendingNodeIDSet[connection.Source]; ok {
			filtered = append(filtered, connection)
			continue
		}
		if _, ok := pendingNodeIDSet[connection.Target]; ok {
			filtered = append(filtered, connection)
		}
	}

	return filtered
}

func filterNodesByIDs(nodes []models.MemoryNode, nodeIDs []string) []models.MemoryNode {
	if len(nodeIDs) == 0 {
		return append([]models.MemoryNode(nil), nodes...)
	}

	nodeIDSet := make(map[string]struct{}, len(nodeIDs))
	for _, nodeID := range nodeIDs {
		nodeIDSet[nodeID] = struct{}{}
	}

	filtered := make([]models.MemoryNode, 0, len(nodeIDs))
	for _, node := range nodes {
		if _, ok := nodeIDSet[node.ID]; ok {
			filtered = append(filtered, node)
		}
	}

	return filtered
}

func annotateConnectionsForVault(connections []models.BoardConnection, vaultID, runID string) []models.BoardConnection {
	annotated := make([]models.BoardConnection, len(connections))
	copy(annotated, connections)
	for idx := range annotated {
		annotated[idx].VaultID = strings.TrimSpace(vaultID)
		annotated[idx].RunID = strings.TrimSpace(runID)
	}
	return annotated
}

func relationshipDebugSummary(debugRun models.RelationshipDebugRun) string {
	if len(debugRun.Notes) == 0 {
		return "none"
	}
	return strings.Join(debugRun.Notes, "; ")
}

func buildRelationshipResult(vaultID string, runID string, incremental bool, pendingNodeIDs []string, connections []models.BoardConnection) models.RelationshipResult {
	result := models.RelationshipResult{
		VaultID:        vaultID,
		RunID:          strings.TrimSpace(runID),
		CreatedAt:      time.Now().UTC().Format(time.RFC3339Nano),
		Incremental:    incremental,
		PendingNodeIDs: append([]string(nil), pendingNodeIDs...),
		Connections:    append([]models.BoardConnection(nil), connections...),
	}
	if result.Connections == nil {
		result.Connections = []models.BoardConnection{}
	}
	if result.PendingNodeIDs == nil {
		result.PendingNodeIDs = []string{}
	}
	return result
}

func triggerConnectDotsAnalysis(br *brain.Brain, vaultID string, nodes []models.MemoryNode, pendingNodeIDs []string, meta pipeline.RunMetadata) {
	releaseConnectDotsClaim, claimed := claimConnectDotsRun(meta)
	if !claimed {
		appLog("relationships").Warn("ignoring duplicate connect dots request", "vault", meta.VaultID, "run", meta.RunID)
		return
	}

	tracker := pipeline.GetTracker(meta, models.DefaultPipelineProgressSteps())
	ctx, cancel := context.WithCancel(context.Background())
	pipeline.RegisterCancellation(meta, cancel)

	go func() {
		shouldForgetCancellation := true
		defer func() {
			if shouldForgetCancellation {
				pipeline.ForgetCancellation(meta.RunID)
				releaseConnectDotsClaim()
			}
		}()
		isIncremental := len(pendingNodeIDs) > 0
		if isIncremental {
			appLog("relationships").Info("dispatching incremental persona analysis", "vault", vaultID, "run", meta.RunID, "nodes", len(nodes), "pending_nodes", len(pendingNodeIDs))
		} else {
			appLog("relationships").Info("dispatching persona analysis", "vault", vaultID, "run", meta.RunID, "nodes", len(nodes))
		}

		broadcast(tracker.Start("persona_analysis", "Running multi-agent persona analysis"))
		broadcast(models.WSMessage{Type: "BRAIN_STATE", Payload: "Running multi-agent persona analysis..."})

		var (
			insights []brain.PersonaInsight
			err      error
		)
		tracker.StartSpan("persona_fanout", "persona_analysis", "Persona fanout", fmt.Sprintf("running %d personas", len(brain.GetDefaultPersonas())))
		if isIncremental {
			insights, err = br.AnalyzeIncrementalWithPersonasWithProgress(ctx, vaultID, nodes, pendingNodeIDs, tracker)
		} else {
			insights, err = br.AnalyzeWithPersonasWithProgress(ctx, vaultID, nodes, tracker)
		}
		tracker.CompleteSpan("persona_fanout", fmt.Sprintf("generated %d persona insight sets", len(insights)))
		if err != nil {
			if pipeline.IsCancellationError(err) {
				broadcastPipelineCancelled(tracker, "Stopped by operator")
				pipeline.ForgetTracker(meta.RunID)
				return
			}
			appLog("relationships").Error("persona analysis failed", "vault", vaultID, "run", meta.RunID, "incremental", isIncremental, "err", err)
			broadcast(tracker.Error("persona_analysis", err.Error()))
			saveAndBroadcastPipelineProfile(tracker)
			pipeline.ForgetTracker(meta.RunID)
			broadcast(models.WSMessage{Type: "ERROR", Payload: "Persona analysis failed: " + err.Error()})

			connections, fallbackErr := br.AnalyzeConnections(ctx, nodes)
			if fallbackErr != nil {
				broadcast(models.WSMessage{Type: "ERROR", Payload: "AI analysis failed: " + fallbackErr.Error()})
			} else {
				validatedConnections, debugRun := br.ValidateFallbackConnections(vaultID, nodes, connections)
				if isIncremental {
					validatedConnections = filterConnectionsByPendingNodeIDs(validatedConnections, pendingNodeIDs)
				}
				validatedConnections = annotateConnectionsForVault(validatedConnections, vaultID, meta.RunID)
				appLog("relationships").Info(
					"fallback relationship workflow complete",
					"vault", vaultID,
					"run", meta.RunID,
					"nodes", len(nodes),
					"candidates", len(debugRun.Candidates),
					"accepted", len(validatedConnections),
					"notes", relationshipDebugSummary(debugRun),
				)
				result := buildRelationshipResult(vaultID, meta.RunID, isIncremental, pendingNodeIDs, validatedConnections)
				investigations.SaveRelationshipResult(result)
				broadcast(models.WSMessage{Type: "CONNECTIONS_FOUND", Payload: result})
			}
			return
		}

		for _, insight := range insights {
			appLog("relationships").Info("persona insight generated", "vault", vaultID, "run", meta.RunID, "persona", insight.PersonaName, "node_ids", insight.NodeIDs, "key_findings", len(insight.KeyFindings))
		}

		broadcast(models.WSMessage{Type: "PERSONA_INSIGHTS", Payload: insights})
		broadcast(tracker.Complete("persona_analysis", synthesis.PersonaAnalysisCompletionDetail(len(insights), len(brain.GetDefaultPersonas()))))
		tracker.RecordCounter("personaInsightSets", len(insights))
		saveAndBroadcastPipelineProfile(tracker)

		overlapCandidateNodes := nodes
		if isIncremental {
			overlapCandidateNodes = filterNodesByIDs(nodes, pendingNodeIDs)
		}

		appLog("relationships").Info("triggering overlap scan", "vault", vaultID, "run", meta.RunID, "candidate_nodes", len(overlapCandidateNodes), "total_nodes", len(nodes))
		broadcast(tracker.Start("overlap_scan", "Scanning for cross-case overlap"))
		if len(overlapCandidateNodes) > 0 && len(nodes) > 0 {
			go br.Synthesis.AnalyzeOverlap(ctx, vaultID, overlapCandidateNodes, nodes, br)
		}
		broadcast(tracker.Complete("overlap_scan", "Unified theory scan queued"))

		broadcast(tracker.Start("relationship_synthesis", "Synthesizing evidence relationships"))
		broadcast(models.WSMessage{Type: "BRAIN_STATE", Payload: "Synthesizing persona insights..."})

		var connections []models.BoardConnection
		var debugRun models.RelationshipDebugRun
		relationshipCtx, relationshipScopeID := br.StartPipelineTokenScope(ctx, "pipeline-relationships", "relationship_synthesis")
		tracker.StartSpan("relationship_generation", "relationship_synthesis", "Relationship synthesis", fmt.Sprintf("linking %d nodes", len(nodes)))
		if isIncremental {
			connections, debugRun, err = br.RunIncrementalRelationshipWorkflow(relationshipCtx, vaultID, nodes, pendingNodeIDs, insights)
		} else {
			connections, debugRun, err = br.RunRelationshipWorkflow(relationshipCtx, vaultID, nodes, insights)
		}
		tracker.CompleteSpan("relationship_generation", fmt.Sprintf("found %d relationships", len(connections)))
		br.RecordPipelineTokenUsage(tracker, relationshipScopeID)
		if err != nil {
			if pipeline.IsCancellationError(err) {
				broadcastPipelineCancelled(tracker, "Stopped by operator")
				pipeline.ForgetTracker(meta.RunID)
				return
			}
			// A provider failure in the synthesis step (empty or truncated
			// LLM bodies under load) must not destroy an otherwise-complete
			// scan: degrade to zero synthesized relationships and finish the
			// run instead of surfacing a System Error.
			appLog("relationships").Warn(
				"relationship workflow failed; completing the run without synthesized connections",
				"vault", vaultID,
				"run", meta.RunID,
				"incremental", isIncremental,
				"err", models.SanitizePipelineDiagnosticText(err.Error()),
			)
			broadcast(tracker.Complete("relationship_synthesis", "Synthesis unavailable - no relationship suggestions this run"))
			connections = nil
			debugRun = models.RelationshipDebugRun{}
		}
		connections = annotateConnectionsForVault(connections, vaultID, meta.RunID)

		appLog("relationships").Info(
			"relationship workflow complete",
			"vault", vaultID,
			"run", meta.RunID,
			"incremental", isIncremental,
			"nodes", len(nodes),
			"pending_nodes", len(pendingNodeIDs),
			"candidates", len(debugRun.Candidates),
			"accepted", len(connections),
			"notes", relationshipDebugSummary(debugRun),
		)
		appLog("relationships").Info("broadcasting relationship connections", "vault", vaultID, "run", meta.RunID, "connections", len(connections))
		broadcast(tracker.Complete("relationship_synthesis", fmt.Sprintf("Found %d relationships", len(connections))))
		tracker.RecordCounter("relationships", len(connections))
		result := buildRelationshipResult(vaultID, meta.RunID, isIncremental, pendingNodeIDs, connections)
		investigations.SaveRelationshipResult(result)
		broadcast(models.WSMessage{Type: "CONNECTIONS_FOUND", Payload: result})
		saveAndBroadcastPipelineProfile(tracker)

		if isIncremental {
			broadcast(tracker.Complete("complete", "Incremental integration complete"))
			saveAndBroadcastPipelineProfile(tracker)
			pipeline.ForgetTracker(meta.RunID)
			return
		}

		nodesSnapshot := append([]models.MemoryNode(nil), nodes...)
		insightsSnapshot := append([]brain.PersonaInsight(nil), insights...)
		shouldForgetCancellation = false
		go func(vaultID string, nodes []models.MemoryNode, insights []brain.PersonaInsight) {
			defer pipeline.ForgetCancellation(meta.RunID)
			defer releaseConnectDotsClaim()
			broadcast(tracker.Start("discovery_review", "Reviewing breakthrough candidates"))
			discoveryCtx, discoveryScopeID := br.StartPipelineTokenScope(ctx, "pipeline-discovery", "discovery_synthesis")
			tracker.StartSpan("discovery_synthesis", "discovery_review", "Discovery candidate synthesis", fmt.Sprintf("reviewing %d nodes", len(nodes)))
			candidateDiscoveries, err := br.SynthesizeDiscoveries(discoveryCtx, vaultID, nodes, insights)
			tracker.CompleteSpan("discovery_synthesis", fmt.Sprintf("generated %d candidate discoveries", len(candidateDiscoveries)))
			br.RecordPipelineTokenUsage(tracker, discoveryScopeID)
			if err != nil {
				if pipeline.IsCancellationError(err) {
					broadcastPipelineCancelled(tracker, "Stopped by operator")
					pipeline.ForgetTracker(meta.RunID)
					return
				}
				appLog("relationships").Error("discovery synthesis failed", "vault", vaultID, "run", meta.RunID, "err", err)
				broadcast(tracker.Error("discovery_review", err.Error()))
				saveAndBroadcastPipelineProfile(tracker)
				pipeline.ForgetTracker(meta.RunID)
				return
			}
			tracker.RecordCounter("discoveryCandidates", len(candidateDiscoveries))

			reviewCtx, reviewScopeID := br.StartPipelineTokenScope(ctx, "pipeline-discovery-review", "discovery_review")
			tracker.StartSpan("discovery_candidate_review", "discovery_review", "Discovery expert review", fmt.Sprintf("reviewing %d candidates", len(candidateDiscoveries)))
			discoveries, err := br.ReviewDiscoveryCandidates(reviewCtx, candidateDiscoveries, nodes)
			tracker.CompleteSpan("discovery_candidate_review", fmt.Sprintf("approved %d discoveries", len(discoveries)))
			br.RecordPipelineTokenUsage(tracker, reviewScopeID)
			if err != nil {
				if pipeline.IsCancellationError(err) {
					broadcastPipelineCancelled(tracker, "Stopped by operator")
					pipeline.ForgetTracker(meta.RunID)
					return
				}
				appLog("relationships").Error("discovery review failed", "vault", vaultID, "run", meta.RunID, "err", err)
				broadcast(tracker.Error("discovery_review", err.Error()))
				saveAndBroadcastPipelineProfile(tracker)
				pipeline.ForgetTracker(meta.RunID)
				return
			}

			if len(discoveries) > 0 {
				broadcast(models.WSMessage{Type: "DISCOVERIES_FOUND", Payload: discoveries})
			}
			tracker.RecordCounter("discoveries", len(discoveries))
			broadcast(tracker.Complete("discovery_review", fmt.Sprintf("Approved %d discoveries", len(discoveries))))
			broadcast(tracker.Complete("complete", "Pipeline complete"))
			saveAndBroadcastPipelineProfile(tracker)
			pipeline.ForgetTracker(meta.RunID)
		}(vaultID, nodesSnapshot, insightsSnapshot)
	}()
}
