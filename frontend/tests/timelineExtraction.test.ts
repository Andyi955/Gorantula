import { describe, expect, it } from 'vitest'
import type { Node } from 'reactflow'
import {
  buildTimelineSnapshotFromNodes,
  computeTimelineSourceFingerprint,
  extractTimelineEventsFromNodes,
} from '../src/utils/timelineExtraction'

const node = (id: string, data: Record<string, unknown>): Node => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data,
})

describe('timeline extraction', () => {
  it('extracts and sorts persona timeline events before imprecise events', () => {
    const events = extractTimelineEventsFromNodes([
      node('node-1', {
        title: 'Shipping Intel',
        personaInsights: [
          {
            timelineEvents: [
              { timestamp: 'Unknown', event: 'A witness described an undated transfer.', sourceNodeId: 'node-1' },
              { timestamp: '2024-01-15', event: 'Shipment departed.', sourceNodeId: 'node-1' },
            ],
          },
        ],
      }),
      node('node-2', {
        title: 'Port Report',
        personaInsights: [
          {
            timelineEvents: [
              { timestamp: '2023', event: 'Contract awarded.', sourceNodeId: 'node-2' },
            ],
          },
        ],
      }),
    ])

    expect(events.map((event) => event.event)).toEqual([
      'Contract awarded.',
      'Shipment departed.',
      'A witness described an undated transfer.',
    ])
    expect(events[0]).toEqual(expect.objectContaining({
      provenance: 'persona',
      sourceTitle: 'Port Report',
      datePrecision: 'year',
    }))
  })

  it('extracts DATE tags, ISO dates, month-name dates, and year references from board text', () => {
    const events = extractTimelineEventsFromNodes([
      node('node-1', {
        title: 'AI Governance Brief',
        summary: '[DATE:2026-05-13] EU policy shifted after a May 14, 2026 briefing.',
        fullText: 'The first audit started on 2025-11-02. The baseline was established in 2024.',
      }),
    ])

    expect(events.map((event) => event.timestamp)).toEqual([
      '2024',
      '2025-11-02',
      '2026-05-13',
      'May 14, 2026',
    ])
    expect(events.find((event) => event.timestamp === '2026-05-13')?.event)
      .toContain('EU policy shifted')
    expect(events.every((event) => event.sourceNodeId === 'node-1')).toBe(true)
  })

  it('deduplicates the same event from repeated board evidence', () => {
    const events = extractTimelineEventsFromNodes([
      node('node-1', {
        title: 'Duplicate Evidence',
        personaInsights: [
          {
            timelineEvents: [
              { timestamp: '2024-01-15', event: 'Shipment departed.', sourceNodeId: 'node-1' },
              { timestamp: '2024-01-15', event: 'Shipment departed.', sourceNodeId: 'node-1' },
            ],
          },
        ],
        summary: 'Shipment departed on 2024-01-15.',
      }),
    ])

    expect(events.filter((event) => event.event === 'Shipment departed.')).toHaveLength(1)
  })

  it('changes the source fingerprint when evidence text changes', () => {
    const before = computeTimelineSourceFingerprint([
      node('node-1', { title: 'Intel', summary: 'Filed on 2024-01-15.' }),
    ])
    const after = computeTimelineSourceFingerprint([
      node('node-1', { title: 'Intel', summary: 'Filed on 2024-01-16.' }),
    ])

    expect(after).not.toBe(before)
  })

  it('builds a persisted timeline snapshot with generated metadata', () => {
    const snapshot = buildTimelineSnapshotFromNodes([
      node('node-1', { title: 'Intel', summary: 'Filed on 2024-01-15.' }),
    ], '2026-05-14T12:00:00.000Z')

    expect(snapshot.generatedAt).toBe('2026-05-14T12:00:00.000Z')
    expect(snapshot.sourceFingerprint).toMatch(/^tl-[a-z0-9]+$/)
    expect(snapshot.events).toHaveLength(1)
  })
})
