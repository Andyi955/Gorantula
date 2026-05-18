package brain

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"spider-agent/models"
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
