package app

import (
	"context"
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

func triggerLocalCrawl(br *brain.Brain, filePaths []string, meta pipeline.RunMetadata) {
	tracker := pipeline.NewTracker(meta, models.LocalPipelineProgressSteps())
	ctx, cancel := context.WithCancel(context.Background())
	pipeline.RegisterCancellation(meta, cancel)

	go func() {
		defer pipeline.ForgetCancellation(meta.RunID)
		_, err := br.ProcessLocalFilesWithProgress(ctx, filePaths, tracker)
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
