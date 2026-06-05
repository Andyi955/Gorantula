import type { Edge, Node } from 'reactflow'
import {
  buildSupportTethers,
  classifyRabbitHoleEvidenceNodes,
  layoutSupportingEvidenceNodes,
} from '../../src/components/supportingEvidenceLayer'

const rabbitNode = (id: string, data: Record<string, unknown> = {}, position = { x: 0, y: 0 }): Node => ({
  id,
  type: 'custom',
  position,
  style: { width: 336, height: 216 },
  data: {
    id,
    title: id,
    summary: `${id} summary`,
    origin: 'rabbit-hole',
    rabbitState: 'promoted',
    rabbitTool: 'web_search',
    rabbitPass: 1,
    ...data,
  },
})

const edge = (source: string, target: string, data: Record<string, unknown> = {}): Edge => ({
  id: `e-${source}-${target}`,
  source,
  target,
  data,
})

describe('supportingEvidenceLayer', () => {
  it('classifies unconnected Rabbit Hole nodes as supporting and connected Rabbit Hole nodes as primary', () => {
    const nodes = [
      rabbitNode('rabbit-primary'),
      rabbitNode('rabbit-support'),
      {
        id: 'plain-node',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { title: 'Plain node', evidenceRole: 'supporting', supportCluster: 'web' },
      } as Node,
    ]

    const classified = classifyRabbitHoleEvidenceNodes(nodes, [edge('rabbit-primary', 'plain-node')])

    expect(classified.find((node) => node.id === 'rabbit-primary')?.data.evidenceRole).toBe('primary')
    expect(classified.find((node) => node.id === 'rabbit-support')?.data.evidenceRole).toBe('supporting')
    expect(classified.find((node) => node.id === 'rabbit-support')?.data.supportCluster).toBe('web')
    expect(classified.find((node) => node.id === 'plain-node')?.data.evidenceRole).toBeUndefined()
    expect(classified.find((node) => node.id === 'plain-node')?.data.supportCluster).toBeUndefined()
  })

  it('promotes supporting Rabbit Hole nodes back to primary when a manual edge touches them', () => {
    const classified = classifyRabbitHoleEvidenceNodes(
      [rabbitNode('rabbit-manual'), rabbitNode('rabbit-other')],
      [edge('rabbit-manual', 'rabbit-other', { generatedBy: 'manual' })],
    )

    expect(classified.every((node) => node.data.evidenceRole === 'primary')).toBe(true)
  })

  it('lays supporting nodes into a compact sorted band below the primary cluster', () => {
    const { nodes, band } = layoutSupportingEvidenceNodes([
      rabbitNode('primary-a', {}, { x: 96, y: 96 }),
      rabbitNode('primary-b', {}, { x: 528, y: 96 }),
      rabbitNode('support-vault-pass-two', { title: 'Vault Pass Two', rabbitTool: 'vault_search', rabbitPass: 2 }),
      rabbitNode('support-timeline-pass-one', { title: 'Timeline Pass One', rabbitTool: 'timeline_context', rabbitPass: 1 }),
      rabbitNode('support-web-pass-one', { title: 'Web Pass One', rabbitTool: 'web_search', rabbitPass: 1 }),
    ], [edge('primary-a', 'primary-b')])

    expect(band).toEqual(expect.objectContaining({
      total: 3,
      counts: { web: 1, vault: 1, timeline: 1 },
    }))

    const supporting = nodes.filter((node) => node.data.evidenceRole === 'supporting')
    expect(supporting.map((node) => node.id)).toEqual([
      'support-web-pass-one',
      'support-timeline-pass-one',
      'support-vault-pass-two',
    ])
    supporting.forEach((node) => {
      expect(node.position.y).toBeGreaterThan(300)
      expect(node.style).toEqual(expect.objectContaining({ width: 288, height: 192 }))
      expect(node.data.isSupportEvidenceCompact).toBe(true)
    })
  })

  it('keeps an all-support Rabbit Hole board stable across repeated layout passes', () => {
    const firstLayout = layoutSupportingEvidenceNodes([
      rabbitNode('support-a', { rabbitTool: 'web_search' }, { x: 96, y: 120 }),
      rabbitNode('support-b', { rabbitTool: 'timeline_context' }, { x: 456, y: 120 }),
    ], [])

    const secondLayout = layoutSupportingEvidenceNodes(firstLayout.nodes, [])

    expect(secondLayout.nodes.map((node) => node.position)).toEqual(firstLayout.nodes.map((node) => node.position))
    expect(secondLayout.band?.y).toBe(firstLayout.band?.y)
  })

  it('preserves persisted supporting node positions when restoring a cleaned Rabbit Hole board', () => {
    const restoredNodes = [
      rabbitNode('primary-a', {}, { x: 96, y: 96 }),
      rabbitNode('primary-b', {}, { x: 528, y: 96 }),
      rabbitNode('support-web', {
        evidenceRole: 'supporting',
        supportCluster: 'web',
        isSupportEvidenceCompact: true,
      }, { x: 240, y: 720 }),
      rabbitNode('support-timeline', {
        evidenceRole: 'supporting',
        supportCluster: 'timeline',
        isSupportEvidenceCompact: true,
      }, { x: 600, y: 720 }),
    ]

    const { nodes } = layoutSupportingEvidenceNodes(restoredNodes, [edge('primary-a', 'primary-b')])

    expect(nodes.find((node) => node.id === 'support-web')?.position).toEqual({ x: 240, y: 720 })
    expect(nodes.find((node) => node.id === 'support-timeline')?.position).toEqual({ x: 600, y: 720 })
  })

  it('keeps expanded supporting evidence large but returns collapsed support evidence to compact size', () => {
    const expandedSupport = rabbitNode('support-expanded', {
      evidenceRole: 'supporting',
      supportCluster: 'web',
      isSupportEvidenceCompact: true,
      expanded: true,
    }, { x: 240, y: 720 })
    expandedSupport.style = { width: 480, height: 384 }

    const collapsedSupport = rabbitNode('support-collapsed', {
      evidenceRole: 'supporting',
      supportCluster: 'timeline',
      isSupportEvidenceCompact: true,
      expanded: false,
    }, { x: 780, y: 720 })
    collapsedSupport.style = { width: 480, height: 384 }

    const { nodes } = layoutSupportingEvidenceNodes([
      rabbitNode('primary-a', {}, { x: 96, y: 96 }),
      rabbitNode('primary-b', {}, { x: 528, y: 96 }),
      expandedSupport,
      collapsedSupport,
    ], [edge('primary-a', 'primary-b')])

    expect(nodes.find((node) => node.id === 'support-expanded')?.style).toEqual(expect.objectContaining({ width: 480, height: 384 }))
    expect(nodes.find((node) => node.id === 'support-collapsed')?.style).toEqual(expect.objectContaining({ width: 288, height: 192 }))
  })

  it('builds visual-only support tethers toward likely primary anchors', () => {
    const { nodes } = layoutSupportingEvidenceNodes([
      rabbitNode('primary-google', { title: 'Google Kairos Nuclear Deal', summary: 'Google and Kairos sign nuclear power agreement.' }, { x: 96, y: 96 }),
      rabbitNode('primary-microsoft', { title: 'Microsoft Helion PPA', summary: 'Microsoft signs Helion fusion power agreement.' }, { x: 528, y: 96 }),
      rabbitNode('support-google', { title: 'Google PPA Detail', summary: 'Google Kairos agreement adds 500 MW for data centers.' }),
    ], [edge('primary-google', 'primary-microsoft')])

    const tethers = buildSupportTethers(nodes, 'support-google')

    expect(tethers).toHaveLength(2)
    expect(tethers[0]).toEqual(expect.objectContaining({
      sourceId: 'support-google',
      targetId: 'primary-google',
      strength: 'matched',
    }))
    expect(tethers.every((tether) => tether.visualOnly)).toBe(true)
  })
})
