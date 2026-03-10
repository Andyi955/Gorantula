package nervous_system

import (
	"fmt"
	"spider-agent/legs"
	"spider-agent/models"
	"sync"
)

// The NervousSystem encapsulates the channels and waitgroup for the Spider
type NervousSystem struct {
	NerveChannel    chan models.NerveSignal
	NutrientChannel chan models.NutrientFlow
	WaitGroup       sync.WaitGroup
	Broadcast       models.Broadcaster
}

// NewNervousSystem initializes the channels
func NewNervousSystem(b models.Broadcaster) *NervousSystem {
	return &NervousSystem{
		NerveChannel:    make(chan models.NerveSignal, 8),
		NutrientChannel: make(chan models.NutrientFlow, 8),
		Broadcast:       b,
	}
}

// RealWorker processes the signals using the Legs senses
func (ns *NervousSystem) RealWorker(legID int) {
	defer ns.WaitGroup.Done()

	for signal := range ns.NerveChannel {
		fmt.Printf("[Leg %d] Received signal for target: %s (Local: %v, Chunk: %v)\n", legID, signal.TargetQuery, signal.IsLocal, signal.IsChunk)

		var flow models.NutrientFlow
		if signal.IsChunk {
			flow = legs.ExecuteChunkTask(legID, signal.TargetQuery, signal.ChunkData, ns.Broadcast)
		} else if signal.IsLocal {
			flow = legs.ExecuteLocalFileTask(legID, signal.TargetQuery, ns.Broadcast)
		} else if signal.IsMedia {
			flow = legs.ExecuteMediaTask(legID, signal.TargetQuery, ns.Broadcast)
		} else {
			flow = legs.ExecuteLegTask(legID, signal.TargetQuery, ns.Broadcast)
		}

		ns.NutrientChannel <- flow
		fmt.Printf("[Leg %d] Sent nutrient back.\n", legID)
	}
}

// StartLegs starts the 8 goroutines
func (ns *NervousSystem) StartLegs() {
	for i := 0; i < 8; i++ {
		ns.WaitGroup.Add(1)
		go ns.RealWorker(i)
	}
}
