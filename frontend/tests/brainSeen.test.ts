import { afterEach, describe, expect, it } from 'vitest'
import {
  BRAIN_STRENGTHEN_DELTA,
  countUnseenBrainSignals,
  loadSeenBrainSignalScores,
  markBrainSignalsSeen,
} from '../src/utils/brainSeen'

const investigationId = 'inv-seen-test'

afterEach(() => {
  window.localStorage.clear()
})

describe('brainSeen seen-state', () => {
  it('counts every signal as unseen when nothing was recorded yet', () => {
    const count = countUnseenBrainSignals(investigationId, [
      { id: 'signal-a', score: 0.8 },
      { id: 'signal-b', score: 0.6 },
    ])
    expect(count).toBe(2)
  })

  it('marks signals seen so identical re-fires stop counting', () => {
    const signals = [
      { id: 'signal-a', score: 0.8 },
      { id: 'signal-b', score: 0.6 },
    ]
    markBrainSignalsSeen(investigationId, signals)

    expect(countUnseenBrainSignals(investigationId, signals)).toBe(0)
    expect(countUnseenBrainSignals(investigationId, [...signals, { id: 'signal-c', score: 0.5 }])).toBe(1)
  })

  it('counts a strengthened signal but tolerates tiny score drift', () => {
    markBrainSignalsSeen(investigationId, [{ id: 'signal-a', score: 0.5 }])

    expect(countUnseenBrainSignals(investigationId, [{ id: 'signal-a', score: 0.52 }])).toBe(0)
    expect(
      countUnseenBrainSignals(investigationId, [{ id: 'signal-a', score: 0.5 + BRAIN_STRENGTHEN_DELTA }]),
    ).toBe(1)
  })

  it('keeps investigations isolated and survives a reload of the storage', () => {
    markBrainSignalsSeen('inv-one', [{ id: 'shared-signal', score: 0.9 }])

    expect(countUnseenBrainSignals('inv-two', [{ id: 'shared-signal', score: 0.9 }])).toBe(1)
    expect(loadSeenBrainSignalScores('inv-one')['shared-signal']).toBe(0.9)
  })

  it('replaces the snapshot instead of accumulating stale signal ids', () => {
    markBrainSignalsSeen(investigationId, [{ id: 'signal-old', score: 0.4 }])
    markBrainSignalsSeen(investigationId, [{ id: 'signal-new', score: 0.7 }])

    const snapshot = loadSeenBrainSignalScores(investigationId)
    expect(snapshot).toEqual({ 'signal-new': 0.7 })
  })

  it('ignores malformed entries and blank investigation ids', () => {
    expect(countUnseenBrainSignals('   ', [{ id: 'signal-a', score: 0.8 }])).toBe(0)
    expect(markBrainSignalsSeen(investigationId, [{ id: '', score: 0.5 }, { score: 0.6 } as never])).toBeUndefined()
    expect(loadSeenBrainSignalScores(investigationId)).toEqual({})
  })
})
