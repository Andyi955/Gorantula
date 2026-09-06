import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResearchPipeline from '../../src/components/ResearchPipeline';

const candidate = {id:'candidate', hypothesis:'Compare the recorded samples'};
const run = {id:'run', status:'completed', pipelineStage:'review', publicationId:'paper', candidate, createdAt:'2026-09-05T00:00:00Z', request:{autoPrepare:true}, results:[{}]};
const paper = {id:'paper', revision:'revision', status:'draft', evidenceStatus:'inconclusive', candidate, figures:[], audit:[], markdown:'# Report', run:{interpretation:'The samples differ. The wider population remains uncertain.'}};
const json = (value: unknown) => ({ok:true, json:async () => value});
afterEach(() => vi.unstubAllGlobals());

describe('ResearchPipeline', () => {
  it('starts the agent without a dataset and opens the resulting report automatically', async () => {
    let started = false;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/verify')) { started = true; return json({...run, publicationId:undefined, status:'queued', pipelineStage:'checking'}); }
      if (url.endsWith('/runs')) return json(started ? [run] : []);
      if (url.endsWith('/publications/paper')) return json(paper);
      throw new Error(`Unexpected request: ${url} ${options?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ResearchPipeline candidates={[candidate]} />);
    fireEvent.click(screen.getByRole('button', {name:'Start research pipeline'}));
    expect(await screen.findByText('The samples differ. The wider population remains uncertain.', {}, {timeout:4000})).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/verify'), expect.objectContaining({body:JSON.stringify({mode:'agent', candidateId:'candidate', autoPrepare:true})}));
    expect(screen.queryByLabelText('Finished verification')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name:'Prepare candidate paper'})).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/approve') || url.endsWith('/export'))).toBe(false);
  });
  it('restores a saved pipeline without launching another model run', async () => {
    const fetchMock = vi.fn(async (url: string) => json(url.endsWith('/runs') ? [run] : paper));
    vi.stubGlobal('fetch', fetchMock);
    render(<ResearchPipeline candidates={[candidate]} />);
    await screen.findByText('The samples differ. The wider population remains uncertain.');
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/verify'))).toBe(false);
  });
  it('keeps missing evidence visible instead of displaying a fabricated report', async () => {
    const stopped = {...run, publicationId:undefined, pipelineStage:'needs_attention', reportError:'No suitable measurements found.', interpretation:'The linked source has no usable table.'};
    vi.stubGlobal('fetch', vi.fn(async () => json([stopped])));
    render(<ResearchPipeline candidates={[candidate]} />);
    await waitFor(() => expect(screen.getByText('No suitable measurements found.')).toBeInTheDocument());
    expect(screen.getByText('The linked source has no usable table.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name:'Ask the agent to try again'})).toBeEnabled();
    expect(screen.queryByRole('button', {name:'Approve for sharing'})).not.toBeInTheDocument();
  });
  it('starts online research from a typed topic without an existing candidate', async () => {
    const fetchMock = vi.fn(async (url: string) => json(url.endsWith('/verify') ? {...run,status:'running',pipelineStage:'searching',publicationId:undefined,stageMessage:'Searching online for papers.'} : []));
    vi.stubGlobal('fetch',fetchMock);
    render(<ResearchPipeline candidates={[]} />);
    fireEvent.change(screen.getByLabelText('New research topic'),{target:{value:'sleep and memory'}});
    fireEvent.click(screen.getByRole('button',{name:'Start research pipeline'}));
    await screen.findByText('Searching online for papers.');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/verify'),expect.objectContaining({body:JSON.stringify({mode:'agent',topic:'sleep and memory',autoPrepare:true})}));
    expect(screen.getByRole('list',{name:'Pipeline progress'}).querySelector('[aria-current="step"]')).toHaveTextContent('Source papers');
  });

});
