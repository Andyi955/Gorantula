import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ScientificResearchLab from '../../src/components/ScientificResearchLab';

const jsonResponse = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

const mockFetch = (data: {
  papers?: unknown;
  claims?: unknown;
  relations?: unknown;
  signals?: unknown;
}) =>
  vi.fn((url: RequestInfo | URL) => {
    const target = String(url);
    if (target.endsWith('/papers')) return Promise.resolve(jsonResponse(data.papers ?? []));
    if (target.endsWith('/claims')) return Promise.resolve(jsonResponse(data.claims ?? []));
    if (target.endsWith('/relations')) return Promise.resolve(jsonResponse(data.relations ?? []));
    if (target.endsWith('/signals')) return Promise.resolve(jsonResponse(data.signals ?? []));
    return Promise.resolve(jsonResponse([]));
  });

describe('ScientificResearchLab', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({
      papers: [{ id: 'm1', title: 'Metformin survival increase', year: 2024 }],
      claims: [
        { id: 'c1', paperId: 'm1', text: 'Metformin increases survival' },
        { id: 'c2', paperId: 'm2', text: 'Metformin decreases survival' },
      ],
      relations: [
        { id: 'r1', sourceClaimID: 'c1', targetClaimID: 'c2', relationKind: 'CONTRADICTS', basis: ['PRODUCT|metformin'] },
      ],
      signals: [
        {
          id: 's1',
          kind: 'contradiction',
          title: 'Contradiction: Metformin increases survival vs Metformin decreases survival',
          claimIDs: ['c1', 'c2'],
          paperIDs: ['m1', 'm2'],
          reasoning: 'Two claims about a shared entity point in opposite directions.',
          strength: 1,
        },
      ],
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces a contradiction finding card with a source paper chip', async () => {
    render(<ScientificResearchLab />);
    // The lab opens on the Overview; wait for it rather than for a specific
    // sub-view, so these tests do not depend on which tab is the default.
    await screen.findByRole('heading', { name: /Ask a question/i });
    fireEvent.click(screen.getByRole('button', { name: /Findings/ }));
    await waitFor(() => expect(screen.getByText(/Contradiction: Metformin increases/)).toBeInTheDocument());
    expect(screen.getByText('Contradiction')).toBeInTheDocument();
    expect(screen.getByText('m1')).toBeInTheDocument();
  });

  it('lists papers on the Corpus view with the count in the nav', async () => {
    render(<ScientificResearchLab />);
    await screen.findByRole('heading', { name: /Ask a question/i });
    // Wait for the fetched corpus to be reflected in the nav count.
    const corpusTab = screen.getByRole('button', { name: /Corpus/ });
    await waitFor(() => expect(corpusTab.textContent).toContain('1'));
    fireEvent.click(corpusTab);
    await waitFor(() => expect(screen.getByText('Metformin survival increase')).toBeInTheDocument());
  });
});
