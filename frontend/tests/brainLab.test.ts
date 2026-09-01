import { afterEach, describe, expect, it } from 'vitest'
import { loadBrainLabEnabled, saveBrainLabEnabled } from '../src/utils/brainLab'

afterEach(() => {
  window.localStorage.clear()
})

describe('brainLab persistence', () => {
  it('defaults to compact when no preference is stored', () => {
    expect(loadBrainLabEnabled()).toBe(false)
  })

  it('persists a disabled lab across loads', () => {
    saveBrainLabEnabled(false)
    expect(loadBrainLabEnabled()).toBe(false)
  })

  it('persists an enabled lab across loads', () => {
    saveBrainLabEnabled(false)
    saveBrainLabEnabled(true)
    expect(loadBrainLabEnabled()).toBe(true)
  })

  it('falls back to compact on corrupted storage', () => {
    window.localStorage.setItem('gorantula.brainLab.v1', '{not json')
    expect(loadBrainLabEnabled()).toBe(false)
  })

  it('falls back to compact on non-boolean payloads', () => {
    window.localStorage.setItem('gorantula.brainLab.v1', JSON.stringify('yes'))
    expect(loadBrainLabEnabled()).toBe(false)
  })
})
