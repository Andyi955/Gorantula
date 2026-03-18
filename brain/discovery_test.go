package brain

import (
	"context"
	"strings"
	"testing"

	"spider-agent/models"
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
