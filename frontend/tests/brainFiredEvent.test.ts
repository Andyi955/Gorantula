import { describe, expect, it } from 'vitest'
import { coerceBrainFiredEvent } from '../src/utils/brainMemory'

describe('coerceBrainFiredEvent', () => {
  it('accepts a complete BRAIN_FIRED payload', () => {
    const event = coerceBrainFiredEvent({
      investigationId: 'inv-current',
      source: 'board.json',
      firedCount: 3,
      promotedCount: 1,
      topScore: 0.91,
      topTitle: 'Older Grid Memory',
      firedAt: '2026-07-18T20:30:00Z',
    })

    expect(event).toEqual({
      investigationId: 'inv-current',
      source: 'board.json',
      firedCount: 3,
      promotedCount: 1,
      topScore: 0.91,
      topTitle: 'Older Grid Memory',
      firedAt: '2026-07-18T20:30:00Z',
    })
  })

  it('fills defaults for missing optional fields', () => {
    const event = coerceBrainFiredEvent({ investigationId: 'inv-current' })

    expect(event).toEqual({
      investigationId: 'inv-current',
      source: undefined,
      firedCount: 0,
      promotedCount: 0,
      topScore: 0,
      topTitle: undefined,
      firedAt: '',
    })
  })

  it('rejects non-object payloads', () => {
    expect(coerceBrainFiredEvent(null)).toBeNull()
    expect(coerceBrainFiredEvent(undefined)).toBeNull()
    expect(coerceBrainFiredEvent('BRAIN_FIRED')).toBeNull()
    expect(coerceBrainFiredEvent(['inv-current'])).toBeNull()
  })

  it('rejects payloads without a usable investigation id', () => {
    expect(coerceBrainFiredEvent({})).toBeNull()
    expect(coerceBrainFiredEvent({ investigationId: '   ' })).toBeNull()
    expect(coerceBrainFiredEvent({ investigationId: 42 })).toBeNull()
  })
})
