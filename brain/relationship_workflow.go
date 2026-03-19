package brain

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"spider-agent/models"
)

const (
	relationshipCandidateConfidenceFloor = 0.50
	relationshipQualityThreshold         = 0.66
)

var (
	relationshipNumberPattern = regexp.MustCompile(`\b\d[\d,]*(?:\.\d+)?(?:%|x|tb|gb|mb|kb|m|b|k)?\b`)
	relationshipYearPattern   = regexp.MustCompile(`\b(?:19|20)\d{2}\b`)
	relationshipWordPattern   = regexp.MustCompile(`[a-z0-9]+`)
)

type relationshipCandidateJSONResponse struct {
	Connections []models.RelationshipCandidate `json:"connections"`
}

func (b *Brain) RunRelationshipWorkflow(ctx context.Context, vaultID string, nodes []models.MemoryNode, insights []PersonaInsight) ([]models.BoardConnection, models.RelationshipDebugRun, error) {
	debugRun := models.RelationshipDebugRun{
		VaultID:   vaultID,
		CreatedAt: time.Now().Format(time.RFC3339),
		Stage:     "starting",
	}
	for _, node := range nodes {
		debugRun.InputNodes = append(debugRun.InputNodes, models.RelationshipDebugNode{
			ID:       node.ID,
			Title:    node.Title,
			Summary:  node.Summary,
			FullText: node.FullText,
		})
	}
	for _, insight := range insights {
		debugRun.PersonaSummaries = append(debugRun.PersonaSummaries, models.RelationshipDebugPersona{
			PersonaName: insight.PersonaName,
			Confidence:  insight.Confidence,
			NodeIDs:     append([]string(nil), insight.NodeIDs...),
			KeyFindings: append([]string(nil), insight.KeyFindings...),
			Connections: append([]string(nil), insight.Connections...),
			Questions:   append([]string(nil), insight.Questions...),
			ProposedConnections: mapPersonaProposals(insight.ProposedConnections, insight.PersonaName),
		})
	}

	candidates, err := b.GenerateRelationshipCandidates(ctx, nodes, insights)
	if err != nil {
		return nil, debugRun, err
	}
	debugRun.Stage = "candidate_generation_complete"

	finalConnections, scoredCandidates, notes := validateAndRankRelationshipCandidates(nodes, candidates)
	debugRun.Candidates = scoredCandidates
	debugRun.FinalConnections = finalConnections
	debugRun.Notes = notes
	debugRun.Stage = "completed"

	if err := writeRelationshipDebugTrace(debugRun); err != nil {
		debugRun.Notes = append(debugRun.Notes, "trace_write_failed="+err.Error())
	}

	return finalConnections, debugRun, nil
}

func (b *Brain) ValidateFallbackConnections(vaultID string, nodes []models.MemoryNode, connections []models.BoardConnection) ([]models.BoardConnection, models.RelationshipDebugRun) {
	debugRun := models.RelationshipDebugRun{
		VaultID:   vaultID,
		CreatedAt: time.Now().Format(time.RFC3339),
		Stage:     "fallback_validation_complete",
		Notes:     []string{"fallback_path=AnalyzeConnections"},
	}
	for _, node := range nodes {
		debugRun.InputNodes = append(debugRun.InputNodes, models.RelationshipDebugNode{
			ID:       node.ID,
			Title:    node.Title,
			Summary:  node.Summary,
			FullText: node.FullText,
		})
	}

	candidates := make([]models.RelationshipCandidate, 0, len(connections))
	for _, connection := range connections {
		candidates = append(candidates, models.RelationshipCandidate{
			Source:          connection.Source,
			Target:          connection.Target,
			Tag:             connection.Tag,
			Reasoning:       connection.Reasoning,
			Confidence:      maxFloat32(connection.Confidence, 0.72),
			EvidenceNodeIDs: []string{connection.Source, connection.Target},
			CandidateSource: "fallback",
		})
	}

	finalConnections, scoredCandidates, notes := validateAndRankRelationshipCandidates(nodes, candidates)
	debugRun.Candidates = scoredCandidates
	debugRun.FinalConnections = finalConnections
	debugRun.Notes = append(debugRun.Notes, notes...)

	if err := writeRelationshipDebugTrace(debugRun); err != nil {
		debugRun.Notes = append(debugRun.Notes, "trace_write_failed="+err.Error())
	}

	return finalConnections, debugRun
}

func (b *Brain) GenerateRelationshipCandidates(ctx context.Context, nodes []models.MemoryNode, insights []PersonaInsight) ([]models.RelationshipCandidate, error) {
	nodeLookup := make(map[string]models.MemoryNode, len(nodes))
	for _, node := range nodes {
		nodeLookup[node.ID] = node
	}

	candidateMap := make(map[string]models.RelationshipCandidate)
	for _, insight := range insights {
		for _, proposal := range insight.ProposedConnections {
			candidate := normalizeRelationshipCandidate(models.RelationshipCandidate{
				Source:             proposal.Source,
				Target:             proposal.Target,
				Tag:                proposal.Tag,
				Reasoning:          proposal.Reasoning,
				Confidence:         proposal.Confidence,
				EvidenceNodeIDs:    append([]string(nil), proposal.EvidenceNodeIDs...),
				SupportingPersonas: []string{insight.PersonaName},
				CandidateSource:    "persona:" + insight.PersonaName,
			}, nodeLookup)
			if candidate.Source == "" || candidate.Target == "" || candidate.Tag == "" {
				continue
			}
			mergeRelationshipCandidate(candidateMap, candidate)
		}
	}

	synthesized, err := b.generateSynthesizedRelationshipCandidates(ctx, nodes, insights)
	if err != nil {
		return nil, err
	}
	for _, candidate := range synthesized {
		mergeRelationshipCandidate(candidateMap, normalizeRelationshipCandidate(candidate, nodeLookup))
	}

	candidates := make([]models.RelationshipCandidate, 0, len(candidateMap))
	for _, candidate := range candidateMap {
		if candidate.Source == "" || candidate.Target == "" || candidate.Tag == "" {
			continue
		}
		if candidate.Confidence < relationshipCandidateConfidenceFloor {
			continue
		}
		candidates = append(candidates, candidate)
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].Confidence == candidates[j].Confidence {
			return relationshipCandidateKey(candidates[i]) < relationshipCandidateKey(candidates[j])
		}
		return candidates[i].Confidence > candidates[j].Confidence
	})

	return candidates, nil
}

func (b *Brain) generateSynthesizedRelationshipCandidates(ctx context.Context, nodes []models.MemoryNode, insights []PersonaInsight) ([]models.RelationshipCandidate, error) {
	provider := b.GetSearchProvider()
	if provider == nil {
		return nil, fmt.Errorf("no model providers available")
	}

	var nodeBuilder strings.Builder
	for _, node := range nodes {
		nodeBuilder.WriteString(fmt.Sprintf("[NodeID: %s]\nTitle: %s\nSummary: %s\nFull Text: %s\n\n", node.ID, node.Title, node.Summary, node.FullText))
	}

	var insightBuilder strings.Builder
	for _, insight := range insights {
		insightBuilder.WriteString(fmt.Sprintf("[%s]\nConfidence: %.2f\nObservations: %s\nHypotheses: %s\nConnections: %s\nAnalysis: %s\nNodeIDs: %s\n\n",
			insight.PersonaName,
			insight.Confidence,
			strings.Join(insight.Observations, " | "),
			strings.Join(insight.Hypotheses, " | "),
			strings.Join(insight.Connections, " | "),
			insight.FullAnalysis,
			strings.Join(insight.NodeIDs, ", "),
		))
	}

	prompt := fmt.Sprintf(`You are a relationship synthesis engine for an investigation board.
Generate candidate relationships from the evidence and persona outputs.

Rules:
1. Only propose relationships grounded in exact node IDs.
2. Prefer direct evidence from the node text over broad narrative framing.
3. Use concise uppercase tags of 1-3 words.
4. Avoid generic connections like RELATED unless no better grounded tag exists.
5. Do not force a fixed count; return only meaningful candidates.
6. Do not mention facts, dates, or entities that are not explicitly present in the cited evidence nodes.
7. Avoid interpretive leap language such as "drives", "catalyst", "underpins", "leads to", "signals", "explains", "reflects", or "high-stakes" unless the evidence text explicitly supports that causal claim.
8. Prefer literal evidence relationships like OUTPERFORMS, USES, IMPLEMENTS, REFERENCES, RESPONDS_TO, or DEPENDS_ON over broad strategic phrasing.
9. If the evidence only suggests a thematic analogy, do not emit a connection.

Return ONLY valid JSON:
{
  "connections": [
    {
      "source": "node-id",
      "target": "node-id",
      "tag": "TAG",
      "reasoning": "one sober sentence grounded in the evidence",
      "confidence": 0.0,
      "evidenceNodeIDs": ["node-id-1", "node-id-2"],
      "supportingPersonas": ["Persona Name"],
      "candidateSource": "synthesis"
    }
  ]
}

Node mapping:
%s

Evidence:
%s

Persona outputs:
%s`, buildNodeMapping(nodes), nodeBuilder.String(), insightBuilder.String())

	var response relationshipCandidateJSONResponse
	if err := provider.GenerateJSON(ctx, prompt, &response); err != nil {
		return nil, fmt.Errorf("failed to synthesize relationship candidates: %w", err)
	}

	return response.Connections, nil
}

func validateAndRankRelationshipCandidates(nodes []models.MemoryNode, candidates []models.RelationshipCandidate) ([]models.BoardConnection, []models.RelationshipCandidate, []string) {
	nodeLookup := make(map[string]models.MemoryNode, len(nodes))
	for _, node := range nodes {
		nodeLookup[node.ID] = node
	}

	seenAccepted := make(map[string]bool)
	seenAcceptedPairs := make(map[string]models.RelationshipCandidate)
	seenMirror := make(map[string]bool)
	finalConnections := make([]models.BoardConnection, 0, len(candidates))
	scoredCandidates := make([]models.RelationshipCandidate, 0, len(candidates))
	notes := []string{}

	for _, candidate := range candidates {
		normalized := normalizeRelationshipCandidate(candidate, nodeLookup)
		status := "accepted"
		reason := ""

		if normalized.Source == normalized.Target {
			status = "rejected"
			reason = "self_link"
		}
		if status == "accepted" {
			if _, ok := nodeLookup[normalized.Source]; !ok {
				status = "rejected"
				reason = "missing_source_node"
			}
		}
		if status == "accepted" {
			if _, ok := nodeLookup[normalized.Target]; !ok {
				status = "rejected"
				reason = "missing_target_node"
			}
		}

		agreementScore := relationshipAgreementScore(normalized)
		evidenceScore := relationshipEvidenceScore(normalized)
		specificityScore := relationshipSpecificityScore(normalized.Tag, normalized.Reasoning)
		groundingScore := relationshipGroundingScore(normalized, nodeLookup)
		qualityScore := (agreementScore * 0.25) + (evidenceScore * 0.30) + (specificityScore * 0.20) + (groundingScore * 0.25)
		qualityScore += relationshipSemanticPriorityAdjustment(normalized)
		if qualityScore > 1.0 {
			qualityScore = 1.0
		}
		if qualityScore < 0.0 {
			qualityScore = 0.0
		}

		normalized.AgreementScore = agreementScore
		normalized.EvidenceScore = evidenceScore
		normalized.SpecificityScore = specificityScore
		normalized.GroundingScore = groundingScore
		normalized.QualityScore = qualityScore

		if status == "accepted" && looksGenericRelationshipTag(normalized.Tag, normalized.Reasoning) {
			status = "rejected"
			reason = "generic_relationship"
		}
		if status == "accepted" && isHighRiskInfrastructureRelationship(normalized, nodeLookup) {
			status = "rejected"
			reason = "unsupported_infrastructure_claim"
		}
		if status == "accepted" && containsUnsupportedRelationshipReferences(normalized, nodeLookup) {
			status = "rejected"
			reason = "unsupported_reference"
		}
		if status == "accepted" && containsInterpretiveRelationshipLanguage(normalized, nodeLookup) {
			status = "rejected"
			reason = "interpretive_leap"
		}
		if status == "accepted" && requiresStrongerSupport(normalized) && len(stringsToUniqueList(normalized.SupportingPersonas)) < 2 {
			status = "rejected"
			reason = "low_support_interpretive"
		}
		if status == "accepted" && isBroadSupportTag(normalized.Tag) && len(stringsToUniqueList(normalized.SupportingPersonas)) < 3 {
			status = "rejected"
			reason = "low_support_broad"
		}
		if status == "accepted" && qualityScore < relationshipQualityThreshold {
			status = "rejected"
			reason = "quality_below_threshold"
		}

		key := relationshipCandidateKey(normalized)
		pairKey := relationshipPairKey(normalized)
		mirrorKey := relationshipMirrorKey(normalized)
		if status == "accepted" && seenAccepted[key] {
			status = "rejected"
			reason = "duplicate_relationship"
		}
		if status == "accepted" {
			if existing, ok := seenAcceptedPairs[pairKey]; ok {
				if relationshipsAreSemanticallyOverlapping(existing, normalized) {
					status = "rejected"
					reason = "overlapping_pair_relationship"
				}
			}
		}
		if status == "accepted" && seenMirror[mirrorKey] {
			status = "rejected"
			reason = "mirrored_duplicate"
		}

		normalized.ValidationStatus = status
		normalized.RejectionReason = reason
		scoredCandidates = append(scoredCandidates, normalized)

		if status != "accepted" {
			continue
		}

		seenAccepted[key] = true
		seenAcceptedPairs[pairKey] = normalized
		seenMirror[mirrorKey] = true
		finalConnections = append(finalConnections, models.BoardConnection{
			Source:             normalized.Source,
			Target:             normalized.Target,
			Tag:                normalized.Tag,
			Reasoning:          normalized.Reasoning,
			Confidence:         normalized.Confidence,
			QualityScore:       normalized.QualityScore,
			SupportingPersonas: append([]string(nil), normalized.SupportingPersonas...),
			EvidenceNodeIDs:    append([]string(nil), normalized.EvidenceNodeIDs...),
			ValidationStatus:   normalized.ValidationStatus,
			CandidateSources:   stringsToUniqueList(append([]string{normalized.CandidateSource}, normalized.SupportingPersonas...)),
		})
	}

	sort.SliceStable(finalConnections, func(i, j int) bool {
		if finalConnections[i].QualityScore == finalConnections[j].QualityScore {
			return finalConnections[i].Tag < finalConnections[j].Tag
		}
		return finalConnections[i].QualityScore > finalConnections[j].QualityScore
	})

	prunedConnections, budgetNotes, prunedKeys := pruneConnectionsForBoardReadability(nodes, finalConnections)
	if len(prunedKeys) > 0 {
		for idx, candidate := range scoredCandidates {
			if candidate.ValidationStatus != "accepted" {
				continue
			}
			if _, ok := prunedKeys[relationshipCandidateKey(candidate)]; ok {
				scoredCandidates[idx].ValidationStatus = "rejected"
				scoredCandidates[idx].RejectionReason = "board_readability_budget"
			}
		}
	}
	finalConnections = prunedConnections

	sort.SliceStable(scoredCandidates, func(i, j int) bool {
		if scoredCandidates[i].QualityScore == scoredCandidates[j].QualityScore {
			return relationshipCandidateKey(scoredCandidates[i]) < relationshipCandidateKey(scoredCandidates[j])
		}
		return scoredCandidates[i].QualityScore > scoredCandidates[j].QualityScore
	})

	notes = append(notes, budgetNotes...)
	notes = append(notes, fmt.Sprintf("accepted_connections=%d", len(finalConnections)))
	notes = append(notes, fmt.Sprintf("candidate_count=%d", len(scoredCandidates)))

	return finalConnections, scoredCandidates, notes
}

func pruneConnectionsForBoardReadability(nodes []models.MemoryNode, connections []models.BoardConnection) ([]models.BoardConnection, []string, map[string]struct{}) {
	if len(connections) == 0 {
		return connections, nil, nil
	}

	maxConnections := maxBoardConnections(len(nodes))
	maxPerNode := maxConnectionsPerNode(len(nodes))
	if len(connections) <= maxConnections {
		return connections, []string{
			fmt.Sprintf("board_readability_budget=max_connections:%d", maxConnections),
			fmt.Sprintf("board_readability_budget=max_connections_per_node:%d", maxPerNode),
		}, nil
	}

	pruned := make([]models.BoardConnection, 0, minInt(len(connections), maxConnections))
	nodeDegree := make(map[string]int)
	prunedKeys := make(map[string]struct{})

	for _, connection := range connections {
		if len(pruned) >= maxConnections {
			prunedKeys[relationshipCandidateKey(models.RelationshipCandidate{
				Source: connection.Source,
				Target: connection.Target,
				Tag:    connection.Tag,
			})] = struct{}{}
			continue
		}
		if nodeDegree[connection.Source] >= maxPerNode || nodeDegree[connection.Target] >= maxPerNode {
			prunedKeys[relationshipCandidateKey(models.RelationshipCandidate{
				Source: connection.Source,
				Target: connection.Target,
				Tag:    connection.Tag,
			})] = struct{}{}
			continue
		}

		pruned = append(pruned, connection)
		nodeDegree[connection.Source]++
		nodeDegree[connection.Target]++
	}

	notes := []string{
		fmt.Sprintf("board_readability_budget=max_connections:%d", maxConnections),
		fmt.Sprintf("board_readability_budget=max_connections_per_node:%d", maxPerNode),
		fmt.Sprintf("board_readability_budget=pruned_connections:%d", len(prunedKeys)),
	}
	return pruned, notes, prunedKeys
}

func maxBoardConnections(nodeCount int) int {
	switch {
	case nodeCount <= 4:
		return 4
	case nodeCount <= 8:
		return 6
	case nodeCount <= 12:
		return 8
	default:
		return 10
	}
}

func maxConnectionsPerNode(nodeCount int) int {
	if nodeCount <= 8 {
		return 2
	}
	return 3
}

func writeRelationshipDebugTrace(debugRun models.RelationshipDebugRun) error {
	logDir := filepath.Join("abdomen_vault", "relationship_logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return err
	}

	filename := fmt.Sprintf("%s-%s.txt", sanitizeRelationshipLogSlug(debugRun.VaultID), time.Now().Format("20060102-150405"))
	logPath := filepath.Join(logDir, filename)

	var builder strings.Builder
	builder.WriteString("GORANTULA RELATIONSHIP DEBUG TRACE\n")
	builder.WriteString(fmt.Sprintf("Generated: %s\n", debugRun.CreatedAt))
	builder.WriteString(fmt.Sprintf("Vault: %s\n", debugRun.VaultID))
	builder.WriteString(fmt.Sprintf("Stage: %s\n\n", debugRun.Stage))

	builder.WriteString("=== Input Nodes ===\n")
	for _, node := range debugRun.InputNodes {
		builder.WriteString(fmt.Sprintf("[%s] %s\n", node.ID, node.Title))
		builder.WriteString(fmt.Sprintf("Summary: %s\n", node.Summary))
		builder.WriteString(fmt.Sprintf("FullText: %s\n\n", node.FullText))
	}

	builder.WriteString("=== Persona Summaries ===\n")
	for _, persona := range debugRun.PersonaSummaries {
		builder.WriteString(fmt.Sprintf("[%s] confidence=%.2f nodeIDs=%s\n", persona.PersonaName, persona.Confidence, strings.Join(persona.NodeIDs, ", ")))
		builder.WriteString(fmt.Sprintf("KeyFindings: %s\n", strings.Join(persona.KeyFindings, " | ")))
		builder.WriteString(fmt.Sprintf("Connections: %s\n", strings.Join(persona.Connections, " | ")))
		for _, proposal := range persona.ProposedConnections {
			builder.WriteString(fmt.Sprintf("Proposed: %s -> %s [%s] %.2f | %s\n", proposal.Source, proposal.Target, proposal.Tag, proposal.Confidence, proposal.Reasoning))
		}
		builder.WriteString("\n")
	}

	builder.WriteString("=== Candidates ===\n")
	for _, candidate := range debugRun.Candidates {
		builder.WriteString(fmt.Sprintf("%s -> %s [%s] status=%s quality=%.2f reason=%s\n", candidate.Source, candidate.Target, candidate.Tag, candidate.ValidationStatus, candidate.QualityScore, candidate.RejectionReason))
		builder.WriteString(fmt.Sprintf("Reasoning: %s\n", candidate.Reasoning))
		builder.WriteString(fmt.Sprintf("Personas: %s | EvidenceNodes: %s\n\n", strings.Join(candidate.SupportingPersonas, ", "), strings.Join(candidate.EvidenceNodeIDs, ", ")))
	}

	builder.WriteString("=== Final Connections ===\n")
	for _, connection := range debugRun.FinalConnections {
		builder.WriteString(fmt.Sprintf("%s -> %s [%s] confidence=%.2f quality=%.2f\n", connection.Source, connection.Target, connection.Tag, connection.Confidence, connection.QualityScore))
		builder.WriteString(fmt.Sprintf("Reasoning: %s\n", connection.Reasoning))
		builder.WriteString(fmt.Sprintf("Personas: %s | EvidenceNodes: %s\n\n", strings.Join(connection.SupportingPersonas, ", "), strings.Join(connection.EvidenceNodeIDs, ", ")))
	}

	if len(debugRun.Notes) > 0 {
		builder.WriteString("=== Notes ===\n")
		for _, note := range debugRun.Notes {
			builder.WriteString("- " + note + "\n")
		}
	}

	return os.WriteFile(logPath, []byte(builder.String()), 0o644)
}

func sanitizeRelationshipLogSlug(input string) string {
	input = strings.ToLower(strings.TrimSpace(input))
	input = strings.ReplaceAll(input, " ", "-")
	input = regexp.MustCompile(`[^a-z0-9\-]`).ReplaceAllString(input, "-")
	input = strings.Trim(input, "-")
	if input == "" {
		return "relationship-run"
	}
	return input
}

func normalizeRelationshipCandidate(candidate models.RelationshipCandidate, nodeLookup map[string]models.MemoryNode) models.RelationshipCandidate {
	candidate.Source = strings.TrimSpace(candidate.Source)
	candidate.Target = strings.TrimSpace(candidate.Target)
	candidate.Tag = SanitizeTag(candidate.Tag)
	candidate.Reasoning = sanitizeRelationshipReasoning(candidate.Reasoning)
	if candidate.Confidence <= 0 {
		candidate.Confidence = 0.7
	}
	if len(candidate.EvidenceNodeIDs) == 0 {
		candidate.EvidenceNodeIDs = []string{candidate.Source, candidate.Target}
	}

	filteredEvidence := make([]string, 0, len(candidate.EvidenceNodeIDs))
	seen := make(map[string]bool)
	for _, nodeID := range candidate.EvidenceNodeIDs {
		nodeID = strings.TrimSpace(nodeID)
		if nodeID == "" || seen[nodeID] {
			continue
		}
		if _, ok := nodeLookup[nodeID]; !ok {
			continue
		}
		seen[nodeID] = true
		filteredEvidence = append(filteredEvidence, nodeID)
	}
	if len(filteredEvidence) == 0 {
		filteredEvidence = []string{candidate.Source, candidate.Target}
	}
	candidate.EvidenceNodeIDs = filteredEvidence
	candidate.SupportingPersonas = stringsToUniqueList(candidate.SupportingPersonas)
	return candidate
}

func mergeRelationshipCandidate(candidateMap map[string]models.RelationshipCandidate, candidate models.RelationshipCandidate) {
	key := relationshipCandidateKey(candidate)
	existing, ok := candidateMap[key]
	if !ok {
		candidate.SupportingPersonas = stringsToUniqueList(candidate.SupportingPersonas)
		candidateMap[key] = candidate
		return
	}

	existing.SupportingPersonas = stringsToUniqueList(append(existing.SupportingPersonas, candidate.SupportingPersonas...))
	existing.EvidenceNodeIDs = stringsToUniqueList(append(existing.EvidenceNodeIDs, candidate.EvidenceNodeIDs...))
	if candidate.Confidence > existing.Confidence {
		existing.Confidence = candidate.Confidence
		existing.Reasoning = candidate.Reasoning
	}
	if existing.CandidateSource == "" {
		existing.CandidateSource = candidate.CandidateSource
	} else if candidate.CandidateSource != "" && !strings.Contains(existing.CandidateSource, candidate.CandidateSource) {
		existing.CandidateSource = existing.CandidateSource + "|" + candidate.CandidateSource
	}
	candidateMap[key] = existing
}

func relationshipCandidateKey(candidate models.RelationshipCandidate) string {
	return fmt.Sprintf("%s|%s|%s", candidate.Source, candidate.Target, candidate.Tag)
}

func relationshipMirrorKey(candidate models.RelationshipCandidate) string {
	left := candidate.Source
	right := candidate.Target
	if right < left {
		left, right = right, left
	}
	return fmt.Sprintf("%s|%s|%s", left, right, candidate.Tag)
}

func relationshipPairKey(candidate models.RelationshipCandidate) string {
	return fmt.Sprintf("%s|%s", candidate.Source, candidate.Target)
}

func relationshipAgreementScore(candidate models.RelationshipCandidate) float32 {
	personaCount := len(stringsToUniqueList(candidate.SupportingPersonas))
	switch {
	case personaCount >= 4:
		return 1.0
	case personaCount == 3:
		return 0.9
	case personaCount == 2:
		return 0.78
	case personaCount == 1:
		return 0.62
	default:
		return 0.45
	}
}

func relationshipEvidenceScore(candidate models.RelationshipCandidate) float32 {
	if len(candidate.EvidenceNodeIDs) >= 3 {
		return 1.0
	}
	if len(candidate.EvidenceNodeIDs) == 2 {
		return 0.85
	}
	return 0.6
}

func relationshipSpecificityScore(tag string, reasoning string) float32 {
	if looksGenericRelationshipTag(tag, reasoning) {
		return 0.35
	}
	if len(strings.Fields(reasoning)) >= 12 {
		return 0.9
	}
	if len(strings.Fields(reasoning)) >= 7 {
		return 0.78
	}
	return 0.6
}

func relationshipGroundingScore(candidate models.RelationshipCandidate, nodeLookup map[string]models.MemoryNode) float32 {
	sourceNode, sourceOK := nodeLookup[candidate.Source]
	targetNode, targetOK := nodeLookup[candidate.Target]
	if !sourceOK || !targetOK {
		return 0.0
	}
	corpus := strings.ToLower(sourceNode.Title + " " + sourceNode.Summary + " " + sourceNode.FullText + " " + targetNode.Title + " " + targetNode.Summary + " " + targetNode.FullText)
	score := float32(0.8)
	if strings.Contains(corpus, strings.ToLower(strings.ReplaceAll(candidate.Tag, "_", " "))) {
		score += 0.1
	}
	if !containsUnsupportedRelationshipReferences(candidate, nodeLookup) {
		score += 0.1
	}
	return score
}

func relationshipSemanticPriorityAdjustment(candidate models.RelationshipCandidate) float32 {
	normalizedTag := strings.ToUpper(strings.TrimSpace(candidate.Tag))
	literalTags := map[string]bool{
		"OUTPERFORMS":         true,
		"IMPLEMENTS_WITHIN":  true,
		"SUPPORTS_BENCHMARKS": true,
		"AUDITS_PERFORMANCE": true,
		"ANALYZES_RANK":       true,
		"OPTIMIZES_WEIGHTS":   true,
		"INDEXING_SYSTEM":     true,
		"INTEGRATES_GENERATOR": true,
		"USES":               true,
		"IMPLEMENTS":         true,
		"INTEGRATES":         true,
		"USES_FAISS":         true,
		"REDUCES_LATENCY":    true,
		"REDUCES_HALLUCINATION": true,
		"REDUCES_HALLUCINATIONS": true,
		"REDUCES_VRAM":       true,
		"SHARED_INTRINSIC_RANK": true,
		"SUPERIOR_TO_PROMPTING": true,
	}
	interpretiveTags := map[string]bool{
		"HISTORICAL_EVOLUTION":     true,
		"ARCHITECTURAL_VALIDATION": true,
		"ESTABLISHES_SOTA":         true,
		"EFFICIENCY_CAUSALITY":     true,
		"RESEARCH_CONTINUITY":      true,
		"TEMPORAL_INCONSISTENCY":   true,
		"SUPPORTS_INFRASTRUCTURE":  true,
		"INFRASTRUCTURE_SCALING":   true,
		"ARCHITECTURAL_FOUNDATION": true,
		"DEVELOPMENT_TO_DEPLOYMENT": true,
	}
	lowValueFactualTags := map[string]bool{
		"COLLABORATION":       true,
		"REFERENCES":          true,
		"UNDERPINS":           true,
		"RESEARCH_LINEAGE":    true,
		"MODEL_OPTIMIZATION":  true,
		"SUPPORTS":            true,
		"COMPLEMENTS":         true,
		"EFFICIENCY_CONVERGENCE": true,
		"TECH_VALIDATION":     true,
		"EMPIRICAL_VALIDATION": true,
		"DEVELOPER_RELATION":  true,
		"ANALYZES":            true,
		"VALIDATES":           true,
	}
	switch {
	case literalTags[normalizedTag]:
		return 0.06
	case interpretiveTags[normalizedTag]:
		return -0.08
	case lowValueFactualTags[normalizedTag]:
		return -0.06
	default:
		return 0
	}
}

func requiresStrongerSupport(candidate models.RelationshipCandidate) bool {
	normalizedTag := strings.ToUpper(strings.TrimSpace(candidate.Tag))
	if strings.Contains(normalizedTag, "CAUSAL") || strings.Contains(normalizedTag, "EVOLUTION") || strings.Contains(normalizedTag, "SOTA") {
		return true
	}
	return normalizedTag == "TEMPORAL_INCONSISTENCY" ||
		normalizedTag == "RESEARCH_CONTINUITY" ||
		normalizedTag == "ARCHITECTURAL_VALIDATION" ||
		normalizedTag == "ARCHITECTURAL_FOUNDATION" ||
		normalizedTag == "SUPPORTS_INFRASTRUCTURE" ||
		normalizedTag == "INFRASTRUCTURE_SCALING" ||
		normalizedTag == "DEVELOPMENT_TO_DEPLOYMENT" ||
		normalizedTag == "SUPPORTS" ||
		normalizedTag == "COMPLEMENTS" ||
		normalizedTag == "EFFICIENCY_CONVERGENCE" ||
		normalizedTag == "ANALYZES" ||
		normalizedTag == "VALIDATES" ||
		normalizedTag == "UNDERPINS" ||
		normalizedTag == "RESEARCH_LINEAGE" ||
		normalizedTag == "REFERENCES" ||
		normalizedTag == "COLLABORATION" ||
		normalizedTag == "DEVELOPER_RELATION"
}

func isLowValueFactualTag(tag string) bool {
	switch strings.ToUpper(strings.TrimSpace(tag)) {
	case "COLLABORATION", "REFERENCES", "UNDERPINS", "RESEARCH_LINEAGE", "MODEL_OPTIMIZATION", "SUPPORTS", "COMPLEMENTS", "EFFICIENCY_CONVERGENCE", "TECH_VALIDATION", "EMPIRICAL_VALIDATION", "DEVELOPER_RELATION", "ANALYZES", "VALIDATES":
		return true
	default:
		return false
	}
}

func isBroadSupportTag(tag string) bool {
	switch strings.ToUpper(strings.TrimSpace(tag)) {
	case "SUPPORTS", "COMPLEMENTS", "EFFICIENCY_CONVERGENCE", "TECH_VALIDATION", "EMPIRICAL_VALIDATION", "ANALYZES", "VALIDATES":
		return true
	default:
		return false
	}
}

func looksGenericRelationshipTag(tag string, reasoning string) bool {
	normalizedTag := strings.ToUpper(strings.TrimSpace(tag))
	if normalizedTag == "" {
		return true
	}
	genericTags := map[string]bool{
		"RELATED":       true,
		"CONNECTED":     true,
		"LINKED":        true,
		"ASSOCIATED":    true,
		"SAME_ORG":      true,
		"SAME_RESEARCH": true,
		"SAME_ENTITY":   true,
		"SAME_TOPIC":    true,
		"SAME_SOURCE":   true,
		"MARKET_SENTIMENT": true,
		"CONSUMER_IMPACT": true,
		"AI_METHODOLOGY_EVOLUTION": true,
	}
	if genericTags[normalizedTag] {
		return true
	}
	loweredReasoning := strings.ToLower(reasoning)
	return strings.Contains(loweredReasoning, "seems related") ||
		strings.Contains(loweredReasoning, "appears connected") ||
		strings.Contains(loweredReasoning, "both nodes reference") ||
		strings.Contains(loweredReasoning, "both nodes discuss") ||
		strings.Contains(loweredReasoning, "both nodes describe") ||
		strings.Contains(loweredReasoning, "suggesting") ||
		strings.Contains(loweredReasoning, "aligns with") ||
		strings.Contains(loweredReasoning, "represents the")
}

func containsUnsupportedRelationshipReferences(candidate models.RelationshipCandidate, nodeLookup map[string]models.MemoryNode) bool {
	var builder strings.Builder
	for _, nodeID := range candidate.EvidenceNodeIDs {
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
	corpus := builder.String()
	text := strings.ToLower(candidate.Reasoning)

	for _, match := range relationshipYearPattern.FindAllString(text, -1) {
		if !strings.Contains(corpus, strings.ToLower(match)) {
			return true
		}
	}
	for _, match := range relationshipNumberPattern.FindAllString(text, -1) {
		if !strings.Contains(corpus, strings.ToLower(match)) {
			return true
		}
	}

	return false
}

func containsInterpretiveRelationshipLanguage(candidate models.RelationshipCandidate, nodeLookup map[string]models.MemoryNode) bool {
	reasoning := strings.ToLower(candidate.Reasoning)
	interpretivePhrases := []string{
		"drives",
		"driver for",
		"primary driver",
		"catalyst",
		"underpins",
		"leads to",
		"signals",
		"explains",
		"reflects",
		"high-stakes",
		"transition toward",
		"serves as",
		"structural backbone",
		"core architecture",
	}

	for _, phrase := range interpretivePhrases {
		if !strings.Contains(reasoning, phrase) {
			continue
		}
		if !evidenceCorpusContainsPhrase(candidate, nodeLookup, phrase) {
			return true
		}
	}
	return false
}

func isHighRiskInfrastructureRelationship(candidate models.RelationshipCandidate, nodeLookup map[string]models.MemoryNode) bool {
	normalizedTag := strings.ToUpper(strings.TrimSpace(candidate.Tag))
	text := strings.ToLower(candidate.Tag + " " + candidate.Reasoning)
	highRiskSignals := []string{
		"infrastructure",
		"deployment",
		"deploy",
		"national grid",
		"linguistic interface",
		"scheduled",
		"upgrade",
		"upgrades",
	}
	foundSignal := false
	for _, signal := range highRiskSignals {
		if strings.Contains(text, signal) {
			foundSignal = true
			break
		}
	}
	if !foundSignal &&
		normalizedTag != "SUPPORTS_INFRASTRUCTURE" &&
		normalizedTag != "INFRASTRUCTURE_SCALING" &&
		normalizedTag != "ARCHITECTURAL_FOUNDATION" &&
		normalizedTag != "DEVELOPMENT_TO_DEPLOYMENT" {
		return false
	}

	sourceNode, sourceOK := nodeLookup[candidate.Source]
	targetNode, targetOK := nodeLookup[candidate.Target]
	if !sourceOK || !targetOK {
		return true
	}

	sourceCorpus := strings.ToLower(sourceNode.Title + " " + sourceNode.Summary + " " + sourceNode.FullText)
	targetCorpus := strings.ToLower(targetNode.Title + " " + targetNode.Summary + " " + targetNode.FullText)

	// High-risk operational/deployment claims must be literally supported by both sides.
	requiredSignals := []string{"infrastructure", "deployment", "national grid", "linguistic interface", "scheduled", "upgrade"}
	for _, signal := range requiredSignals {
		if !strings.Contains(text, signal) {
			continue
		}
		if !(strings.Contains(sourceCorpus, signal) && strings.Contains(targetCorpus, signal)) {
			return true
		}
	}

	// Infrastructure-family tags are too broad unless both nodes explicitly frame the same operational context.
	if normalizedTag == "SUPPORTS_INFRASTRUCTURE" ||
		normalizedTag == "INFRASTRUCTURE_SCALING" ||
		normalizedTag == "ARCHITECTURAL_FOUNDATION" ||
		normalizedTag == "DEVELOPMENT_TO_DEPLOYMENT" {
		sharedOpsContext := (strings.Contains(sourceCorpus, "infrastructure") && strings.Contains(targetCorpus, "infrastructure")) ||
			(strings.Contains(sourceCorpus, "deployment") && strings.Contains(targetCorpus, "deployment")) ||
			(strings.Contains(sourceCorpus, "national grid") && strings.Contains(targetCorpus, "national grid"))
		if !sharedOpsContext {
			return true
		}
	}

	return false
}

func evidenceCorpusContainsPhrase(candidate models.RelationshipCandidate, nodeLookup map[string]models.MemoryNode, phrase string) bool {
	var builder strings.Builder
	for _, nodeID := range candidate.EvidenceNodeIDs {
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
	corpus := builder.String()
	if strings.Contains(corpus, phrase) {
		return true
	}

	for _, word := range relationshipWordPattern.FindAllString(phrase, -1) {
		if len(word) < 4 {
			continue
		}
		if !strings.Contains(corpus, word) {
			return false
		}
	}
	return true
}

func sanitizeRelationshipReasoning(reasoning string) string {
	reasoning = strings.TrimSpace(reasoning)
	if reasoning == "" {
		return ""
	}
	if idx := strings.IndexAny(reasoning, ".!?"); idx >= 0 {
		reasoning = strings.TrimSpace(reasoning[:idx+1])
	}
	replacements := map[string]string{
		"high-fidelity":        "strong",
		"strategic":            "",
		"mission-critical":     "important",
		"global infrastructure": "infrastructure",
	}
	for oldValue, newValue := range replacements {
		reasoning = strings.ReplaceAll(reasoning, oldValue, newValue)
	}
	reasoning = strings.Join(strings.Fields(reasoning), " ")
	return reasoning
}

func stringsToUniqueList(values []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func relationshipsAreSemanticallyOverlapping(existing models.RelationshipCandidate, incoming models.RelationshipCandidate) bool {
	if existing.Source != incoming.Source || existing.Target != incoming.Target {
		return false
	}

	if existing.Tag == incoming.Tag {
		return true
	}

	existingFamily := relationshipConceptFamily(existing)
	incomingFamily := relationshipConceptFamily(incoming)
	if existingFamily != "" && existingFamily == incomingFamily {
		return true
	}

	existingTagTokens := tagTokenSet(existing.Tag)
	incomingTagTokens := tagTokenSet(incoming.Tag)
	if len(existingTagTokens) > 0 && len(incomingTagTokens) > 0 && tokenOverlapRatio(existingTagTokens, incomingTagTokens) >= 0.5 {
		return true
	}

	existingReasoningTokens := reasoningTokenSet(existing.Reasoning)
	incomingReasoningTokens := reasoningTokenSet(incoming.Reasoning)
	if (existingFamily == "broad-support" || incomingFamily == "broad-support") &&
		tokenOverlapRatio(existingReasoningTokens, incomingReasoningTokens) >= 0.3 {
		return true
	}
	return tokenOverlapRatio(existingReasoningTokens, incomingReasoningTokens) >= 0.6
}

func relationshipConceptFamily(candidate models.RelationshipCandidate) string {
	tag := strings.ToUpper(strings.TrimSpace(candidate.Tag))
	reasoning := strings.ToLower(candidate.Reasoning)

	switch {
	case strings.Contains(tag, "INFRASTRUCTURE") || strings.Contains(tag, "DEPLOYMENT") || strings.Contains(tag, "FOUNDATION"):
		return "infrastructure"
	case strings.Contains(tag, "IMPLEMENT") || strings.Contains(tag, "DEPENDENCY") || strings.Contains(reasoning, "transformer") || strings.Contains(reasoning, "attention weights") || strings.Contains(reasoning, "dense layers"):
		return "architecture-implementation"
	case strings.Contains(tag, "LATENCY") || strings.Contains(reasoning, "latency") || strings.Contains(reasoning, "adapter"):
		return "latency"
	case strings.Contains(tag, "RANK") || strings.Contains(reasoning, "intrinsic rank"):
		return "intrinsic-rank"
	case strings.Contains(tag, "HALLUCINATION") || strings.Contains(reasoning, "hallucination"):
		return "hallucination"
	case strings.Contains(tag, "SUPPORT") || strings.Contains(tag, "VALIDATION") || strings.Contains(tag, "CONVERGENCE") || strings.Contains(tag, "COMPLEMENT"):
		return "broad-support"
	case strings.Contains(tag, "FAISS") || strings.Contains(reasoning, "faiss") || strings.Contains(reasoning, "index"):
		return "retrieval-index"
	case strings.Contains(tag, "OUTPERFORM") || strings.Contains(tag, "SUPERIOR") || strings.Contains(reasoning, "outperform"):
		return "benchmark-superiority"
	}

	return ""
}

func tagTokenSet(tag string) map[string]struct{} {
	return tokenSet(strings.ReplaceAll(strings.ToLower(tag), "_", " "))
}

func reasoningTokenSet(reasoning string) map[string]struct{} {
	return tokenSet(strings.ToLower(reasoning))
}

func tokenSet(input string) map[string]struct{} {
	normalized := regexp.MustCompile(`[^a-z0-9\s]+`).ReplaceAllString(input, " ")
	stopWords := map[string]bool{
		"the": true, "and": true, "for": true, "that": true, "with": true, "from": true,
		"into": true, "this": true, "both": true, "node": true, "nodes": true, "while": true,
		"using": true, "their": true, "they": true, "have": true, "has": true, "same": true,
	}
	result := make(map[string]struct{})
	for _, token := range strings.Fields(normalized) {
		if len(token) < 4 || stopWords[token] {
			continue
		}
		result[token] = struct{}{}
	}
	return result
}

func tokenOverlapRatio(left map[string]struct{}, right map[string]struct{}) float64 {
	if len(left) == 0 || len(right) == 0 {
		return 0
	}
	overlap := 0
	for token := range left {
		if _, ok := right[token]; ok {
			overlap++
		}
	}
	minSize := len(left)
	if len(right) < minSize {
		minSize = len(right)
	}
	if minSize == 0 {
		return 0
	}
	return float64(overlap) / float64(minSize)
}

func maxFloat32(left float32, right float32) float32 {
	if left > right {
		return left
	}
	return right
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func mapPersonaProposals(proposals []PersonaConnectionProposal, personaName string) []models.RelationshipCandidate {
	mapped := make([]models.RelationshipCandidate, 0, len(proposals))
	for _, proposal := range proposals {
		mapped = append(mapped, models.RelationshipCandidate{
			Source:             proposal.Source,
			Target:             proposal.Target,
			Tag:                proposal.Tag,
			Reasoning:          proposal.Reasoning,
			Confidence:         proposal.Confidence,
			EvidenceNodeIDs:    append([]string(nil), proposal.EvidenceNodeIDs...),
			SupportingPersonas: []string{personaName},
			CandidateSource:    "persona:" + personaName,
		})
	}
	return mapped
}
