import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResearchVerificationConsole from '../../src/components/ResearchVerificationConsole';

const dataset = { id: 'data-1', name: 'Synthetic data', source: 'Synthetic fixture', columns: ['group', 'value'], rows: 4, digest: 'abc' };
const candidates = [{ id: 'candidate-1', hypothesis: 'Compare independent groups' }];
const json = (value: unknown) => ({ ok: true, json: async () => value });
const history = [{ id: 'run-1', status: 'completed', candidate: candidates[0], dataset, results: [{ call: { tool: 'stats-reanalysis' }, status: 'completed', verdict: 'inconclusive', summary: 'Calculated p = 0.33; not proof.', assumptions: ['Independent observations'], outputDigest: 'xyz' }], toolVersion: 'native-v1', runtime: 'go', implementationDigest: 'def', createdAt: '2026-09-05T00:00:00Z' }];

afterEach(() => vi.unstubAllGlobals());

describe('ResearchVerificationConsole', () => {
  it('submits typed manual inputs and shows computational results separately from approval', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/datasets')) return json([dataset]);
      if (url.endsWith('/verify')) return json(history[0]);
      if (url.endsWith('/runs')) return json(history);
      return json(history[0]);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ResearchVerificationConsole candidates={candidates} />);
    await screen.findByText('Calculated p = 0.33; not proof.');
    expect(screen.getByText('Hypothesis verdict: inconclusive')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Run mode'), { target: { value: 'manual' } });
    fireEvent.change(screen.getByLabelText('Dataset', {exact:true}), {target: {value: 'data-1'}});
    fireEvent.change(screen.getByLabelText('Group column'), { target: { value: 'group' } });
    fireEvent.change(screen.getByLabelText('Numeric value column'), { target: { value: 'value' } });
    fireEvent.change(screen.getByLabelText('Statement being tested'), { target: { value: 'Means differ' } });
    fireEvent.change(screen.getByLabelText('Why this method and dataset?'), { target: { value: 'Independent synthetic observations' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run verification' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/verify'), expect.objectContaining({ method: 'POST' })));
    const submitted = fetchMock.mock.calls.find(([url]) => url.endsWith('/verify'));
    expect(JSON.parse(String(submitted?.[1]?.body))).toEqual({ mode: 'manual', candidateId: 'candidate-1', datasetId: 'data-1', calls: [{ tool: 'stats-reanalysis', groupColumn: 'group', valueColumn: 'value', statement: 'Means differ', rationale: 'Independent synthetic observations' }] });
  });

  it('surfaces API failures rather than reporting a successful run', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/datasets')) return json([dataset]);
      if (url.endsWith('/verify')) return { ok: false, text: async () => 'Configure a research provider first' };
      return json([]);
    }));
    render(<ResearchVerificationConsole candidates={candidates} />);
    await screen.findByRole('option', {name: /Synthetic data/});
    fireEvent.click(screen.getByRole('button', { name: 'Run verification' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Configure a research provider first');
    expect(screen.queryByText('completed')).not.toBeInTheDocument();
  });

  it('replays recorded runs without requesting model execution', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/datasets') ? json([dataset]) : url.endsWith('/runs') ? json(history) : json(history[0]));
    vi.stubGlobal('fetch', fetchMock);
    render(<ResearchVerificationConsole candidates={candidates} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Replay without a model' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/verify'), expect.objectContaining({ body: JSON.stringify({ mode: 'replay', replayOf: 'run-1' }) })));
    expect(screen.getByRole('link', { name: 'Download evidence bundle' })).toHaveAttribute('href', expect.stringContaining('/runs/run-1/bundle'));
  });

  it('disables execution when no candidate or dataset is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    render(<ResearchVerificationConsole candidates={[]} />);
    await screen.findByText(/No verification runs yet/);
    expect(screen.getByRole('button', { name: 'Run verification' })).toBeDisabled();
  });
  it('starts agent discovery without a CSV and keeps manual mode disabled', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => json([]));
    vi.stubGlobal('fetch', fetchMock);
    render(<ResearchVerificationConsole candidates={candidates} />);
    await screen.findByText(/No verification runs yet/);
    expect(screen.getByRole('button', {name: 'Run verification'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button', {name: 'Run verification'}));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/verify'), expect.objectContaining({body: JSON.stringify({mode: 'agent', candidateId: 'candidate-1'})})));
    fireEvent.change(screen.getByLabelText('Run mode'), {target: {value: 'manual'}});
    expect(screen.getByRole('button', {name: 'Run verification'})).toBeDisabled();
  });

  it('displays actual CSV inspection counts and samples', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/datasets') ? json([dataset]) : url.endsWith('/inspect') ? json({summary: 'Units are not inferred.', columns: [{name: 'value', numeric: 3, missing: 1, text: 0, min: 2, max: 9}], sample: [['a','2']]}) : json([])));
    render(<ResearchVerificationConsole candidates={candidates} />);
    await screen.findByRole('option', {name: /Synthetic data/});
    fireEvent.change(screen.getByLabelText('Dataset', {exact:true}), {target: {value: 'data-1'}});
    fireEvent.click(await screen.findByRole('button', {name: 'Inspect CSV'}));
    expect(await screen.findByText('Units are not inferred.')).toBeInTheDocument();
    expect(screen.getByText('2 to 9')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', {name: 'Missing'})).toBeInTheDocument();
  });

  it('defaults to agent discovery even when an unrelated dataset exists', async () => {
    const fetchMock = vi.fn(async (url: string) => json(url.endsWith('/datasets') ? [dataset] : []));
    vi.stubGlobal('fetch', fetchMock);
    render(<ResearchVerificationConsole candidates={candidates} />);
    await screen.findByRole('option', {name: /Synthetic data/});
    expect(screen.getByLabelText('Dataset', {exact:true})).toHaveValue('discover');
    fireEvent.click(screen.getByRole('button', {name: 'Run verification'}));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/verify'), expect.objectContaining({body: JSON.stringify({mode: 'agent', candidateId: 'candidate-1'})})));
  });

});
