package app

import (
	"context"
	"log"
	"strings"

	"spider-agent/brain"
	"spider-agent/internal/pipeline"
	"spider-agent/models"
)

func extractScrapeImagesPreference(msg map[string]interface{}) bool {
	rawPreference, ok := msg["scrapeImages"]
	if !ok {
		return false
	}

	preference, ok := rawPreference.(bool)
	return ok && preference
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

func triggerCrawl(br *brain.Brain, prompt, vaultID string, appendToVault bool, scrapeImages bool, meta pipeline.RunMetadata) {
	tracker := pipeline.NewTracker(meta, models.DefaultPipelineProgressSteps())
	ctx, cancel := context.WithCancel(context.Background())
	pipeline.RegisterCancellation(meta, cancel)

	go func() {
		defer pipeline.ForgetCancellation(meta.RunID)
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
	log.Printf("[RabbitHole] accepted run=%s vault=%s mode=%s append=%t scrapeImages=%t continuationPass=%d priorFindings=%d suggestedQueries=%d", meta.RunID, vaultID, descentMode, appendToVault, scrapeImages, options.ContinuationPass, len(options.PriorFindings), len(options.SuggestedQueries))

	go func() {
		defer pipeline.ForgetCancellation(meta.RunID)
		_, err := br.ProcessRabbitHoleForVaultWithRunOptions(ctx, prompt, vaultID, appendToVault, scrapeImages, brain.RabbitHoleDescentMode(descentMode), tracker, options)
		if err != nil {
			if pipeline.IsCancellationError(err) {
				log.Printf("[RabbitHole] cancelled run=%s vault=%s", meta.RunID, vaultID)
				broadcastPipelineCancelled(tracker, "Stopped by operator")
				pipeline.ForgetTracker(meta.RunID)
				return
			}
			log.Printf("[RabbitHole] failed run=%s vault=%s err=%v", meta.RunID, vaultID, err)
			broadcast(tracker.Error("complete", err.Error()))
			saveAndBroadcastPipelineProfile(tracker)
			pipeline.ForgetTracker(meta.RunID)
			broadcast(models.WSMessage{
				Type:    "ERROR",
				Payload: err.Error(),
			})
			return
		}
		log.Printf("[RabbitHole] profile saved run=%s vault=%s", meta.RunID, vaultID)
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
