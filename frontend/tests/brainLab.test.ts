import { afterEach, describe, expect, it } from 'vitest'
import { loadBrainLabEnabled, saveBrainLabEnabled } from '../src/utils/brainLab'

afterEach(() => {
  window.localStorage.clear()
})

describe('brainLab persistence', () => {
  it('defaults to enabled when no preference is stored', () => {
    expect(loadBrainLabEnabled()).toBe(true)
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

  it('falls back to enabled on corrupted storage', () => {
    window.localStorage.setItem('gorantula.brainLab.v1', '{not json')
    expect(loadBrainLabEnabled()).toBe(true)
  })

  it('falls back to enabled on non-boolean payloads', () => {
    window.localStorage.setItem('gorantula.brainLab.v1', JSON.stringify('yes'))
    expect(loadBrainLabEnabled()).toBe(true)
  })
})
