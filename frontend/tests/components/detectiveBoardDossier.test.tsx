import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  getDossierBodyBlocks,
  getDossierBrief,
  getDossierContextNote,
  getDossierKeySignals,
  getDossierMetaChips,
  getDossierSourceLinks,
  isDossierExternalLink,
  isDossierInternalReference,
  renderDossierBodyBlock,
  renderDossierTextWithLinks,
  type NodeDossier,
} from '../../src/components/detectiveBoardDossier'

const summary = 'A regulator filing links [ORG:Fermi] data center cooling demand near [LOC:Amarillo] to new water restrictions.'

const fullText = [
  'Rabbit tool: vault_search',
  'Query: data center water filing',
  'Rationale: Search older vault context for matching water and grid pressure.',
  '',
  'INTELLIGENCE SUMMARY',
  '',
  summary,
  '',
  'Source: https://example.com/dossier-water-filing',
  '',
  'The filing states that [PERSON:Toby Neugebauer] and higher compute load could change peak withdrawal limits during heat events.',
  '',
  '## Strategic Implications',
  '',
  'The filing reframes water demand as a public reliability problem.',
  '',
  '| Finding | Source | Date |',
  '|---|---|---|',
  '| [ORG:NERC] issued a reliability alert tied to peak load. | vault://inv-dossier-reader/node-dossier-a | [DATE:2026-05-27] |',
  '',
  '... | Amazon | Agility Robotics / Fauna Robotics | Acquisition signals dual industrial + consumer strategy. |',
  '[Excerpt continues]',
  '',
  '### **4. Key Challenges and Vulnerabilities**',
  '',
  '- **Meta** - Water permit overlap remains unresolved.',
  '- **NERC** - Alert timing creates a reliability pressure point.',
  '',
  '---',
  '',
  '* **Silicon Valley Blacklisting:** The policy note should render as a clean list item, not raw markdown.',
].join('\n')

const dossier: NodeDossier = {
  title: 'Data Center Water Filing',
  summary,
  fullText,
  sourceURL: 'vault://abdomen_vault/inv-old/dossier-water-filing.md',
  origin: 'rabbit-hole',
  rabbitTool: 'vault_search',
  rabbitPass: 2,
  evidenceRole: 'primary',
  images: [
    {
      id: 'img-a',
      path: 'local://image-a',
      sourceURL: 'https://example.com/image-a.jpg',
    },
  ],
}

describe('detectiveBoardDossier', () => {
  it('builds structured body blocks for headings, tables, excerpts, and lists', () => {
    const blocks = getDossierBodyBlocks(fullText)

    expect(blocks).toEqual(expect.arrayContaining([
      { kind: 'heading', text: 'Strategic Implications', level: 2 },
      { kind: 'heading', text: '4. Key Challenges and Vulnerabilities', level: 3 },
      { kind: 'excerpt', text: 'Excerpt begins mid-source' },
      { kind: 'excerpt', text: 'Excerpt continues' },
    ]))

    const table = blocks.find((block) => block.kind === 'table' && block.rows[0]?.[0] === 'Finding')
    expect(table).toEqual({
      kind: 'table',
      hasHeader: true,
      rows: [
        ['Finding', 'Source', 'Date'],
        ['[ORG:NERC] issued a reliability alert tied to peak load.', 'vault://inv-dossier-reader/node-dossier-a', '[DATE:2026-05-27]'],
      ],
    })

    const lists = blocks.filter((block) => block.kind === 'list')
    expect(lists[0]).toEqual({
      kind: 'list',
      items: [
        '**Meta** - Water permit overlap remains unresolved.',
        '**NERC** - Alert timing creates a reliability pressure point.',
      ],
    })
    expect(lists[1]).toEqual({
      kind: 'list',
      items: [
        '**Silicon Valley Blacklisting:** The policy note should render as a clean list item, not raw markdown.',
      ],
    })

    expect(getDossierBodyBlocks('… [ORG:NERC] mid-source warning continues.')).toEqual([
      { kind: 'excerpt', text: 'Excerpt begins mid-source' },
      { kind: 'paragraph', lines: ['[ORG:NERC] mid-source warning continues.'] },
    ])
  })

  it('builds dossier brief, key signals, source links, context notes, and meta chips', () => {
    expect(getDossierBrief(summary, fullText)).toBe(summary)
    expect(getDossierContextNote(dossier)).toBe('Based on a vault source excerpt')
    expect(getDossierMetaChips(dossier)).toEqual(['Rabbit Hole', 'Vault Search', 'Pass 2', 'Primary', '1 image'])

    const signals = getDossierKeySignals(summary, fullText)
    expect(signals).toContain(summary)
    expect(signals).toContain('The filing states that [PERSON:Toby Neugebauer] and higher compute load could change peak withdrawal limits during heat events.')
    expect(signals.join('\n')).not.toMatch(/Rabbit tool|Query|Source:/i)

    expect(getDossierSourceLinks(dossier)).toEqual([
      'vault://abdomen_vault/inv-old/dossier-water-filing.md',
      'https://example.com/image-a.jpg',
      'https://example.com/dossier-water-filing',
      'vault://inv-dossier-reader/node-dossier-a',
    ])
    expect(isDossierExternalLink('https://example.com/report')).toBe(true)
    expect(isDossierInternalReference('vault://inv/node')).toBe(true)
  })

  it('renders rich dossier text and body blocks with link/entity semantics', () => {
    render(
      <>
        {renderDossierTextWithLinks('See https://example.com/report and vault://inv/node from [ORG:Fermi] with **Meta** emphasis.')}
        {renderDossierBodyBlock({ kind: 'paragraph', lines: ['[PERSON:Toby Neugebauer] describes **cooling risk**.'] }, 0)}
      </>,
    )

    expect(screen.getByRole('link', { name: 'https://example.com/report' })).toHaveClass('forensic-dossier-inline-link')
    expect(screen.getByText('vault://inv/node')).toHaveClass('forensic-dossier-internal-ref')
    expect(screen.getByText('Fermi')).toHaveClass('forensic-dossier-entity-org')
    expect(screen.getByText('Meta')).toHaveClass('forensic-dossier-strong')
    expect(screen.getByText('Toby Neugebauer')).toHaveClass('forensic-dossier-entity-person')
    expect(screen.getByText('cooling risk')).toHaveClass('forensic-dossier-strong')
  })
})
