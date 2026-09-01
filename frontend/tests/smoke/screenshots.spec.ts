import { test, expect, type Page } from '@playwright/test'
import { openSmokeApp, seedBrowserQaData } from './helpers'

// Render-critique harness: captures the Brain panel views as screenshots so the
// design can be reviewed visually (frontend-craft render->critique loop).
// Screenshots are written to BRAIN_SHOT_DIR (temp dir outside the repo) and are
// not committed.

const shot = async (page: Page, name: string) => {
  const dir = process.env.BRAIN_SHOT_DIR || '.brain-shots'
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false })
}

const gatewayDefinitions = [
  {
    code: 'entity-date',
    name: 'Entity & Date',
    description: 'Fires when a named entity or a calendar date from the current investigation appears in an older one.',
    kind: 'recall',
    enabled: true,
    createdAt: '2026-07-18T20:00:00Z',
    updatedAt: '2026-07-18T20:00:00Z',
  },
  {
    code: 'source-domain',
    name: 'Source Domain',
    description: 'Fires when the current investigation and an older one cite sources from the same domain.',
    kind: 'recall',
    enabled: true,
    createdAt: '2026-07-18T20:00:00Z',
    updatedAt: '2026-07-18T20:00:00Z',
  },
  {
    code: 'relationship-tag',
    name: 'Relationship Tag',
    description: 'Fires when the same relationship tag connects evidence across investigations.',
    kind: 'recall',
    enabled: true,
    createdAt: '2026-07-18T20:00:00Z',
    updatedAt: '2026-07-18T20:00:00Z',
  },
  {
    code: 'contradiction',
    name: 'Contradiction',
    description: 'Fires when new evidence conflicts with claims remembered from an older case.',
    kind: 'contradiction',
    enabled: true,
    createdAt: '2026-07-18T20:00:00Z',
    updatedAt: '2026-07-18T20:00:00Z',
  },
]

const reason = (gateway: string, value: string, label: string, detail: string) => ({
  gateway,
  value,
  label,
  detail,
  currentNodeIds: ['qa-target-existing'],
  targetNodeIds: ['qa-source-lead'],
})

const makeSignal = (
  id: string,
  targetTitle: string,
  score: number,
  relevance: string,
  reasons: Array<ReturnType<typeof reason>>,
) => ({
  id,
  investigationId: 'qa-browser-target',
  investigationTitle: 'QA: Imported Target',
  targetInvestigationId: `qa-old-${id}`,
  targetTitle,
  score,
  relevance,
  gateways: Array.from(new Set(reasons.map((item) => item.gateway))),
  reasons,
  suggestedAction: 'Review older case',
  createdAt: '2026-06-05T12:00:00Z',
  updatedAt: '2026-06-06T09:00:00Z',
  dismissed: false,
  linked: false,
  activationCount: 3,
  lastFiredAt: '2026-06-06T09:00:00Z',
})

const signals = [
  makeSignal('signal-hot', 'Northgate Substation Case', 0.92, 'strong-memory', [
    reason('entity-date', 'ORG|northgate substation a-17', 'Northgate Substation A-17', 'Shared ORG "Northgate Substation A-17" appears in both investigations.'),
    reason('source-domain', 'example.com', 'example.com', 'Both investigations cite example.com evidence.'),
  ]),
  makeSignal('signal-bridge', 'Grid Procurement Dossier', 0.74, 'possible-bridge', [
    reason('relationship-tag', 'SUPPLY_RISK', 'SUPPLY_RISK', 'A repeated SUPPLY_RISK relationship appears across the QA memory cases.'),
  ]),
  makeSignal('signal-warm', 'Regional Blackout Memo', 0.66, 'possible-bridge', [
    reason('entity-date', 'DATE|2026-05-20', '2026-05-20', 'Shared DATE "2026-05-20" appears in both investigations.'),
  ]),
  makeSignal('signal-echo', 'Archive: Energy Seminar', 0.42, 'distant-echo', [
    reason('source-domain', 'archive.example.org', 'archive.example.org', 'Both investigations cite archive.example.org.'),
  ]),
  makeSignal('signal-noise', 'Unrelated Weather Log', 0.28, 'background-noise', [
    reason('entity-date', 'LOC|europe', 'Europe', 'Shared LOC "Europe" appears in both investigations.'),
  ]),
]

const suggestions = [
  {
    id: 'suggestion-cluster',
    investigationId: 'qa-browser-target',
    kind: 'cluster-review',
    status: 'active',
    title: 'Review active memory cluster',
    summary: 'The Northgate Substation cluster is active across 2 related investigations.',
    suggestedAction: 'Inspect recurring memory cluster',
    score: 0.88,
    thinkingGateway: 'inspect-pattern',
    thinkingLabel: 'Inspect pattern',
    thinkingReason: 'This memory region is strong enough for a user-approved focused Rabbit Hole pass.',
    actionMode: 'launch-follow-up',
    priority: 'high',
    reason: 'The Northgate Substation pattern is an active cluster with 2 related investigations.',
    relatedSignalIds: ['signal-hot'],
    relatedMemoryLinkIds: [],
    relatedClusterIds: ['brain-cluster-qa'],
    targetInvestigationIds: ['qa-old-signal-hot'],
    createdAt: '2026-06-05T12:00:00Z',
    updatedAt: '2026-06-05T12:01:00Z',
  },
  {
    id: 'suggestion-bridge',
    investigationId: 'qa-browser-target',
    kind: 'source-review',
    status: 'active',
    title: 'Compare bridge evidence',
    summary: 'A repeated source domain is useful context but needs comparison.',
    suggestedAction: 'Compare source domain',
    score: 0.71,
    thinkingGateway: 'compare-bridge',
    thinkingLabel: 'Compare bridge',
    actionMode: 'compare',
    priority: 'medium',
    reason: 'Review this Brain cue before deciding whether it deserves follow-up work.',
    relatedSignalIds: ['signal-bridge'],
    relatedMemoryLinkIds: [],
    relatedClusterIds: [],
    targetInvestigationIds: ['qa-old-signal-bridge'],
    createdAt: '2026-06-05T12:00:00Z',
    updatedAt: '2026-06-05T12:01:00Z',
  },
  {
    id: 'suggestion-gap',
    investigationId: 'qa-browser-target',
    kind: 'gap-review',
    status: 'active',
    title: 'Fill memory gap',
    summary: 'A distant echo needs sharper bridge evidence before steering follow-up work.',
    suggestedAction: 'Find stronger bridge',
    score: 0.58,
    thinkingGateway: 'fill-gap',
    thinkingLabel: 'Fill memory gap',
    thinkingReason: 'This cue needs sharper bridge evidence before it should steer a Rabbit Hole follow-up.',
    actionMode: 'fill-gap',
    priority: 'low',
    reason: 'Active firings are present without a user decision on whether they should become durable memory.',
    relatedSignalIds: ['signal-echo'],
    relatedMemoryLinkIds: [],
    relatedClusterIds: [],
    targetInvestigationIds: ['qa-old-signal-echo'],
    createdAt: '2026-06-05T12:00:00Z',
    updatedAt: '2026-06-05T12:01:00Z',
  },
]

const links = [
  {
    id: 'link-qa',
    signalId: 'signal-hot',
    fromInvestigationId: 'qa-browser-target',
    fromTitle: 'QA: Imported Target',
    toInvestigationId: 'qa-old-signal-hot',
    toTitle: 'Northgate Substation Case',
    score: 0.92,
    gateways: ['entity-date'],
    reasons: [reason('entity-date', 'ORG|northgate substation a-17', 'Northgate Substation A-17', 'Shared ORG "Northgate Substation A-17" appears in both investigations.')],
    suggestedAction: 'Review older case',
    createdAt: '2026-06-05T12:01:00Z',
    updatedAt: '2026-06-06T09:00:00Z',
    lastFiredAt: '2026-06-06T09:00:00Z',
    activationCount: 2,
    promotionType: 'manual',
  },
]

const clusters = [
  {
    id: 'brain-cluster-qa',
    label: 'Northgate Substation A-17',
    summary: 'Northgate Substation A-17 links 2 investigations through entity/date recall with 1 active signal and 1 durable memory link.',
    score: 0.88,
    status: 'active',
    dominantGateway: 'entity-date',
    gatewayCounts: { 'entity-date': 2 },
    memberInvestigationIds: ['qa-browser-target', 'qa-old-signal-hot'],
    members: [
      { investigationId: 'qa-browser-target', title: 'QA: Imported Target', role: 'current' },
      { investigationId: 'qa-old-signal-hot', title: 'Northgate Substation Case', role: 'memory' },
    ],
    signalIds: ['signal-hot'],
    memoryLinkIds: ['link-qa'],
    reasonSamples: signals[0].reasons,
    pinned: false,
    hidden: false,
    createdAt: '2026-06-05T12:00:00Z',
    updatedAt: '2026-06-06T09:00:00Z',
    lastActivatedAt: '2026-06-06T09:00:00Z',
  },
]

const gateways = gatewayDefinitions.map((definition, index) => ({
  definition,
  firingCount: [12, 8, 4, 1][index] ?? 0,
  activeCount: [7, 4, 2, 0][index] ?? 0,
  investigationCount: [5, 3, 2, 1][index] ?? 0,
  lastFiredAt: '2026-06-06T09:00:00Z',
  topSignalScore: [0.92, 0.78, 0.66, 0.42][index] ?? 0,
  topSignalTitle: ['Northgate Substation Case', 'Grid Procurement Dossier', 'Regional Blackout Memo', 'Archive: Energy Seminar'][index] ?? '',
}))

const gatewayDetail = {
  definition: gatewayDefinitions[0],
  values: [
    { value: 'ORG|northgate substation a-17', label: 'Northgate Substation A-17', count: 6, topScore: 0.92, topTitle: 'Northgate Substation Case', lastFiredAt: '2026-06-06T09:00:00Z' },
    { value: 'DATE|2026-05-20', label: '2026-05-20', count: 4, topScore: 0.74, topTitle: 'Regional Blackout Memo', lastFiredAt: '2026-06-05T09:00:00Z' },
    { value: 'ORG|acme grid', label: 'Acme Grid', count: 3, topScore: 0.66, topTitle: 'Regional Blackout Memo', lastFiredAt: '2026-06-04T09:00:00Z' },
    { value: 'LOC|europe', label: 'Europe', count: 2, topScore: 0.42, topTitle: 'Unrelated Weather Log', lastFiredAt: '2026-06-01T09:00:00Z' },
  ],
  routes: [
    {
      signalId: 'signal-hot',
      investigationId: 'qa-browser-target',
      investigationTitle: 'QA: Imported Target',
      targetInvestigationId: 'qa-old-signal-hot',
      targetTitle: 'Northgate Substation Case',
      value: 'ORG|northgate substation a-17',
      label: 'Northgate Substation A-17',
      detail: 'Shared ORG "Northgate Substation A-17" appears in both investigations.',
      score: 0.92,
      relevance: 'strong-memory',
      activationCount: 3,
      lastFiredAt: '2026-06-06T09:00:00Z',
      currentNodeIds: ['qa-target-existing'],
      targetNodeIds: ['qa-source-lead'],
    },
    {
      signalId: 'signal-warm',
      investigationId: 'qa-browser-target',
      investigationTitle: 'QA: Imported Target',
      targetInvestigationId: 'qa-old-signal-warm',
      targetTitle: 'Regional Blackout Memo',
      value: 'DATE|2026-05-20',
      label: '2026-05-20',
      detail: 'Shared DATE "2026-05-20" appears in both investigations.',
      score: 0.66,
      relevance: 'possible-bridge',
      activationCount: 1,
      lastFiredAt: '2026-06-05T09:00:00Z',
      currentNodeIds: ['qa-target-existing'],
      targetNodeIds: ['qa-source-lead'],
    },
    {
      signalId: 'signal-noise',
      investigationId: 'qa-browser-target',
      investigationTitle: 'QA: Imported Target',
      targetInvestigationId: 'qa-old-signal-noise',
      targetTitle: 'Unrelated Weather Log',
      value: 'LOC|europe',
      label: 'Europe',
      detail: 'Shared LOC "Europe" appears in both investigations.',
      score: 0.28,
      relevance: 'background-noise',
      activationCount: 1,
      lastFiredAt: '2026-06-01T09:00:00Z',
      currentNodeIds: ['qa-target-existing'],
      targetNodeIds: ['qa-source-lead'],
    },
  ],
  totalRoutes: 137,
  limit: 25,
  firingCount: 12,
  activeCount: 7,
}

const autonomy = {
  settings: {
    mode: 'off',
    maxAutoPreparedPerInvestigation: 1,
    maxActivePrepared: 3,
    updatedAt: '2026-06-05T12:00:00Z',
  },
  queue: [],
  audit: [],
}

const map = {
  investigationId: 'qa-browser-target',
  nodes: [],
  edges: [],
  regions: [],
  digest: [],
  summary: {
    visibleNodeCount: 0,
    edgeCount: 0,
    clusterCount: 0,
    linkedMemoryCount: 0,
    activeSignalCount: 0,
    suggestionCount: 0,
    strongestScore: 0,
  },
}

test.use({ viewport: { width: 1600, height: 1000 } })

test('capture brain views for design critique', async ({ page }) => {
  await page.route('**/api/brain/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const json = (data: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    })

    if (path.endsWith('/api/brain/signals')) {
      return json(signals)
    }
    if (path.endsWith('/api/brain/links')) {
      return json(links)
    }
    if (path.endsWith('/api/brain/map')) {
      return json(map)
    }
    if (path.endsWith('/api/brain/clusters')) {
      return json(clusters)
    }
    if (path.endsWith('/api/brain/gateways')) {
      return json(gateways)
    }
    if (path.includes('/api/brain/gateways/')) {
      return json(gatewayDetail)
    }
    if (path.endsWith('/api/brain/suggestions')) {
      return json(suggestions)
    }
    if (path.endsWith('/api/brain/followups')) {
      return json([])
    }
    if (path.endsWith('/api/brain/autonomy')) {
      return json(autonomy)
    }
    if (path.endsWith('/api/brain/attention')) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    }
    return json({})
  })

  await openSmokeApp(page)
  await seedBrowserQaData(page)

  await page.getByRole('button', { name: /^brain$/i }).click()
  await expect(page.getByTestId('brain-signals-panel')).toBeVisible()
  await expect(page.getByTestId('brain-pulse-view')).toBeVisible()
  await expect(page.getByTestId('brain-signal-card').first()).toBeVisible()
  await page.waitForTimeout(400)
  await shot(page, '01-pulse')

  await page.getByRole('button', { name: /active signals view/i }).click()
  const lowerPriorityToggle = page.getByRole('button', { name: /show lower-priority signals/i })
  if (await lowerPriorityToggle.count()) {
    await lowerPriorityToggle.click()
  }
  await page.waitForTimeout(300)
  await shot(page, '02-signals')

  await page.getByRole('button', { name: /next moves view/i }).click()
  await page.waitForTimeout(300)
  await shot(page, '03-moves')

  await page.getByRole('button', { name: /memory map view/i }).click()
  await page.waitForTimeout(400)
  await shot(page, '04-map')

  await page.getByRole('button', { name: /memory links view/i }).click()
  await page.waitForTimeout(300)
  await shot(page, '05-links')

  await page.getByRole('button', { name: /memory clusters view/i }).click()
  await page.waitForTimeout(300)
  await shot(page, '06-clusters')

  await page.getByRole('button', { name: /gateway registry view/i }).click()
  await expect(page.getByTestId('brain-gateway-card').first()).toBeVisible()
  await shot(page, '07-gateways')

  await page.getByRole('button', { name: /view routes for entity & date/i }).click()
  await expect(page.getByTestId('brain-gateway-detail')).toBeVisible()
  await expect(page.getByTestId('brain-gateway-route').first()).toBeVisible()
  await page.getByTestId('brain-gateway-detail').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await shot(page, '08-gateway-routes')

  await page.getByRole('button', { name: /focus view/i }).click()
  await expect(page.getByTestId('brain-focus-view')).toBeVisible()
  await shot(page, '09-focus')

  await page.getByRole('button', { name: /autonomy queue view/i }).click()
  await expect(page.getByTestId('brain-signals-panel')).toBeVisible()
  await shot(page, '10-autonomy')

  await expect(page.getByTestId('brain-signals-panel')).toBeVisible()
})
