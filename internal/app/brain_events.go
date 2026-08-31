package app

import (
	"github.com/Andyi955/Gorantula/internal/brainmemory"
	"github.com/Andyi955/Gorantula/models"
)

// brainEvidenceNotifier returns the callback invoked by the investigations
// API whenever evidence lands for an investigation. It recomputes brain
// signals, logs the firing, and broadcasts a BRAIN_FIRED websocket message so
// the UI can pulse and refresh without the Brain tab being opened first.
func brainEvidenceNotifier(service *brainmemory.Service) func(investigationID, source string) {
	log := appLog("brain")
	return func(investigationID, source string) {
		if service == nil {
			return
		}
		firing, err := service.NotifyEvidence(investigationID, source)
		if err != nil {
			log.Warn("brain evidence recompute failed",
				"investigation", investigationID,
				"source", source,
				"err", err,
			)
			return
		}
		if firing.FiredCount == 0 && firing.PromotedCount == 0 {
			log.Debug("brain evidence checked; nothing fired",
				"investigation", firing.InvestigationID,
				"source", firing.Source,
			)
			return
		}
		log.Info("brain synapses fired",
			"investigation", firing.InvestigationID,
			"source", firing.Source,
			"fired", firing.FiredCount,
			"promoted", firing.PromotedCount,
			"top_score", firing.TopScore,
			"top_title", firing.TopTitle,
		)
		broadcast(models.WSMessage{
			Type:    models.BrainFiredMessageType,
			Payload: firing,
		})
	}
}
