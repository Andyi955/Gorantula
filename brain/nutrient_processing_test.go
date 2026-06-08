package brain

import (
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func TestSquashDuplicateProcessedNutrientsMergesSameSourceURL(t *testing.T) {
	processed := []processedNutrient{
		{
			index:  0,
			memory: "Source: https://example.com/report?utm_source=feed\nContent: short",
			node: models.MemoryNode{
				ID:        "node-a",
				Title:     "Grid Report",
				Summary:   "Short summary.",
				FullText:  "short",
				SourceURL: "https://example.com/report?utm_source=feed",
			},
			ok: true,
		},
		{
			index:  1,
			memory: "Source: https://example.com/report#section\nContent: much richer evidence text",
			node: models.MemoryNode{
				ID:        "node-b",
				Title:     "Grid Report Update",
				Summary:   "Richer summary with more detail.",
				FullText:  "much richer evidence text with more useful details",
				SourceURL: "https://example.com/report#section",
			},
			ok: true,
		},
	}

	squashed := squashDuplicateProcessedNutrients(processed)

	if len(squashed) != 1 {
		t.Fatalf("expected duplicate source URLs to squash to one node, got %d", len(squashed))
	}
	node := squashed[0].node
	if node.ID != "node-b" {
		t.Fatalf("expected richer node to become canonical, got %q", node.ID)
	}
	if node.EvidenceCount != 2 {
		t.Fatalf("expected evidence count 2, got %d", node.EvidenceCount)
	}
	if len(node.DuplicateNodeIDs) != 1 || node.DuplicateNodeIDs[0] != "node-a" {
		t.Fatalf("expected duplicate node id node-a, got %#v", node.DuplicateNodeIDs)
	}
	if len(node.MergedSourceURLs) != 2 {
		t.Fatalf("expected both original source URLs to be retained, got %#v", node.MergedSourceURLs)
	}
}

func TestSquashDuplicateProcessedNutrientsMergesIdenticalExcerptsAcrossSources(t *testing.T) {
	processed := []processedNutrient{
		{
			index:  0,
			memory: "Source: https://example.com/a\nContent: Duplicate excerpt text.",
			node: models.MemoryNode{
				ID:        "node-a",
				Title:     "Duplicate A",
				Summary:   "Same summary.",
				FullText:  "AI grid demand rose sharply in the same ISO report.",
				SourceURL: "https://example.com/a",
			},
			ok: true,
		},
		{
			index:  1,
			memory: "Source: https://mirror.example/b\nContent: Duplicate excerpt text.",
			node: models.MemoryNode{
				ID:        "node-b",
				Title:     "Duplicate B",
				Summary:   "Same summary.",
				FullText:  " AI grid demand rose sharply in the same ISO report. ",
				SourceURL: "https://mirror.example/b",
			},
			ok: true,
		},
	}

	squashed := squashDuplicateProcessedNutrients(processed)

	if len(squashed) != 1 {
		t.Fatalf("expected identical evidence excerpts to squash to one node, got %d", len(squashed))
	}
	if squashed[0].node.EvidenceCount != 2 {
		t.Fatalf("expected evidence count 2, got %d", squashed[0].node.EvidenceCount)
	}
}

func TestSquashDuplicateProcessedNutrientsKeepsDistinctEvidence(t *testing.T) {
	processed := []processedNutrient{
		{
			index: 0,
			node: models.MemoryNode{
				ID:        "node-a",
				Title:     "Grid Report",
				Summary:   "Utilities report rising demand.",
				FullText:  "Utilities report rising demand from new data centers.",
				SourceURL: "https://example.com/grid",
			},
			ok: true,
		},
		{
			index: 1,
			node: models.MemoryNode{
				ID:        "node-b",
				Title:     "Chip Shipment",
				Summary:   "Chip shipments changed this quarter.",
				FullText:  "Memory chip shipments changed as vendors adjusted inventory.",
				SourceURL: "https://example.com/chips",
			},
			ok: true,
		},
	}

	squashed := squashDuplicateProcessedNutrients(processed)

	if len(squashed) != 2 {
		t.Fatalf("expected distinct evidence to remain separate, got %d", len(squashed))
	}
}
