package app

import (
	"log"
	"strings"

	"spider-agent/internal/pipeline"
	"spider-agent/models"
)

func broadcastPipelineCancelled(tracker *models.PipelineProgressTracker, detail string) {
	if tracker == nil {
		return
	}
	if strings.TrimSpace(detail) == "" {
		detail = "Stopped by operator"
	}
	broadcast(tracker.Cancel("complete", detail))
	saveAndBroadcastPipelineProfile(tracker)
}

func saveAndBroadcastPipelineProfile(tracker *models.PipelineProgressTracker) {
	if tracker == nil {
		return
	}

	profile := tracker.Profile()
	if strings.TrimSpace(profile.RunID) == "" {
		return
	}
	if err := pipeline.ProfileStore().Save(profile); err != nil {
		log.Printf("[PipelineProfile] failed to save profile for %s: %v", profile.RunID, err)
		return
	}
	broadcast(models.WSMessage{
		Type: models.PipelineProfileSavedMessageType,
		Payload: map[string]interface{}{
			"runId":          profile.RunID,
			"vaultId":        profile.VaultID,
			"status":         profile.Status,
			"totalElapsedMs": profile.TotalElapsedMs,
		},
	})
}
