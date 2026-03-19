package brain

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"spider-agent/models"
)

func TestValidateAndRankRelationshipCandidatesRejectsGenericAndUnsupported(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "RAG", Summary: "RAG uses retrieval.", FullText: "RAG-sequence with 626M parameters outperforms T5-11B on Natural Questions."},
		{ID: "node-2", Title: "T5", Summary: "T5 is a dense baseline.", FullText: "T5-11B is outperformed by retrieval-augmented generation on open-domain QA."},
	}

	finalConnections, candidates, _ := validateAndRankRelationshipCandidates(nodes, []models.RelationshipCandidate{
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "OUTPERFORMS",
			Reasoning:          "RAG-sequence outperforms T5-11B on open-domain QA.",
			Confidence:         0.91,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Connector", "Skeptic"},
		},
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "RELATED",
			Reasoning:          "These seem related.",
			Confidence:         0.95,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Connector"},
		},
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "DEPLOYS",
			Reasoning:          "This powers a national grid deployment in 2026.",
			Confidence:         0.95,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Implications Mapper", "Connector"},
		},
	})

	if len(finalConnections) != 1 {
		t.Fatalf("expected 1 accepted connection, got %d", len(finalConnections))
	}
	if finalConnections[0].Tag != "OUTPERFORMS" {
		t.Fatalf("expected OUTPERFORMS to survive, got %q", finalConnections[0].Tag)
	}

	var rejectedGeneric bool
	var rejectedUnsupported bool
	for _, candidate := range candidates {
		if candidate.Tag == "RELATED" && candidate.RejectionReason == "generic_relationship" {
			rejectedGeneric = true
		}
		if candidate.Tag == "DEPLOYS" && (candidate.RejectionReason == "unsupported_reference" || candidate.RejectionReason == "unsupported_infrastructure_claim") {
			rejectedUnsupported = true
		}
	}

	if !rejectedGeneric {
		t.Fatalf("expected generic candidate to be rejected")
	}
	if !rejectedUnsupported {
		t.Fatalf("expected unsupported candidate to be rejected")
	}
}

func TestValidateAndRankRelationshipCandidatesRejectsOverlappingPairAndEntityOverlapTags(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "Iran conflict", Summary: "South Pars attack threatens energy supplies.", FullText: "The South Pars gas field attack threatens global energy supplies and increases inflation pressure."},
		{ID: "node-2", Title: "Global outlook", Summary: "Inflation may stay elevated.", FullText: "Analysts expect persistent inflation and continued localization in response to geopolitical volatility."},
	}

	finalConnections, candidates, _ := validateAndRankRelationshipCandidates(nodes, []models.RelationshipCandidate{
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "SUPPLY_DRIVEN_INFLATION",
			Reasoning:          "The South Pars gas field attack threatens energy supplies, helping explain persistent inflation pressure.",
			Confidence:         0.92,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Connector", "Skeptic"},
		},
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "ENERGY_PRICE_IMPACT",
			Reasoning:          "The South Pars gas field attack threatens global energy supplies and contributes to persistent inflation pressure.",
			Confidence:         0.90,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Implications Mapper"},
		},
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "SAME_ORG",
			Reasoning:          "Both nodes discuss the same organizations involved in the wider situation.",
			Confidence:         0.95,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Entity Hunter"},
		},
	})

	if len(finalConnections) != 1 {
		t.Fatalf("expected 1 accepted connection after overlap filtering, got %d", len(finalConnections))
	}
	if finalConnections[0].Tag != "SUPPLY_DRIVEN_INFLATION" {
		t.Fatalf("expected strongest relationship to survive, got %q", finalConnections[0].Tag)
	}

	var rejectedOverlap bool
	var rejectedEntityOverlap bool
	for _, candidate := range candidates {
		if candidate.Tag == "ENERGY_PRICE_IMPACT" && candidate.RejectionReason == "overlapping_pair_relationship" {
			rejectedOverlap = true
		}
		if candidate.Tag == "SAME_ORG" && candidate.RejectionReason == "generic_relationship" {
			rejectedEntityOverlap = true
		}
	}

	if !rejectedOverlap {
		t.Fatalf("expected overlapping same-pair relationship to be rejected")
	}
	if !rejectedEntityOverlap {
		t.Fatalf("expected SAME_ORG relationship to be rejected as generic")
	}
}

func TestValidateAndRankRelationshipCandidatesRejectsInterpretiveLeapReasoning(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "Social trends", Summary: "Consumers prefer more authentic content.", FullText: "Consumers increasingly prefer more authentic content and are cautious about AI ads."},
		{ID: "node-2", Title: "Geostrategy", Summary: "Companies are localizing operations.", FullText: "Companies are localizing operations in response to geopolitical volatility."},
	}

	finalConnections, candidates, _ := validateAndRankRelationshipCandidates(nodes, []models.RelationshipCandidate{
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "CAUSAL_ALIGNMENT",
			Reasoning:          "Authenticity trends drive a transition toward specialized high-stakes geopolitical analysis.",
			Confidence:         0.9,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Discovery", "Connector"},
		},
	})

	if len(finalConnections) != 0 {
		t.Fatalf("expected interpretive leap relationship to be rejected")
	}
	if len(candidates) != 1 || candidates[0].RejectionReason != "interpretive_leap" {
		t.Fatalf("expected rejection reason interpretive_leap, got %+v", candidates)
	}
}

func TestValidateAndRankRelationshipCandidatesRejectsUnsupportedInfrastructureClaims(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "Transformer paper", Summary: "Attention replaces recurrence.", FullText: "The Transformer architecture uses multi-head attention and positional encoding for sequence transduction."},
		{ID: "node-2", Title: "Strategic note", Summary: "A strategic review references future systems.", FullText: "The review discusses model evaluation and strategic planning but does not describe a national grid deployment."},
	}

	finalConnections, candidates, _ := validateAndRankRelationshipCandidates(nodes, []models.RelationshipCandidate{
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "SUPPORTS_INFRASTRUCTURE",
			Reasoning:          "Transformer multi-head attention mechanisms provide the structural backbone for scheduled 2026 upgrades to national linguistic interfaces.",
			Confidence:         0.9,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Entity Hunter", "Timeline Analyst"},
		},
	})

	if len(finalConnections) != 0 {
		t.Fatalf("expected unsupported infrastructure relationship to be rejected")
	}
	if len(candidates) != 1 || candidates[0].RejectionReason != "unsupported_infrastructure_claim" {
		t.Fatalf("expected rejection reason unsupported_infrastructure_claim, got %+v", candidates)
	}
}

func TestValidateAndRankRelationshipCandidatesRequiresMoreSupportForInterpretiveTags(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "REALM", Summary: "REALM introduced retrieval.", FullText: "REALM introduced differentiable retrieval before later retrieval-augmented models."},
		{ID: "node-2", Title: "RAG", Summary: "RAG formalized retrieval-augmented generation.", FullText: "RAG formalized retrieval-augmented generation with explicit retrieval and generation components."},
	}

	finalConnections, candidates, _ := validateAndRankRelationshipCandidates(nodes, []models.RelationshipCandidate{
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "HISTORICAL_EVOLUTION",
			Reasoning:          "REALM preceded and informed later retrieval-augmented generation work.",
			Confidence:         0.9,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Context Provider"},
		},
	})

	if len(finalConnections) != 0 {
		t.Fatalf("expected single-persona interpretive relationship to be rejected")
	}
	if len(candidates) != 1 || candidates[0].RejectionReason != "low_support_interpretive" {
		t.Fatalf("expected rejection reason low_support_interpretive, got %+v", candidates)
	}
}

func TestValidateAndRankRelationshipCandidatesDemotesLowValueFactualTags(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "RAG paper", Summary: "RAG uses FAISS and Wikipedia.", FullText: "RAG uses FAISS indexing over Wikipedia and improves factual generation."},
		{ID: "node-2", Title: "FAISS details", Summary: "FAISS provides efficient indexing.", FullText: "FAISS enables efficient similarity search and MIPS retrieval for dense vector indexes."},
		{ID: "node-3", Title: "Hugging Face note", Summary: "Hugging Face collaborated on RAG support.", FullText: "RAG was developed with support from the Hugging Face ecosystem."},
	}

	finalConnections, _, _ := validateAndRankRelationshipCandidates(nodes, []models.RelationshipCandidate{
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "USES",
			Reasoning:          "RAG architectures utilize FAISS indexing to ground generative outputs.",
			Confidence:         0.92,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Context Provider", "Discovery"},
		},
		{
			Source:             "node-1",
			Target:             "node-3",
			Tag:                "COLLABORATION",
			Reasoning:          "The RAG work references collaboration with the Hugging Face ecosystem.",
			Confidence:         0.92,
			EvidenceNodeIDs:    []string{"node-1", "node-3"},
			SupportingPersonas: []string{"Entity Hunter"},
		},
	})

	if len(finalConnections) != 1 {
		t.Fatalf("expected only the higher-value literal edge to survive, got %d", len(finalConnections))
	}
	if finalConnections[0].Tag != "USES" {
		t.Fatalf("expected USES edge to outrank low-value factual edge, got %q", finalConnections[0].Tag)
	}
}

func TestValidateAndRankRelationshipCandidatesDemotesBroadSupportEdges(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "RAG protocol", Summary: "RAG uses BART and retrieval.", FullText: "RAG combines a BART generator with non-parametric retrieval over a document index."},
		{ID: "node-2", Title: "RAG benchmark", Summary: "RAG beats larger baselines.", FullText: "The 626M parameter RAG model outperforms larger dense parametric baselines on open-domain QA."},
	}

	finalConnections, _, _ := validateAndRankRelationshipCandidates(nodes, []models.RelationshipCandidate{
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "SUPPORTS",
			Reasoning:          "The established RAG protocol supports the benchmark improvements observed in later evaluations.",
			Confidence:         0.92,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Discovery", "Implications Mapper"},
		},
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "OUTPERFORMS",
			Reasoning:          "RAG outperforms larger dense parametric baselines on open-domain question answering.",
			Confidence:         0.92,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Connector", "Context Provider"},
		},
	})

	if len(finalConnections) != 1 {
		t.Fatalf("expected only the more literal edge to survive, got %d", len(finalConnections))
	}
	if finalConnections[0].Tag != "OUTPERFORMS" {
		t.Fatalf("expected OUTPERFORMS to outrank SUPPORTS, got %q", finalConnections[0].Tag)
	}
}

func TestValidateAndRankRelationshipCandidatesRejectsSamePairFamilyDuplicates(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "RAG paper", Summary: "RAG uses FAISS indexing.", FullText: "RAG uses FAISS indexing over Wikipedia to support retrieval during generation."},
		{ID: "node-2", Title: "FAISS note", Summary: "FAISS provides similarity search.", FullText: "FAISS enables vector similarity search and index-based retrieval for dense document collections."},
	}

	finalConnections, candidates, _ := validateAndRankRelationshipCandidates(nodes, []models.RelationshipCandidate{
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "USES_FAISS",
			Reasoning:          "RAG uses FAISS indexing to retrieve relevant documents during generation.",
			Confidence:         0.9,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Entity Hunter", "Timeline Analyst"},
		},
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "INDEXING_SYSTEM",
			Reasoning:          "FAISS serves as the indexing system used by RAG for dense retrieval.",
			Confidence:         0.88,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Connector", "Context Provider"},
		},
	})

	if len(finalConnections) != 1 {
		t.Fatalf("expected only one same-pair family connection to survive, got %d", len(finalConnections))
	}

	var rejectedOverlap bool
	for _, candidate := range candidates {
		if candidate.ValidationStatus == "rejected" {
			rejectedOverlap = true
		}
	}
	if !rejectedOverlap {
		t.Fatalf("expected one same-pair family duplicate to be rejected")
	}
}

func TestValidateAndRankRelationshipCandidatesPrefersHigherQualityCandidateOverConfidenceOrder(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "LoRA", Summary: "LoRA reduces adapter latency.", FullText: "LoRA introduces no additional inference latency compared to adapter-based methods."},
		{ID: "node-2", Title: "Adapters", Summary: "Adapters add latency.", FullText: "AdapterH and AdapterL introduce additional sequential inference latency."},
	}

	finalConnections, candidates, _ := validateAndRankRelationshipCandidates(nodes, []models.RelationshipCandidate{
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "EFFICIENCY_VALIDATION",
			Reasoning:          "LoRA validates efficiency improvements over adapter-based methods.",
			Confidence:         0.96,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Context Provider"},
		},
		{
			Source:             "node-1",
			Target:             "node-2",
			Tag:                "REDUCES_LATENCY",
			Reasoning:          "LoRA removes the additional inference latency introduced by sequential adapter modules.",
			Confidence:         0.74,
			EvidenceNodeIDs:    []string{"node-1", "node-2"},
			SupportingPersonas: []string{"Discovery", "Implications Mapper"},
		},
	})

	if len(finalConnections) != 1 {
		t.Fatalf("expected one winning same-pair edge, got %d", len(finalConnections))
	}
	if finalConnections[0].Tag != "REDUCES_LATENCY" {
		t.Fatalf("expected higher-quality edge to survive, got %q", finalConnections[0].Tag)
	}

	var sawOverlapRejection bool
	for _, candidate := range candidates {
		if candidate.Tag == "EFFICIENCY_VALIDATION" && candidate.RejectionReason == "overlapping_pair_relationship" {
			sawOverlapRejection = true
		}
	}
	if !sawOverlapRejection {
		t.Fatalf("expected lower-quality overlapping edge to be rejected after quality sorting")
	}
}

func TestRunRelationshipWorkflowWritesDebugTrace(t *testing.T) {
	tempDir := t.TempDir()
	originalWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("failed to get cwd: %v", err)
	}
	defer func() { _ = os.Chdir(originalWd) }()
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("failed to chdir: %v", err)
	}

	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			switch response := target.(type) {
			case *relationshipCandidateJSONResponse:
				response.Connections = []models.RelationshipCandidate{
					{
						Source:             "node-1",
						Target:             "node-2",
						Tag:                "OUTPERFORMS",
						Reasoning:          "RAG-sequence outperforms T5-11B on open-domain QA.",
						Confidence:         0.9,
						EvidenceNodeIDs:    []string{"node-1", "node-2"},
						SupportingPersonas: []string{"Connector", "Skeptic"},
						CandidateSource:    "synthesis",
					},
				}
			default:
				t.Fatalf("unexpected target type %T", target)
			}
			return nil
		},
	}

	brain := &Brain{ModelRouter: map[string]ModelProvider{"mock": mock}}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	_, debugRun, err := brain.RunRelationshipWorkflow(context.Background(), "inv-1", []models.MemoryNode{
		{ID: "node-1", Title: "RAG", Summary: "RAG summary", FullText: "RAG-sequence with 626M parameters outperforms T5-11B."},
		{ID: "node-2", Title: "T5", Summary: "T5 summary", FullText: "T5-11B is the dense baseline in the comparison."},
	}, []PersonaInsight{
		{
			PersonaName: "Connector",
			Confidence:  0.91,
			NodeIDs:     []string{"node-1", "node-2"},
			ProposedConnections: []PersonaConnectionProposal{
				{
					Source:          "node-1",
					Target:          "node-2",
					Tag:             "OUTPERFORMS",
					Reasoning:       "RAG-sequence outperforms T5-11B on open-domain QA.",
					EvidenceNodeIDs: []string{"node-1", "node-2"},
					Confidence:      0.9,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("RunRelationshipWorkflow failed: %v", err)
	}

	if len(debugRun.FinalConnections) != 1 {
		t.Fatalf("expected one final connection, got %d", len(debugRun.FinalConnections))
	}

	matches, err := filepath.Glob(filepath.Join("abdomen_vault", "relationship_logs", "*.txt"))
	if err != nil {
		t.Fatalf("failed to glob trace files: %v", err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected one relationship debug trace, got %d", len(matches))
	}

	content, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("failed to read trace file: %v", err)
	}
	if !strings.Contains(string(content), "GORANTULA RELATIONSHIP DEBUG TRACE") {
		t.Fatalf("expected trace header in debug log")
	}
	if !strings.Contains(string(content), "OUTPERFORMS") {
		t.Fatalf("expected accepted connection details in debug log")
	}
}

func TestValidateAndRankRelationshipCandidatesAppliesBoardReadabilityBudget(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "One", Summary: "One summary", FullText: "One full text about retrieval."},
		{ID: "node-2", Title: "Two", Summary: "Two summary", FullText: "Two full text about ranking."},
		{ID: "node-3", Title: "Three", Summary: "Three summary", FullText: "Three full text about adaptation."},
		{ID: "node-4", Title: "Four", Summary: "Four summary", FullText: "Four full text about efficiency."},
		{ID: "node-5", Title: "Five", Summary: "Five summary", FullText: "Five full text about benchmarks."},
		{ID: "node-6", Title: "Six", Summary: "Six summary", FullText: "Six full text about transformers."},
		{ID: "node-7", Title: "Seven", Summary: "Seven summary", FullText: "Seven full text about retrieval."},
		{ID: "node-8", Title: "Eight", Summary: "Eight summary", FullText: "Eight full text about deployment."},
		{ID: "node-9", Title: "Nine", Summary: "Nine summary", FullText: "Nine full text about adaptation."},
		{ID: "node-10", Title: "Ten", Summary: "Ten summary", FullText: "Ten full text about performance."},
		{ID: "node-11", Title: "Eleven", Summary: "Eleven summary", FullText: "Eleven full text about evidence."},
		{ID: "node-12", Title: "Twelve", Summary: "Twelve summary", FullText: "Twelve full text about evaluation."},
	}

	candidates := make([]models.RelationshipCandidate, 0, 12)
	for idx := 2; idx <= 12; idx++ {
		candidates = append(candidates, models.RelationshipCandidate{
			Source:             "node-1",
			Target:             fmt.Sprintf("node-%d", idx),
			Tag:                "TECHNICAL_ALIGNMENT",
			Reasoning:          "The nodes share grounded technical context around model behavior and evaluation.",
			Confidence:         0.9,
			EvidenceNodeIDs:    []string{"node-1", fmt.Sprintf("node-%d", idx)},
			SupportingPersonas: []string{"Connector", "Context Provider"},
		})
	}

	finalConnections, scoredCandidates, notes := validateAndRankRelationshipCandidates(nodes, candidates)

	if len(finalConnections) != 3 {
		t.Fatalf("expected readability budget to cap high-degree node fanout at 3, got %d", len(finalConnections))
	}

	degree := 0
	for _, connection := range finalConnections {
		if connection.Source == "node-1" || connection.Target == "node-1" {
			degree++
		}
	}
	if degree > 3 {
		t.Fatalf("expected node-1 degree to be capped at 3, got %d", degree)
	}

	var sawBudgetRejection bool
	for _, candidate := range scoredCandidates {
		if candidate.RejectionReason == "board_readability_budget" {
			sawBudgetRejection = true
			break
		}
	}
	if !sawBudgetRejection {
		t.Fatalf("expected at least one candidate to be pruned by board readability budget")
	}

	if !strings.Contains(strings.Join(notes, " "), "board_readability_budget=pruned_connections:") {
		t.Fatalf("expected readability budget notes to be recorded")
	}
}

func TestPruneConnectionsForBoardReadabilityEnforcesPerNodeCapBelowGlobalLimit(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "One", Summary: "One summary", FullText: "One full text."},
		{ID: "node-2", Title: "Two", Summary: "Two summary", FullText: "Two full text."},
		{ID: "node-3", Title: "Three", Summary: "Three summary", FullText: "Three full text."},
		{ID: "node-4", Title: "Four", Summary: "Four summary", FullText: "Four full text."},
		{ID: "node-5", Title: "Five", Summary: "Five summary", FullText: "Five full text."},
		{ID: "node-6", Title: "Six", Summary: "Six summary", FullText: "Six full text."},
		{ID: "node-7", Title: "Seven", Summary: "Seven summary", FullText: "Seven full text."},
	}

	connections := []models.BoardConnection{
		{Source: "node-1", Target: "node-2", Tag: "USES", QualityScore: 0.95},
		{Source: "node-1", Target: "node-3", Tag: "IMPLEMENTS", QualityScore: 0.94},
		{Source: "node-1", Target: "node-4", Tag: "OUTPERFORMS", QualityScore: 0.93},
	}

	pruned, notes, prunedKeys := pruneConnectionsForBoardReadability(nodes, connections)
	if len(pruned) != 2 {
		t.Fatalf("expected per-node budget to prune one connection, got %d", len(pruned))
	}
	if len(prunedKeys) != 1 {
		t.Fatalf("expected one pruned key, got %d", len(prunedKeys))
	}
	if !strings.Contains(strings.Join(notes, " "), "board_readability_budget=pruned_connections:1") {
		t.Fatalf("expected prune note for per-node cap, got %v", notes)
	}
}

func TestBuildCandidateSourcesSplitsSourcesAndNormalizesPersonas(t *testing.T) {
	sources := buildCandidateSources("synthesis|fallback|persona:Connector", []string{"Connector", " Discovery "})
	expected := []string{"fallback", "persona:Connector", "persona:Discovery", "synthesis"}
	if len(sources) != len(expected) {
		t.Fatalf("expected %d sources, got %d: %v", len(expected), len(sources), sources)
	}
	for idx, source := range expected {
		if sources[idx] != source {
			t.Fatalf("expected source %q at index %d, got %q", source, idx, sources[idx])
		}
	}
}
