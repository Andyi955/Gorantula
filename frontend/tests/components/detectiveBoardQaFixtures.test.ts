import { describe, expect, it } from 'vitest'
import {
  QA_ANIMATION_DEMO_CONNECTIONS,
  QA_ANIMATION_DEMO_INSIGHTS,
  QA_ANIMATION_DEMO_NODE_COMPLETE_MS,
  QA_ANIMATION_DEMO_NODE_STEP_MS,
  QA_ANIMATION_DEMO_NODES,
  QA_DUPLICATE_SQUASH_DEMO_CONNECTIONS,
  QA_DUPLICATE_SQUASH_DEMO_NODES,
  QA_EVIDENCE_EXPANSION_IMAGE_SRC,
  QA_EVIDENCE_EXPANSION_NODE_ID,
  QA_RABBIT_HOLE_DEMO_CONNECTIONS,
  QA_RABBIT_HOLE_DEMO_NODES,
  QA_TEXT_FIT_DEMO_NODES,
  getQaAnimationDemoStagingPosition,
} from '../../src/components/detectiveBoardQaFixtures'

const idsFor = (items: readonly { id: string }[]) => new Set(items.map((item) => item.id))

describe('detective board QA fixtures', () => {
  it('keeps animation fixture timing and positions deterministic', () => {
    expect(QA_ANIMATION_DEMO_NODES).toHaveLength(10)
    expect(QA_ANIMATION_DEMO_NODE_COMPLETE_MS).toBe((QA_ANIMATION_DEMO_NODES.length - 1) * QA_ANIMATION_DEMO_NODE_STEP_MS)
    expect(getQaAnimationDemoStagingPosition(0)).toEqual({ x: 96, y: 96 })
    expect(getQaAnimationDemoStagingPosition(999)).toEqual({ x: 96, y: 96000 })
  })

  it('keeps animation insights and connections tied to fixture node ids', () => {
    const animationNodeIds = idsFor(QA_ANIMATION_DEMO_NODES)

    expect(QA_ANIMATION_DEMO_INSIGHTS[0].nodeIDs).toEqual(QA_ANIMATION_DEMO_NODES.map((node) => node.id))
    QA_ANIMATION_DEMO_CONNECTIONS.forEach((connection) => {
      expect(animationNodeIds.has(connection.source)).toBe(true)
      expect(animationNodeIds.has(connection.target)).toBe(true)
      expect(connection.confidence).toBeGreaterThan(0)
    })
  })

  it('keeps duplicate and Rabbit Hole connection fixtures tied to their nodes', () => {
    const duplicateIds = idsFor(QA_DUPLICATE_SQUASH_DEMO_NODES)
    const rabbitIds = idsFor(QA_RABBIT_HOLE_DEMO_NODES)

    QA_DUPLICATE_SQUASH_DEMO_CONNECTIONS.forEach((connection) => {
      expect(duplicateIds.has(connection.source)).toBe(true)
      expect(duplicateIds.has(connection.target)).toBe(true)
    })

    QA_RABBIT_HOLE_DEMO_CONNECTIONS.forEach((connection) => {
      expect(rabbitIds.has(connection.source)).toBe(true)
      expect(rabbitIds.has(connection.target)).toBe(true)
    })
  })

  it('keeps evidence expansion and text-fit fixtures browser-only and explicit', () => {
    expect(QA_EVIDENCE_EXPANSION_NODE_ID).toBe('qa-evidence-expansion-node')
    expect(QA_EVIDENCE_EXPANSION_IMAGE_SRC).toContain('data:image/svg+xml')
    expect(QA_TEXT_FIT_DEMO_NODES.every((node) => node.legacyWidth === 336)).toBe(true)
  })
})
