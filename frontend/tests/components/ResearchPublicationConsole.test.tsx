import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResearchPublicationConsole from '../../src/components/ResearchPublicationConsole';
const json = (value: unknown) => ({ ok: true, json: async () => value });
const initial = { id: 'paper1', revision: 'revision1', status: 'draft', stale: false, markdown: '# Candidate paper\n\nHypothesis only.', evidenceStatus: 'inconclusive', figures: [], audit: [], candidate: { hypothesis: 'Test hypothesis' } };
afterEach(() => vi.unstubAllGlobals());

describe('ResearchPublicationConsole', () => {
  it('requires review and sends explicit revision approval before local export', async () => {
    let draft = { ...initial };
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/runs')) return json([{ id: 'run1', status: 'completed', candidate: draft.candidate, results: [{}] }]);
      if (url.endsWith('/approve')) { draft = { ...draft, status: 'approved' }; return json(draft); }
      if (url.endsWith('/export')) return json({ ...draft, status: 'exported', exportPath: 'local/research-output/paper1' });
      if (url.endsWith('/publications') && !options?.method) return json([draft]);
      return json(draft);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ResearchPublicationConsole />);
    fireEvent.click(await screen.findByRole('button', { name: /Test hypothesis · draft/ }));
    const approve = await screen.findByRole('button', { name: 'Approve for sharing' });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(screen.getByLabelText('Reviewer name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Reviewer name')).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name.');
    fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'Andrew' } });
    fireEvent.change(screen.getByLabelText('Review notes'), { target: { value: 'Checked sources and figures' } });
    fireEvent.click(approve);
    expect(screen.getByRole('checkbox')).toHaveFocus();
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('button', { name: 'Export to local repo folder' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(approve);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export to local repo folder' })).toBeEnabled());
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/approve'));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ revision: 'revision1', operator: 'Andrew', reason: 'Checked sources and figures' });
    expect(screen.getByText('inconclusive')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export to local repo folder' }));
    expect(await screen.findByText(/Export folder: local/)).toBeInTheDocument();
  });
  it('blocks stale publication and remote images in source markdown', async () => {
    const draft = { ...initial, stale: true, markdown: '# Report\n\n![tracking](https://example.com/track.png)' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.endsWith('/runs') ? [] : url.endsWith('/publications') ? [draft] : draft)));
    render(<ResearchPublicationConsole />);
    fireEvent.click(await screen.findByRole('button', { name: /Test hypothesis/ }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve for sharing' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Export to local repo folder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('shows preparation errors without manufacturing a draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method) return { ok: false, text: async () => 'Verification replay mismatch' };
      return json(url.endsWith('/runs') ? [{ id: 'run1', status: 'completed', candidate: initial.candidate, results: [{}] }] : []);
    }));
    render(<ResearchPublicationConsole />);
    await screen.findByRole('option', { name: /Test hypothesis/ });
    fireEvent.change(screen.getByLabelText('Finished verification'), { target: { value: 'run1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare candidate paper' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Verification replay mismatch');
    expect(screen.queryByLabelText('Candidate paper')).not.toBeInTheDocument();
  });
  it('explains missing figures and each action prerequisite', async () => {
    const draft = { ...initial, figures: [{ id: 'fig-001', title: 'Group means', caption: 'Recorded means', alt: 'Means' }] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.endsWith('/runs') ? [] : url.endsWith('/publications') ? [draft] : draft)));
    render(<ResearchPublicationConsole />);
    fireEvent.click(await screen.findByRole('button', { name: /Test hypothesis/ }));
    const approve = await screen.findByRole('button', { name: 'Approve for sharing' });
    expect(approve).toHaveAccessibleDescription(/Attach 1 missing figure image/);
    expect(screen.queryByRole('button', { name: 'Export to local repo folder' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('More sharing options'));
    expect(screen.getByRole('button', { name: 'Record withdrawal' })).toHaveAccessibleDescription('Available after this paper has been exported.');
    fireEvent.click(screen.getByText('Advanced: figures and attachments'));
    expect(screen.getByText(/A specification is data and instructions, not an image/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'Andrew' } });
    fireEvent.change(screen.getByLabelText('Review notes'), { target: { value: 'Reviewed' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(approve);
    expect(screen.getByRole('alert')).toHaveTextContent('missing a chart');
  });
  it('shows historical evidence issues and blocks approval', async () => {
    const issue = 'This report contains claims not selected for this candidate. Run a new verification and prepare a new paper.';
    const draft = { ...initial, reviewIssues: [issue] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.endsWith('/runs') ? [] : url.endsWith('/publications') ? [draft] : draft)));
    render(<ResearchPublicationConsole />);
    fireEvent.click(await screen.findByRole('button', { name: /Test hypothesis/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(issue);
    expect(screen.getByRole('button', { name: 'Approve for sharing' })).toHaveAccessibleDescription(issue);
    expect(screen.getByRole('button', { name: 'Approve for sharing' })).toBeEnabled();
  });

  it('keeps a draft private without submitting approval', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => json(initial));
    vi.stubGlobal('fetch', fetchMock);
    render(<ResearchPublicationConsole publicationId="paper1" />);
    fireEvent.click(await screen.findByRole('button', {name:'Keep private'}));
    expect(screen.getByRole('status')).toHaveTextContent('No sharing approval recorded');
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });
  it('explains a withdrawn revision instead of asking for approval', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({...initial, status:'withdrawn'})));
    render(<ResearchPublicationConsole publicationId="paper1" />);
    expect(await screen.findByRole('status')).toHaveTextContent('closed for sharing');
    expect(screen.queryByRole('button', {name:'Approve for sharing'})).not.toBeInTheDocument();
    expect(screen.getByText(/Sharing approval was withdrawn/)).toBeInTheDocument();
  });

});

