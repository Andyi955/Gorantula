package brain

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Andyi955/Gorantula/models"
)

type nutrientProcessingOptions struct {
	VaultID            string
	ScrapeImages       bool
	Provider           ModelProvider
	ImageReviewContext context.Context
	Progress           *models.PipelineProgressTracker
}

type processedNutrient struct {
	index          int
	memory         string
	node           models.MemoryNode
	ok             bool
	reviewedImages int
}

func nodeSummaryConcurrency() int {
	raw := strings.TrimSpace(os.Getenv("GORANTULA_NODE_SUMMARY_CONCURRENCY"))
	if raw == "" {
		return 8
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return 8
	}
	if parsed > 12 {
		return 12
	}
	return parsed
}

func (b *Brain) processNutrients(ctx context.Context, nutrients []models.NutrientFlow, options nutrientProcessingOptions) []processedNutrient {
	if ctx == nil {
		ctx = context.Background()
	}
	if len(nutrients) == 0 {
		return nil
	}

	workerCount := nodeSummaryConcurrency()
	if len(nutrients) < workerCount {
		workerCount = len(nutrients)
	}

	type nutrientJob struct {
		index    int
		nutrient models.NutrientFlow
	}

	jobs := make(chan nutrientJob)
	results := make(chan processedNutrient, len(nutrients))
	var waitGroup sync.WaitGroup

	for worker := 0; worker < workerCount; worker++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case job, ok := <-jobs:
					if !ok {
						return
					}
					result := b.processSingleNutrient(ctx, job.index, job.nutrient, options)
					select {
					case results <- result:
					case <-ctx.Done():
						return
					}
				}
			}
		}()
	}

enqueueLoop:
	for index, nutrient := range nutrients {
		select {
		case <-ctx.Done():
			break enqueueLoop
		case jobs <- nutrientJob{index: index, nutrient: nutrient}:
		}
	}
	close(jobs)
	waitGroup.Wait()
	close(results)

	processed := make([]processedNutrient, 0, len(nutrients))
	for result := range results {
		if result.ok {
			processed = append(processed, result)
		}
	}
	sort.SliceStable(processed, func(i, j int) bool {
		return processed[i].index < processed[j].index
	})
	return processed
}

func squashDuplicateProcessedNutrients(processed []processedNutrient) []processedNutrient {
	if len(processed) < 2 {
		return processed
	}

	squashed := make([]processedNutrient, 0, len(processed))
	sourceKeyIndex := make(map[string]int)
	textKeyIndex := make(map[string]int)

	for _, incoming := range processed {
		if !incoming.ok {
			continue
		}
		normalizeMergedEvidenceMetadata(&incoming.node)
		matchIndex := -1
		for _, key := range duplicateEvidenceKeys(incoming.node) {
			switch {
			case strings.HasPrefix(key, "source:"):
				if index, ok := sourceKeyIndex[key]; ok {
					matchIndex = index
				}
			case strings.HasPrefix(key, "text:"):
				if index, ok := textKeyIndex[key]; ok {
					matchIndex = index
				}
			}
			if matchIndex >= 0 {
				break
			}
		}
		if matchIndex < 0 {
			for index := range squashed {
				if areDuplicateEvidenceNodes(squashed[index].node, incoming.node) {
					matchIndex = index
					break
				}
			}
		}

		if matchIndex < 0 {
			squashed = append(squashed, incoming)
			registerDuplicateEvidenceKeys(len(squashed)-1, incoming.node, sourceKeyIndex, textKeyIndex)
			continue
		}

		merged := mergeDuplicateProcessedNutrient(squashed[matchIndex], incoming)
		squashed[matchIndex] = merged
		registerDuplicateEvidenceKeys(matchIndex, merged.node, sourceKeyIndex, textKeyIndex)
	}

	return squashed
}

func mergeDuplicateProcessedNutrient(existing processedNutrient, incoming processedNutrient) processedNutrient {
	existingCount := evidenceCount(existing.node)
	incomingCount := evidenceCount(incoming.node)
	primary := existing
	duplicate := incoming.node
	if evidenceRichnessScore(incoming.node) > evidenceRichnessScore(existing.node) {
		primary = incoming
		duplicate = existing.node
	}
	primary.index = min(existing.index, incoming.index)
	normalizeMergedEvidenceMetadata(&primary.node)

	duplicateIDs := append([]string(nil), primary.node.DuplicateNodeIDs...)
	duplicateIDs = appendUniqueString(duplicateIDs, duplicate.ID)
	duplicateIDs = appendUniqueStrings(duplicateIDs, duplicate.DuplicateNodeIDs)
	primary.node.DuplicateNodeIDs = duplicateIDs

	sourceURLs := append([]string(nil), primary.node.MergedSourceURLs...)
	sourceURLs = appendUniqueString(sourceURLs, primary.node.SourceURL)
	sourceURLs = appendUniqueString(sourceURLs, duplicate.SourceURL)
	sourceURLs = appendUniqueStrings(sourceURLs, duplicate.MergedSourceURLs)
	primary.node.MergedSourceURLs = sourceURLs
	primary.node.EvidenceCount = existingCount + incomingCount

	if len(primary.node.Images) == 0 && len(duplicate.Images) > 0 {
		primary.node.Images = append([]models.MemoryNodeImage(nil), duplicate.Images...)
	}

	return primary
}

func registerDuplicateEvidenceKeys(index int, node models.MemoryNode, sourceKeyIndex map[string]int, textKeyIndex map[string]int) {
	for _, key := range duplicateEvidenceKeys(node) {
		if strings.HasPrefix(key, "source:") {
			sourceKeyIndex[key] = index
		}
		if strings.HasPrefix(key, "text:") {
			textKeyIndex[key] = index
		}
	}
}

func duplicateEvidenceKeys(node models.MemoryNode) []string {
	keys := []string{}
	if sourceKey := normalizeEvidenceSourceURL(node.SourceURL); sourceKey != "" {
		keys = append(keys, "source:"+sourceKey)
	}
	if textKey := normalizeEvidenceText(node.FullText); len(textKey) >= 32 {
		keys = append(keys, "text:"+textKey)
	}
	return keys
}

func normalizeMergedEvidenceMetadata(node *models.MemoryNode) {
	if node == nil {
		return
	}
	if node.EvidenceCount < 1 {
		node.EvidenceCount = 1
	}
	node.MergedSourceURLs = appendUniqueString(node.MergedSourceURLs, node.SourceURL)
}

func evidenceCount(node models.MemoryNode) int {
	if node.EvidenceCount > 0 {
		return node.EvidenceCount
	}
	return 1
}

func evidenceRichnessScore(node models.MemoryNode) int {
	return len(strings.TrimSpace(node.FullText)) + len(strings.TrimSpace(node.Summary))*2 + len(node.Images)*500
}

func normalizeEvidenceSourceURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return strings.TrimRight(strings.ToLower(trimmed), "/")
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.TrimPrefix(strings.ToLower(parsed.Host), "www.")
	return strings.TrimRight(parsed.String(), "/")
}

func areDuplicateEvidenceNodes(left models.MemoryNode, right models.MemoryNode) bool {
	leftText := normalizeEvidenceText(evidenceComparisonText(left))
	rightText := normalizeEvidenceText(evidenceComparisonText(right))
	if len(leftText) < 32 || len(rightText) < 32 {
		return false
	}
	if leftText == rightText {
		return true
	}
	return evidenceTokenSimilarity(leftText, rightText) >= 0.92
}

func evidenceComparisonText(node models.MemoryNode) string {
	if strings.TrimSpace(node.FullText) != "" {
		return node.FullText
	}
	return strings.TrimSpace(node.Title + " " + node.Summary)
}

func normalizeEvidenceText(raw string) string {
	fields := strings.FieldsFunc(strings.ToLower(raw), func(r rune) bool {
		return !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'))
	})
	return strings.Join(fields, " ")
}

func evidenceTokenSimilarity(left string, right string) float64 {
	leftTokens := evidenceTokenSet(left)
	rightTokens := evidenceTokenSet(right)
	if len(leftTokens) == 0 || len(rightTokens) == 0 {
		return 0
	}
	intersection := 0
	for token := range leftTokens {
		if _, ok := rightTokens[token]; ok {
			intersection++
		}
	}
	union := len(leftTokens) + len(rightTokens) - intersection
	if union == 0 {
		return 0
	}
	return float64(intersection) / float64(union)
}

func evidenceTokenSet(text string) map[string]struct{} {
	tokens := make(map[string]struct{})
	for _, token := range strings.Fields(text) {
		if len(token) >= 4 {
			tokens[token] = struct{}{}
		}
	}
	return tokens
}

func appendUniqueStrings(values []string, incoming []string) []string {
	for _, value := range incoming {
		values = appendUniqueString(values, value)
	}
	return values
}

func appendUniqueString(values []string, value string) []string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return values
	}
	for _, existing := range values {
		if existing == trimmed {
			return values
		}
	}
	return append(values, trimmed)
}

func (b *Brain) processSingleNutrient(ctx context.Context, index int, nutrient models.NutrientFlow, options nutrientProcessingOptions) processedNutrient {
	if err := ctx.Err(); err != nil {
		return processedNutrient{index: index}
	}
	if nutrient.Error != nil {
		fmt.Printf("[Brain Warning] Leg %d returned error: %v\n", nutrient.LegID, nutrient.Error)
		return processedNutrient{index: index}
	}
	if strings.TrimSpace(nutrient.Content) == "" {
		return processedNutrient{index: index}
	}

	title, summary, err := b.summarizeNode(ctx, nutrient.Content)
	if err != nil || title == "" || strings.Contains(strings.ToLower(summary), "security access") || strings.Contains(strings.ToLower(summary), "failed to extract") {
		fmt.Printf("[Brain info] Skipping node for Leg %d due to low quality content or extraction failure.\n", nutrient.LegID)
		return processedNutrient{index: index}
	}

	memory := fmt.Sprintf("Source: %s\nContent: %s", nutrient.SourceURL, nutrient.Content)
	node := models.MemoryNode{
		ID:        fmt.Sprintf("node-%d-%d", time.Now().UnixNano(), index),
		Title:     title,
		Summary:   summary,
		FullText:  nutrient.Content,
		SourceURL: nutrient.SourceURL,
	}
	if options.ScrapeImages {
		imageCtx := options.ImageReviewContext
		if imageCtx == nil {
			imageCtx = ctx
		}
		node.Images = b.PersistRemoteNodeImages(imageCtx, options.Provider, options.VaultID, node.ID, nutrient.SourceURL, title, summary, nutrient.Content, nutrient.ImageURLs)
	}

	return processedNutrient{
		index:          index,
		memory:         memory,
		node:           node,
		ok:             true,
		reviewedImages: len(node.Images),
	}
}
