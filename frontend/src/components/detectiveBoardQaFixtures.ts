export const QA_ANIMATION_DEMO_NODES = [
    {
        id: 'qa-animation-grid-load',
        title: 'Grid Load Spike',
        summary: 'A regional utility report flags a sudden load spike near clustered AI data centers during a peak demand window.',
        fullText: 'A regional utility report flags a sudden load spike near clustered AI data centers during a peak demand window.',
        sourceURL: 'https://example.com/qa-grid-load',
    },
    {
        id: 'qa-animation-thermal-cooling',
        title: 'Thermal Cooling Alert',
        summary: 'A facilities memo links emergency cooling draw to the same substation corridor and notes elevated transformer temperatures.',
        fullText: 'A facilities memo links emergency cooling draw to the same substation corridor and notes elevated transformer temperatures.',
        sourceURL: 'https://example.com/qa-thermal-cooling',
    },
    {
        id: 'imported-qa-animation-brief',
        title: '[IMPORTED] Regulator Brief',
        summary: 'An imported regulator brief references prior near-miss events and recommends tighter demand-response rules for data center operators.',
        fullText: 'An imported regulator brief references prior near-miss events and recommends tighter demand-response rules for data center operators.',
        sourceURL: 'https://example.com/qa-regulator-brief',
    },
    {
        id: 'qa-animation-capacity-auction',
        title: 'Capacity Auction Shock',
        summary: 'A market note ties higher capacity prices to forecast AI compute load and warns that utility upgrades are lagging demand.',
        fullText: 'A market note ties higher capacity prices to forecast AI compute load and warns that utility upgrades are lagging demand.',
        sourceURL: 'https://example.com/qa-capacity-auction',
    },
    {
        id: 'qa-animation-demand-response',
        title: 'Operator Curtailment Plan',
        summary: 'A grid operator drafts a demand-response playbook requiring large campuses to shed load during fast voltage swings.',
        fullText: 'A grid operator drafts a demand-response playbook requiring large campuses to shed load during fast voltage swings.',
        sourceURL: 'https://example.com/qa-demand-response',
    },
    {
        id: 'qa-animation-backup-dispatch',
        title: 'Backup Dispatch Window',
        summary: 'Emergency backup generation was briefly dispatched after cooling systems and compute racks peaked at the same time.',
        fullText: 'Emergency backup generation was briefly dispatched after cooling systems and compute racks peaked at the same time.',
        sourceURL: 'https://example.com/qa-backup-dispatch',
    },
    {
        id: 'qa-animation-interconnection-queue',
        title: 'Interconnection Queue Delay',
        summary: 'A utility queue filing shows delayed interconnection studies for the same constrained substation corridor.',
        fullText: 'A utility queue filing shows delayed interconnection studies for the same constrained substation corridor.',
        sourceURL: 'https://example.com/qa-interconnection-queue',
    },
    {
        id: 'qa-animation-transformer-order',
        title: 'Transformer Order Slip',
        summary: 'A procurement note warns that transformer lead times slipped again, delaying planned upgrades for the load pocket.',
        fullText: 'A procurement note warns that transformer lead times slipped again, delaying planned upgrades for the load pocket.',
        sourceURL: 'https://example.com/qa-transformer-order',
    },
    {
        id: 'qa-animation-water-permit',
        title: 'Water Permit Constraint',
        summary: 'A cooling water permit amendment caps withdrawals during heat events, narrowing the operating window for the campus.',
        fullText: 'A cooling water permit amendment caps withdrawals during heat events, narrowing the operating window for the campus.',
        sourceURL: 'https://example.com/qa-water-permit',
    },
    {
        id: 'qa-animation-community-hearing',
        title: 'Community Hearing Pushback',
        summary: 'A local hearing transcript shows residents pressing officials about backup generators, water use, and grid reliability.',
        fullText: 'A local hearing transcript shows residents pressing officials about backup generators, water use, and grid reliability.',
        sourceURL: 'https://example.com/qa-community-hearing',
    },
] as const;

export const QA_ANIMATION_DEMO_STAGING_POSITIONS = [
    { x: 96, y: 96 },
    { x: 768, y: 384 },
    { x: 288, y: 672 },
    { x: 864, y: 96 },
    { x: 96, y: 456 },
    { x: 576, y: 672 },
    { x: 528, y: 96 },
    { x: 960, y: 456 },
    { x: 288, y: 384 },
    { x: 864, y: 672 },
] as const;

export const getQaAnimationDemoStagingPosition = (index: number) =>
    QA_ANIMATION_DEMO_STAGING_POSITIONS[index] || {
        x: 96 + (index % 3) * 384,
        y: 96 + Math.floor(index / 3) * 288,
    };

export const QA_ANIMATION_DEMO_NODE_STEP_MS = 220;
export const QA_ANIMATION_DEMO_NODE_COMPLETE_MS = (QA_ANIMATION_DEMO_NODES.length - 1) * QA_ANIMATION_DEMO_NODE_STEP_MS;
export const QA_GATHERING_STATUS_DEMO_MS = 5000;

export const QA_EVIDENCE_EXPANSION_NODE_ID = 'qa-evidence-expansion-node';
export const QA_EVIDENCE_EXPANSION_IMAGE_SRC = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22640%22 height=%22360%22 viewBox=%220 0 640 360%22%3E%3Crect width=%22640%22 height=%22360%22 fill=%22071118%22/%3E%3Crect x=%2238%22 y=%2244%22 width=%22564%22 height=%22272%22 fill=%220c1a22%22 stroke=%2281e3ff%22 stroke-width=%222%22 opacity=%220.78%22/%3E%3Cpath d=%22M70 112h260M70 150h430M70 188h380M70 226h300%22 stroke=%22%2381e3ff%22 stroke-width=%229%22 opacity=%220.28%22/%3E%3Ccircle cx=%22522%22 cy=%22128%22 r=%2248%22 fill=%22%23f6c879%22 opacity=%220.22%22/%3E%3Ctext x=%2270%22 y=%2286%22 fill=%22%2381e3ff%22 font-size=%2224%22 font-family=%22monospace%22 font-weight=%22700%22%3EQA VISUAL EVIDENCE%3C/text%3E%3C/svg%3E';

export const QA_DUPLICATE_SQUASH_DEMO_NODES = [
    {
        id: 'qa-duplicate-squashed-evidence',
        title: 'QA Squashed Duplicate Evidence',
        summary: 'Three duplicate excerpts from mirrored reports have been squashed into this single visible evidence card.',
        fullText: 'Three duplicate excerpts from mirrored reports have been squashed into this single visible evidence card. The merged card keeps source provenance while avoiding duplicate board clutter.',
        sourceURL: 'https://example.com/qa-duplicate-primary',
        evidenceCount: 3,
        mergedSourceURLs: [
            'https://example.com/qa-duplicate-primary',
            'https://mirror.example/qa-duplicate-primary',
            'https://wire.example/qa-duplicate-primary',
        ],
        duplicateNodeIds: ['qa-duplicate-source-a', 'qa-duplicate-source-b'],
    },
    {
        id: 'qa-duplicate-policy-response',
        title: 'Policy Response Lead',
        summary: 'A regulator memo responds to the same evidence cluster with proposed reporting requirements.',
        fullText: 'A regulator memo responds to the same evidence cluster with proposed reporting requirements.',
        sourceURL: 'https://example.com/qa-duplicate-policy',
    },
    {
        id: 'qa-duplicate-money-trail',
        title: 'Funding Pressure Note',
        summary: 'A market note links the evidence cluster to higher compliance and infrastructure costs.',
        fullText: 'A market note links the evidence cluster to higher compliance and infrastructure costs.',
        sourceURL: 'https://example.com/qa-duplicate-money',
    },
] as const;

export const QA_DUPLICATE_SQUASH_DEMO_POSITIONS = [
    { x: 160, y: 160 },
    { x: 640, y: 112 },
    { x: 640, y: 416 },
] as const;

export const QA_DUPLICATE_SQUASH_DEMO_CONNECTIONS = [
    {
        source: 'qa-duplicate-squashed-evidence',
        target: 'qa-duplicate-policy-response',
        tag: 'POLICY_TRIGGER',
        reasoning: 'The policy memo responds to the squashed evidence cluster.',
    },
    {
        source: 'qa-duplicate-money-trail',
        target: 'qa-duplicate-squashed-evidence',
        tag: 'MONEY_TRAIL',
        reasoning: 'The cost note adds financial pressure context to the squashed evidence cluster.',
    },
] as const;

export const QA_TEXT_FIT_DEMO_NODES = [
    {
        id: 'qa-text-fit-sentiment',
        title: 'QA Global AI Sentiment Stress Text',
        legacyWidth: 336,
        summary: 'Recent surveys from [ORG:PEW RESEARCH CENTER] show respondents in [LOC:MALAYSIA], [LOC:THAILAND], [LOC:INDONESIA], and [LOC:SINGAPORE] splitting sharply on AI benefits while telecom filings, school guidance, labor concerns, newsroom policies, and public-trust notes all stack into line seven and line eight pressure that should still remain readable instead of disappearing under the collapsed card mask.',
        fullText: 'Recent surveys from PEW RESEARCH CENTER show respondents in Malaysia, Thailand, Indonesia, and Singapore splitting sharply on AI benefits. This QA node is intentionally wordy so the collapsed card must grow horizontally when the rendered preview reaches the seventh and eighth visual lines.',
        sourceURL: 'https://example.com/qa-text-fit-sentiment',
    },
    {
        id: 'qa-text-fit-milestones',
        title: 'QA AI Acceleration Milestones',
        legacyWidth: 336,
        summary: 'Over the past year, [ORG:AI SAFETY INSTITUTE], [ORG:IBM], [ORG:OpenAI], and [ORG:DeepMind] milestones crowded the same paragraph with long organization names, policy notes, benchmark caveats, procurement delays, safety memos, chip-capacity constraints, and line seven and line eight pressure that should trigger intelligent width growth before clipped text hides the final words.',
        fullText: 'Over the past year, AI SAFETY INSTITUTE, IBM, OpenAI, and DeepMind milestones crowded the same paragraph with long organization names and policy notes. The collapsed preview should widen by a grid block or two when the browser measures hidden overflow.',
        sourceURL: 'https://example.com/qa-text-fit-milestones',
    },
    {
        id: 'qa-text-fit-chip-density',
        title: 'QA Chip Density Preview',
        legacyWidth: 336,
        summary: 'A dense preview with [DATE:2026-05-25], [PERSON:Sam Altman], [PERSON:Jensen Huang], [ORG:NVIDIA], [ORG:Microsoft], [ORG:Google], supplier exceptions, export paperwork, inference-demand forecasts, cloud-region constraints, and multiple procurement clauses creates line seven and line eight pressure for visual QA without requiring a backend crawl.',
        fullText: 'A dense preview with dates, people, organizations, and procurement clauses creates visual pressure for collapsed text QA without requiring a backend crawl. It should be wide enough that the final visible line is not horizontally or vertically clipped.',
        sourceURL: 'https://example.com/qa-text-fit-chip-density',
    },
] as const;

export const QA_TEXT_FIT_DEMO_POSITIONS = [
    { x: 120, y: 128 },
    { x: 760, y: 128 },
    { x: 1400, y: 128 },
] as const;

export const QA_RABBIT_HOLE_DEMO_PROMOTION_MS = 1450;

export const QA_RABBIT_HOLE_DEMO_NODES = [
    {
        id: 'qa-rabbit-web-descent',
        title: 'QA Rabbit Web Descent',
        summary: 'Rabbit Hole web_search follows data center grid pressure, cooling water filings, and operator reliability warnings into a live provisional evidence trail.',
        fullText: 'Rabbit Hole web_search follows data center grid pressure, cooling water filings, and operator reliability warnings into a live provisional evidence trail. This browser-only QA node should appear as RABBIT TRAIL / ACTIVE before promotion.',
        sourceURL: 'https://example.com/qa-rabbit-web-descent',
        rabbitTool: 'web_search',
        confidence: 0.82,
    },
    {
        id: 'qa-rabbit-vault-echo',
        title: 'QA Rabbit Vault Echo',
        summary: 'Rabbit Hole vault_search finds an older investigation that mentions the same substation corridor, water constraint, and procurement delay pattern.',
        fullText: 'Rabbit Hole vault_search finds an older investigation that mentions the same substation corridor, water constraint, and procurement delay pattern. It is intentionally clickable while still provisional.',
        sourceURL: 'vault://qa-browser-prior-near-miss',
        rabbitTool: 'vault_search',
        confidence: 0.76,
    },
    {
        id: 'qa-rabbit-timeline-rift',
        title: 'QA Rabbit Timeline Rift',
        summary: 'Rabbit Hole timeline_context extracts May 2026 filings, hearing dates, and operator notes into a chronological pressure trail for the Gatekeeper.',
        fullText: 'Rabbit Hole timeline_context extracts May 2026 filings, hearing dates, and operator notes into a chronological pressure trail for the Gatekeeper.',
        sourceURL: 'timeline://qa-rabbit-hole',
        rabbitTool: 'timeline_context',
        confidence: 0.79,
    },
] as const;

export const QA_RABBIT_HOLE_DEMO_POSITIONS = [
    { x: 128, y: 136 },
    { x: 640, y: 136 },
    { x: 1152, y: 136 },
] as const;

export const QA_RABBIT_HOLE_DEMO_CONNECTIONS = [
    {
        source: 'qa-rabbit-web-descent',
        target: 'qa-rabbit-vault-echo',
        tag: 'HIDDEN_CONNECTION',
        reasoning: 'The live web trail and older vault memory share the same infrastructure stress pattern.',
    },
    {
        source: 'qa-rabbit-vault-echo',
        target: 'qa-rabbit-timeline-rift',
        tag: 'TIMELINE_LEAD',
        reasoning: 'The older memory gives the timeline context a prior event window to compare against the current descent.',
    },
] as const;

export const QA_ANIMATION_DEMO_INSIGHTS = [
    {
        personaName: 'Discovery',
        perspective: 'Looks for non-obvious operational patterns.',
        keyFindings: ['Grid load, cooling draw, capacity pricing, backup dispatch, and curtailment planning point to the same reliability pressure.'],
        observations: ['The load spike, thermal alert, market shock, and backup dispatch cluster around the same operational stress pattern.'],
        hypotheses: ['Clustered AI compute demand is creating repeatable grid stress rather than isolated incidents.'],
        connections: ['The scattered evidence resolves into a single chain: load growth, cooling demand, market pressure, operator response, and regulatory action.'],
        questions: ['Which operators are tied to the constrained corridor?'],
        confidence: 0.86,
        fullAnalysis: 'The demo evidence suggests a recurring reliability pattern across load, cooling, market, backup, operator, and regulatory signals.',
        nodeIDs: QA_ANIMATION_DEMO_NODES.map((node) => node.id),
    },
];

export const QA_ANIMATION_DEMO_CONNECTIONS = [
    {
        source: 'qa-animation-grid-load',
        target: 'qa-animation-thermal-cooling',
        tag: 'INFRASTRUCTURE_STRESS',
        reasoning: 'The load spike and cooling alert point to the same stressed infrastructure corridor.',
        confidence: 0.86,
    },
    {
        source: 'qa-animation-thermal-cooling',
        target: 'imported-qa-animation-brief',
        tag: 'REGULATORY_SIGNAL',
        reasoning: 'The regulator brief references the same cooling and substation pressure pattern.',
        confidence: 0.82,
    },
    {
        source: 'qa-animation-capacity-auction',
        target: 'qa-animation-grid-load',
        tag: 'MARKET_PRESSURE',
        reasoning: 'The auction shock follows the same AI load forecasts that triggered the utility stress warning.',
        confidence: 0.8,
    },
    {
        source: 'qa-animation-demand-response',
        target: 'qa-animation-grid-load',
        tag: 'DEMAND_RESPONSE',
        reasoning: 'The curtailment plan is an operator response to fast voltage swings caused by clustered load spikes.',
        confidence: 0.84,
    },
    {
        source: 'qa-animation-backup-dispatch',
        target: 'qa-animation-thermal-cooling',
        tag: 'RESILIENCE_GAP',
        reasoning: 'Backup dispatch coincides with the same cooling-demand peak flagged in the facilities alert.',
        confidence: 0.78,
    },
    {
        source: 'qa-animation-interconnection-queue',
        target: 'qa-animation-capacity-auction',
        tag: 'INTERCONNECTION_DELAY',
        reasoning: 'Delayed interconnection studies explain why capacity prices are reacting faster than physical upgrades.',
        confidence: 0.81,
    },
    {
        source: 'qa-animation-transformer-order',
        target: 'qa-animation-interconnection-queue',
        tag: 'SUPPLY_CHAIN',
        reasoning: 'Transformer lead-time slips compound the interconnection queue and keep the constrained corridor underbuilt.',
        confidence: 0.79,
    },
    {
        source: 'qa-animation-water-permit',
        target: 'qa-animation-thermal-cooling',
        tag: 'WATER_CONSTRAINT',
        reasoning: 'The permit cap constrains cooling during the same heat windows that trigger the thermal alert.',
        confidence: 0.83,
    },
    {
        source: 'qa-animation-community-hearing',
        target: 'qa-animation-backup-dispatch',
        tag: 'PUBLIC_PRESSURE',
        reasoning: 'Community concerns focus on the backup dispatch pattern and its reliability tradeoffs.',
        confidence: 0.77,
    },
] as const;
