package nervous_system

import (
	"context"
	"fmt"
	"github.com/Andyi955/Gorantula/legs"
	"github.com/Andyi955/Gorantula/models"
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

func (ns *NervousSystem) runWorker(ctx context.Context, legID int, nerveChannel <-chan models.NerveSignal, nutrientChannel chan<- models.NutrientFlow, waitGroup *sync.WaitGroup) {
	defer waitGroup.Done()

	for {
		select {
		case <-ctx.Done():
			return
		case signal, ok := <-nerveChannel:
			if !ok {
				return
			}

			fmt.Printf("[Leg %d] Received signal for target: %s (Local: %v, Chunk: %v)\n", legID, signal.TargetQuery, signal.IsLocal, signal.IsChunk)

			var flow models.NutrientFlow
			if signal.IsChunk {
				flow = legs.ExecuteChunkTaskWithContext(ctx, legID, signal.TargetQuery, signal.ChunkData, ns.Broadcast)
			} else if signal.IsLocal {
				flow = legs.ExecuteLocalFileTaskWithContext(ctx, legID, signal.TargetQuery, ns.Broadcast)
			} else if signal.IsMedia {
				flow = legs.ExecuteMediaTaskWithContext(ctx, legID, signal.TargetQuery, ns.Broadcast)
			} else {
				flow = legs.ExecuteLegTaskWithContext(ctx, legID, signal.TargetQuery, ns.Broadcast)
			}

			select {
			case nutrientChannel <- flow:
				fmt.Printf("[Leg %d] Sent nutrient back.\n", legID)
			case <-ctx.Done():
				return
			}
		}
	}
}

func (ns *NervousSystem) RunSignals(ctx context.Context, signals []models.NerveSignal) ([]models.NutrientFlow, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if len(signals) == 0 {
		return nil, ctx.Err()
	}

	nerveChannel := make(chan models.NerveSignal)
	nutrientChannel := make(chan models.NutrientFlow, len(signals))
	workerCount := 8
	if len(signals) < workerCount {
		workerCount = len(signals)
	}

	var waitGroup sync.WaitGroup
	for legID := 0; legID < workerCount; legID++ {
		waitGroup.Add(1)
		go ns.runWorker(ctx, legID, nerveChannel, nutrientChannel, &waitGroup)
	}

enqueueLoop:
	for _, signal := range signals {
		select {
		case <-ctx.Done():
			break enqueueLoop
		case nerveChannel <- signal:
		}
	}
	close(nerveChannel)
	waitGroup.Wait()
	close(nutrientChannel)

	nutrients := make([]models.NutrientFlow, 0, len(signals))
	for nutrient := range nutrientChannel {
		nutrients = append(nutrients, nutrient)
	}

	if err := ctx.Err(); err != nil {
		return nutrients, err
	}
	return nutrients, nil
}

// StartLegs starts the 8 goroutines
func (ns *NervousSystem) StartLegs() {
	for i := 0; i < 8; i++ {
		ns.WaitGroup.Add(1)
		go ns.RealWorker(i)
	}
}
