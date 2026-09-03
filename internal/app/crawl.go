package app

import (
	"context"
	"strings"

	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/internal/pipeline"
	"github.com/Andyi955/Gorantula/models"
)

func extractScrapeImagesPreference(msg map[string]interface{}) bool {
	rawPreference, ok := msg["scrapeImages"]
	if !ok {
		return false
	}

	preference, ok := rawPreference.(bool)
	return ok && preference
}

// extractThinkingPreference reads the Spider View "deep reasoning" toggle.
// When enabled, targeted pipeline stages (query planning + final report)
// run with provider thinking at the gentle effort level; personas and
// relationship synthesis are never affected.
func extractThinkingPreference(msg map[string]interface{}) string {
	rawPreference, ok := msg["deepReasoning"]
	if !ok {
		return ""
	}
	preference, ok := rawPreference.(bool)
	if !ok || !preference {
		return ""
	}
	return "low"
}

func extractRabbitHoleDescentMode(msg map[string]interface{}) string {
	rawMode, ok := msg["descentMode"].(string)
	if !ok {
		return "guided"
	}
	switch strings.ToLower(strings.TrimSpace(rawMode)) {
	case "max":
		return "max"
	case "guided":
		return "guided"
	default:
		return "guided"
	}
}

func extractPositiveInt(value interface{}) int {
	switch typed := value.(type) {
	case int:
		if typed > 0 {
			return typed
		}
	case float64:
		if typed > 0 {
			return int(typed)
		}
	}
	return 0
}

func extractStringList(value interface{}) []string {
	rawList, ok := value.([]interface{})
	if !ok {
		return nil
	}
	clean := make([]string, 0, len(rawList))
	for _, raw := range rawList {
		text, ok := raw.(string)
		if !ok {
			continue
		}
		text = strings.TrimSpace(text)
		if text != "" {
			clean = append(clean, text)
		}
	}
	return clean
}

func extractRabbitHoleRunOptions(msg map[string]interface{}) brain.RabbitHoleRunOptions {
	return brain.RabbitHoleRunOptions{
		ContinuationPass: extractPositiveInt(msg["continuationPass"]),
		PriorFindings:    extractStringList(msg["priorFindings"]),
		SuggestedQueries: extractStringList(msg["suggestedQueries"]),
	}
}

func triggerCrawl(br *brain.Brain, prompt, vaultID string, appendToVault bool, scrapeImages bool, thinkingMode string, meta pipeline.RunMetadata) {
	tracker := pipeline.NewTracker(meta, models.DefaultPipelineProgressSteps())
	ctx, cancel := context.WithCancel(context.Background())
	if thinkingMode != "" {
		ctx = brain.WithThinkingOverride(ctx, thinkingMode)
	}
	pipeline.RegisterCancellation(meta, cancel)

	go func() {
		defer pipeline.ReleaseCancellation(meta)
		var err error
		if appendToVault {
			_, err = br.ProcessPromptIntoVaultWithProgress(ctx, prompt, vaultID, scrapeImages, tracker)
		} else if strings.TrimSpace(vaultID) != "" {
			_, err = br.ProcessPromptForVaultWithProgress(ctx, prompt, vaultID, scrapeImages, tracker)
		} else {
			_, err = br.ProcessPromptWithProgress(ctx, prompt, scrapeImages, tracker)
		}
		if err != nil {
			if pipeline.IsCancellationError(err) {
				broadcastPipelineCancelled(tracker, "Stopped by operator")
				pipeline.ForgetTracker(meta.RunID)
				return
			}
			broadcast(tracker.Error("complete", err.Error()))
			saveAndBroadcastPipelineProfile(tracker)
			pipeline.ForgetTracker(meta.RunID)
			broadcast(models.WSMessage{
				Type:    "ERROR",
				Payload: err.Error(),
			})
			return
		}
		saveAndBroadcastPipelineProfile(tracker)
	}()
}

func triggerRabbitHoleCrawl(br *brain.Brain, prompt, vaultID string, appendToVault bool, scrapeImages bool, descentMode string, options brain.RabbitHoleRunOptions, meta pipeline.RunMetadata) {
	tracker := pipeline.NewTracker(meta, models.RabbitHolePipelineProgressSteps())
	ctx, cancel := context.WithCancel(context.Background())
	pipeline.RegisterCancellation(meta, cancel)
	appLog("rabbit_hole").Info(
		"rabbit hole crawl accepted",
		"run", meta.RunID,
		"vault", vaultID,
		"mode", descentMode,
		"append", appendToVault,
		"scrape_images", scrapeImages,
		"continuation_pass", options.ContinuationPass,
		"prior_findings", len(options.PriorFindings),
		"suggested_queries", len(options.SuggestedQueries),
	)

	go func() {
		defer pipeline.ForgetCancellation(meta.RunID)
		_, err := br.ProcessRabbitHoleForVaultWithRunOptions(ctx, prompt, vaultID, appendToVault, scrapeImages, brain.RabbitHoleDescentMode(descentMode), tracker, options)
		if err != nil {
			if pipeline.IsCancellationError(err) {
				appLog("rabbit_hole").Info("rabbit hole crawl cancelled", "run", meta.RunID, "vault", vaultID)
				broadcastPipelineCancelled(tracker, "Stopped by operator")
				pipeline.ForgetTracker(meta.RunID)
				return
			}
			appLog("rabbit_hole").Error("rabbit hole crawl failed", "run", meta.RunID, "vault", vaultID, "err", err)
			broadcast(tracker.Error("complete", err.Error()))
			saveAndBroadcastPipelineProfile(tracker)
			pipeline.ForgetTracker(meta.RunID)
			broadcast(models.WSMessage{
				Type:    "ERROR",
				Payload: err.Error(),
			})
			return
		}
		appLog("rabbit_hole").Info("rabbit hole profile saved", "run", meta.RunID, "vault", vaultID)
		saveAndBroadcastPipelineProfile(tracker)
	}()
}

func triggerLocalCrawl(br *brain.Brain, filePaths []string, meta pipeline.RunMetadata) {
	tracker := pipeline.NewTracker(meta, models.LocalPipelineProgressSteps())
	ctx, cancel := context.WithCancel(context.Background())
	pipeline.RegisterCancellation(meta, cancel)

	go func() {
		defer pipeline.ForgetCancellation(meta.RunID)
		_, err := br.ProcessLocalFilesForVaultWithProgress(ctx, filePaths, meta.VaultID, tracker)
		if err != nil {
			if pipeline.IsCancellationError(err) {
				broadcastPipelineCancelled(tracker, "Stopped by operator")
				pipeline.ForgetTracker(meta.RunID)
				return
			}
			broadcast(tracker.Error("complete", err.Error()))
			saveAndBroadcastPipelineProfile(tracker)
			pipeline.ForgetTracker(meta.RunID)
			broadcast(models.WSMessage{
				Type:    "ERROR",
				Payload: err.Error(),
			})
			return
		}
		saveAndBroadcastPipelineProfile(tracker)
	}()
}
