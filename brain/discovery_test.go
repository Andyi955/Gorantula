package brain

import (
	"context"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func TestSynthesizeDiscoveriesReturnsCandidateDiscoveries(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			if !strings.Contains(prompt, "PROPOSE possible discoveries") {
				t.Fatalf("expected discovery prompt to frame output as candidates")
			}
			if !strings.Contains(prompt, "Use plain, technical titles with no hype language") {
				t.Fatalf("expected discovery prompt to require sober titles")
			}
			if !strings.Contains(prompt, "non-obvious pattern, contradiction, escalation, dependency, or second-order implication") {
				t.Fatalf("expected discovery prompt to define discoveries as synthesized non-obvious insights")
			}
			if !strings.Contains(prompt, "Do not return isolated facts, single-source announcements, or rewritten node summaries") {
				t.Fatalf("expected discovery prompt to reject fact summaries")
			}

			switch response := target.(type) {
			case *discoveryJSONResponse:
				response.Discoveries = []models.Discovery{
					{
						Title:         "Hybrid retrieval advantage",
						Claim:         "Hybrid retrieval structures outperform larger parametric-only models on factual question answering.",
						Impact:        "This supports using retrieval to improve factual performance efficiently.",
						Confidence:    0.93,
						SourceNodeIDs: []string{"node-1", "node-2"},
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

	discoveries, err := brain.SynthesizeDiscoveries(context.Background(), "inv-1", []models.MemoryNode{
		{ID: "node-1", Title: "RAG", Summary: "RAG summary", FullText: "RAG full text"},
		{ID: "node-2", Title: "T5", Summary: "T5 summary", FullText: "T5 full text"},
	}, nil)
	if err != nil {
		t.Fatalf("SynthesizeDiscoveries failed: %v", err)
	}

	if len(discoveries) != 1 {
		t.Fatalf("expected 1 candidate discovery, got %d", len(discoveries))
	}
	if discoveries[0].Status != discoveryCandidateStatus {
		t.Fatalf("expected candidate discovery status, got %q", discoveries[0].Status)
	}
}

func TestSynthesizeDiscoveriesIncludesPersonaEvidenceFields(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			for _, expected := range []string{
				"Observation: node-1 and node-2 both describe agentic AI governance pressure.",
				"Hypothesis: Governance guidance and infrastructure spending are converging.",
				"Proposed Connections:",
				"node-1 -> node-2 [GOVERNANCE_INFRASTRUCTURE]",
				"Evidence: node-1, node-2",
			} {
				if !strings.Contains(prompt, expected) {
					t.Fatalf("expected discovery prompt to include %q\nPrompt:\n%s", expected, prompt)
				}
			}

			response, ok := target.(*discoveryJSONResponse)
			if !ok {
				t.Fatalf("unexpected target type %T", target)
			}
			response.Discoveries = nil
			return nil
		},
	}

	brain := &Brain{ModelRouter: map[string]ModelProvider{"mock": mock}}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	_, err := brain.SynthesizeDiscoveries(context.Background(), "inv-1", []models.MemoryNode{
		{ID: "node-1", Title: "Governance", Summary: "Agentic AI governance pressure increased.", FullText: "Agentic AI governance pressure increased after safety guidance."},
		{ID: "node-2", Title: "Infrastructure", Summary: "AI infrastructure spending increased.", FullText: "AI infrastructure spending increased alongside governance guidance."},
	}, []PersonaInsight{
		{
			PersonaName:  "Discovery",
			Observations: []string{"Observation: node-1 and node-2 both describe agentic AI governance pressure."},
			Hypotheses:   []string{"Hypothesis: Governance guidance and infrastructure spending are converging."},
			ProposedConnections: []PersonaConnectionProposal{
				{
					Source:          "node-1",
					Target:          "node-2",
					Tag:             "GOVERNANCE_INFRASTRUCTURE",
					Reasoning:       "Governance pressure appears alongside infrastructure spending.",
					EvidenceNodeIDs: []string{"node-1", "node-2"},
					Confidence:      0.83,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("SynthesizeDiscoveries failed: %v", err)
	}
}

func TestSynthesizeDiscoveriesCapsCandidatesByConfidence(t *testing.T) {
	t.Setenv("GORANTULA_DISCOVERY_CANDIDATE_LIMIT", "2")
	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			response, ok := target.(*discoveryJSONResponse)
			if !ok {
				t.Fatalf("unexpected target type %T", target)
			}
			response.Discoveries = []models.Discovery{
				{Title: "Beta routing shift", Claim: "Beta routing reduces support handoff volume.", Impact: "This can reduce repeated operator triage.", Confidence: 0.90, SourceNodeIDs: []string{"node-1", "node-2"}},
				{Title: "Alpha queue pressure", Claim: "Alpha queue pressure increases after retry spikes.", Impact: "This can slow downstream evidence review.", Confidence: 0.97, SourceNodeIDs: []string{"node-1", "node-2"}},
				{Title: "Gamma cache drift", Claim: "Gamma cache drift appears when duplicate payloads persist.", Impact: "This can increase stale relationship candidates.", Confidence: 0.88, SourceNodeIDs: []string{"node-1", "node-2"}},
			}
			return nil
		},
	}

	brain := &Brain{ModelRouter: map[string]ModelProvider{"mock": mock}}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	discoveries, err := brain.SynthesizeDiscoveries(context.Background(), "inv-1", []models.MemoryNode{
		{ID: "node-1", Title: "Queue", Summary: "Alpha queue pressure and Beta routing", FullText: "Alpha queue pressure increases after retry spikes. Beta routing reduces support handoff volume."},
		{ID: "node-2", Title: "Cache", Summary: "Gamma cache drift and evidence review", FullText: "Gamma cache drift appears when duplicate payloads persist. Downstream evidence review slows."},
	}, nil)
	if err != nil {
		t.Fatalf("SynthesizeDiscoveries failed: %v", err)
	}

	if len(discoveries) != 2 {
		t.Fatalf("expected 2 capped discoveries, got %d", len(discoveries))
	}
	if discoveries[0].Title != "Alpha Queue Pressure" {
		t.Fatalf("expected highest-confidence candidate first, got %q", discoveries[0].Title)
	}
}

func TestBuildDiscoveryReviewTeamUsesHybridTopicExperts(t *testing.T) {
	reviewers := buildDiscoveryReviewTeam("llm-architecture")
	if len(reviewers) != 5 {
		t.Fatalf("expected hybrid team with 5 reviewers for llm topic, got %d", len(reviewers))
	}

	baseReviewers := buildDiscoveryReviewTeam("")
	if len(baseReviewers) != 3 {
		t.Fatalf("expected fixed review cell only for empty topic, got %d", len(baseReviewers))
	}
}

func TestNormalizeDiscoveriesKeepsReviewableCandidateBelowOldStrictThreshold(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "Governance", Summary: "Agentic ai governance appears with infrastructure adoption.", FullText: "Agentic ai governance appears with infrastructure adoption."},
		{ID: "node-2", Title: "Infrastructure", Summary: "Infrastructure adoption appears with agentic ai governance.", FullText: "Infrastructure adoption appears with agentic ai governance."},
	}

	discoveries := normalizeDiscoveries([]models.Discovery{
		{
			Title:         "governed infrastructure adoption",
			Claim:         "Agentic ai governance and infrastructure adoption appear together across the cited evidence.",
			Impact:        "This gives reviewers a concrete cross-node candidate to evaluate.",
			Confidence:    0.82,
			SourceNodeIDs: []string{"node-1", "node-2"},
		},
	}, "inv-1", nodes, discoveryCandidateStatus)

	if len(discoveries) != 1 {
		t.Fatalf("expected reviewable candidate below old threshold to survive normalization, got %d", len(discoveries))
	}
}

func TestReviewDiscoveryCandidatesApprovesConsensusCandidate(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			switch response := target.(type) {
			case *models.DiscoveryReview:
				response.Reviewer = extractReviewer(prompt)
				response.Verdict = discoveryVerdictApprove
				response.Confidence = 0.9
				response.Rationale = "Grounded and sober."
			default:
				t.Fatalf("unexpected target type %T", target)
			}
			return nil
		},
	}

	brain := &Brain{ModelRouter: map[string]ModelProvider{"mock": mock}}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	approved, err := brain.ReviewDiscoveryCandidates(context.Background(), []models.Discovery{
		{
			ID:            "discovery-inv-1-0",
			Title:         "Hybrid Retrieval Advantage",
			Claim:         "Hybrid retrieval structures outperform larger parametric-only models on factual question answering.",
			Impact:        "This supports using retrieval to improve factual performance efficiently.",
			Confidence:    0.91,
			SourceNodeIDs: []string{"node-1", "node-2"},
			SourceVaultID: "inv-1",
			NodeKind:      "discovery",
			Status:        discoveryCandidateStatus,
			Topic:         "llm-architecture",
		},
	}, []models.MemoryNode{
		{ID: "node-1", Title: "RAG", Summary: "RAG updates knowledge via retrieval.", FullText: "Retrieval updates knowledge without retraining."},
		{ID: "node-2", Title: "Parametric QA", Summary: "Large parametric models trail hybrid retrieval.", FullText: "Hybrid retrieval beats larger parametric models on factual QA."},
	})
	if err != nil {
		t.Fatalf("ReviewDiscoveryCandidates failed: %v", err)
	}

	if len(approved) != 1 {
		t.Fatalf("expected 1 approved discovery, got %d", len(approved))
	}
	if approved[0].Status != discoveryApprovedStatus {
		t.Fatalf("expected approved discovery status, got %q", approved[0].Status)
	}
}

func TestReviewDiscoveryCandidatesRejectsCriticalFlag(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			switch response := target.(type) {
			case *models.DiscoveryReview:
				response.Reviewer = extractReviewer(prompt)
				response.Verdict = discoveryVerdictReject
				response.Confidence = 0.94
				response.Rationale = "Unsupported deployment claim."
				response.FlagsCriticalIssue = true
				response.FlagsUnsupportedClaims = true
			default:
				t.Fatalf("unexpected target type %T", target)
			}
			return nil
		},
	}

	brain := &Brain{ModelRouter: map[string]ModelProvider{"mock": mock}}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	approved, err := brain.ReviewDiscoveryCandidates(context.Background(), []models.Discovery{
		{
			ID:            "discovery-inv-1-0",
			Title:         "Hybrid Retrieval Advantage",
			Claim:         "Hybrid retrieval structures outperform larger parametric-only models on factual question answering.",
			Impact:        "This supports using retrieval to improve factual performance efficiently.",
			Confidence:    0.91,
			SourceNodeIDs: []string{"node-1", "node-2"},
			SourceVaultID: "inv-1",
			NodeKind:      "discovery",
			Status:        discoveryCandidateStatus,
			Topic:         "llm-architecture",
		},
	}, []models.MemoryNode{
		{ID: "node-1", Title: "RAG", Summary: "RAG updates knowledge via retrieval.", FullText: "Retrieval updates knowledge without retraining."},
		{ID: "node-2", Title: "Parametric QA", Summary: "Large parametric models trail hybrid retrieval.", FullText: "Hybrid retrieval beats larger parametric models on factual QA."},
	})
	if err != nil {
		t.Fatalf("ReviewDiscoveryCandidates failed: %v", err)
	}

	if len(approved) != 0 {
		t.Fatalf("expected 0 approved discoveries when a critical flag is raised, got %d", len(approved))
	}
}

func TestReviewDiscoveryCandidatesRevisesOverstatedCandidate(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			switch response := target.(type) {
			case *models.DiscoveryReview:
				response.Reviewer = extractReviewer(prompt)
				if strings.Contains(prompt, "Overclaim Auditor") {
					response.Verdict = discoveryVerdictRevise
					response.Confidence = 0.85
					response.Rationale = "The core idea is valid, but the wording is too dramatic."
					response.FlagsOverclaim = true
					response.RevisedTitle = "Hybrid Retrieval Efficiency"
					response.RevisedClaim = "Hybrid retrieval structures improve factual question answering relative to larger parametric-only baselines."
					response.RevisedImpact = "This suggests retrieval can improve factual performance with smaller models."
				} else {
					response.Verdict = discoveryVerdictApprove
					response.Confidence = 0.88
					response.Rationale = "The revised version is acceptable."
				}
			default:
				t.Fatalf("unexpected target type %T", target)
			}
			return nil
		},
	}

	brain := &Brain{ModelRouter: map[string]ModelProvider{"mock": mock}}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	approved, err := brain.ReviewDiscoveryCandidates(context.Background(), []models.Discovery{
		{
			ID:            "discovery-inv-1-0",
			Title:         "Hybrid Retrieval Supremacy",
			Claim:         "Hybrid retrieval structures outperform larger parametric-only models on factual question answering.",
			Impact:        "This revolutionizes factual performance. It also changes architecture strategy.",
			Confidence:    0.9,
			SourceNodeIDs: []string{"node-1", "node-2"},
			SourceVaultID: "inv-1",
			NodeKind:      "discovery",
			Status:        discoveryCandidateStatus,
			Topic:         "llm-architecture",
		},
	}, []models.MemoryNode{
		{ID: "node-1", Title: "RAG", Summary: "RAG updates knowledge via retrieval.", FullText: "Retrieval updates knowledge without retraining."},
		{ID: "node-2", Title: "Parametric QA", Summary: "Large parametric models trail hybrid retrieval.", FullText: "Hybrid retrieval beats larger parametric models on factual QA."},
	})
	if err != nil {
		t.Fatalf("ReviewDiscoveryCandidates failed: %v", err)
	}

	if len(approved) != 1 {
		t.Fatalf("expected revised discovery to survive review, got %d approved", len(approved))
	}
	if approved[0].Title != "Hybrid Retrieval Efficiency" {
		t.Fatalf("expected title revision to be applied, got %q", approved[0].Title)
	}
	if approved[0].Claim != "Hybrid retrieval structures improve factual question answering relative to larger parametric-only baselines." {
		t.Fatalf("expected revised claim to be applied, got %q", approved[0].Claim)
	}
	if approved[0].Impact != "This suggests retrieval can improve factual performance with smaller models." {
		t.Fatalf("expected sober revised impact, got %q", approved[0].Impact)
	}
}

func TestReviewDiscoveryCandidatesSalvagesUnsupportedFlagWhenReviewerProvidesRepair(t *testing.T) {
	mock := &MockProvider{
		NameFunc: func() string { return "mock" },
		GenerateJSONFunc: func(ctx context.Context, prompt string, target interface{}) error {
			switch response := target.(type) {
			case *models.DiscoveryReview:
				response.Reviewer = extractReviewer(prompt)
				if strings.Contains(prompt, "Overclaim Auditor") {
					response.Verdict = discoveryVerdictRevise
					response.Confidence = 0.9
					response.Rationale = "The original range is too narrow, but the claim can be repaired from the cited evidence."
					response.FlagsUnsupportedClaims = true
					response.RevisedTitle = "Consistency Of Low-rank Adaptation Across Model Scales"
					response.RevisedClaim = "Large language models ranging from GPT-2 Medium to GPT-3 175B exhibit comparable low intrinsic ranks for task adaptation, with performance typically saturating at ranks between 1 and 16."
					response.RevisedImpact = "The intrinsic rank required for task-specific weight updates does not scale proportionally with total model size."
				} else {
					response.Verdict = discoveryVerdictApprove
					response.Confidence = 0.91
					response.Rationale = "The repaired version is grounded."
				}
			default:
				t.Fatalf("unexpected target type %T", target)
			}
			return nil
		},
	}

	brain := &Brain{ModelRouter: map[string]ModelProvider{"mock": mock}}
	t.Setenv("DEFAULT_SEARCH_MODEL", "mock")

	approved, err := brain.ReviewDiscoveryCandidates(context.Background(), []models.Discovery{
		{
			ID:            "discovery-inv-1-1",
			Title:         "Intrinsic Adaptation Rank Consistency Across Model Scales",
			Claim:         "Large language models of significantly different sizes, specifically GPT-2 Medium and GPT-3 175B, exhibit a similar intrinsic rank for task adaptation, typically peaking between rank 4 and 16.",
			Impact:        "This suggests that the mathematical complexity required for task-specific adaptation does not scale linearly with the total parameter count of the base model.",
			Confidence:    0.9,
			SourceNodeIDs: []string{"node-1", "node-2"},
			SourceVaultID: "inv-1",
			NodeKind:      "discovery",
			Status:        discoveryCandidateStatus,
			Topic:         "llm-architecture",
		},
	}, []models.MemoryNode{
		{ID: "node-1", Title: "GPT-2 Medium", Summary: "GPT-2 Medium peaks at low LoRA ranks.", FullText: "Performance typically saturates at low ranks across GPT-2 Medium experiments."},
		{ID: "node-2", Title: "GPT-3 175B", Summary: "GPT-3 175B also saturates at low ranks.", FullText: "Across tasks, GPT-3 175B reaches near-optimal performance with LoRA ranks between 1 and 16."},
	})
	if err != nil {
		t.Fatalf("ReviewDiscoveryCandidates failed: %v", err)
	}

	if len(approved) != 1 {
		t.Fatalf("expected repaired discovery to survive review, got %d approved", len(approved))
	}
	if approved[0].Claim != "Large language models ranging from GPT-2 Medium to GPT-3 175B exhibit comparable low intrinsic ranks for task adaptation, with performance typically saturating at ranks between 1 and 16." {
		t.Fatalf("expected repaired claim to be applied, got %q", approved[0].Claim)
	}
}

func TestNormalizeDiscoveriesStrictThreshold(t *testing.T) {
	nodes := []models.MemoryNode{
		{ID: "node-1", Title: "LoRA", Summary: "LoRA reduces trainable parameters.", FullText: "LoRA avoids adapter latency and uses rank 4 in GPT-3 experiments."},
		{ID: "node-2", Title: "RAG", Summary: "RAG swaps indices to update world knowledge.", FullText: "RAG can update world leaders by changing the retriever index without retraining."},
		{ID: "node-3", Title: "Benchmarks", Summary: "MNLI and RTE are benchmark tasks.", FullText: "Fine-tuning is compared against prompt baselines on MNLI and RTE."},
	}

	discoveries := normalizeDiscoveries([]models.Discovery{
		{
			Title:         "Weak overlap",
			Claim:         "There appears to be overlap across sources.",
			Impact:        "Could be important.",
			Confidence:    0.99,
			SourceNodeIDs: []string{"node-1", "node-2"},
		},
		{
			Title:         "Low confidence",
			Claim:         "Specific claim",
			Impact:        "Specific impact",
			Confidence:    0.51,
			SourceNodeIDs: []string{"node-1", "node-2"},
		},
		{
			Title:         "valid discovery",
			Claim:         "Independent evidence supports a reproducible materials bottleneck.",
			Impact:        "This could redirect the operational plan immediately. Extra sentence.",
			Confidence:    0.91,
			SourceNodeIDs: []string{"node-1", "node-3"},
		},
		{
			Title:         "Elimination of AI Inference Latency",
			Claim:         "LoRA eliminates latency for the USA national grid scheduled for April 2026.",
			Impact:        "This would enable deployment on the USA national grid in April 2026.",
			Confidence:    0.97,
			SourceNodeIDs: []string{"node-1", "node-2"},
		},
	}, "inv-1", nodes, discoveryCandidateStatus)

	if len(discoveries) != 1 {
		t.Fatalf("expected 1 valid discovery after strict filtering, got %d", len(discoveries))
	}
	if discoveries[0].Title != "Valid Discovery" {
		t.Fatalf("unexpected surviving discovery title: %q", discoveries[0].Title)
	}
	if discoveries[0].Impact != "This could redirect the operational plan immediately." {
		t.Fatalf("expected impact to be clamped to one sentence, got %q", discoveries[0].Impact)
	}
}

func extractReviewer(prompt string) string {
	for _, reviewer := range []string{
		"Overclaim Auditor",
		"Methodology Reviewer",
		"Practical Impact Reviewer",
		"LLM Systems Reviewer",
		"Retrieval Systems Reviewer",
	} {
		if strings.Contains(prompt, `"`+reviewer+`"`) {
			return reviewer
		}
	}
	return "Unknown Reviewer"
}
