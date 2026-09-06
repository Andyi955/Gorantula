import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResearchDataWorkbench from '../../src/components/ResearchDataWorkbench';
const json = (value: unknown) => ({ok: true, json: async () => value});
afterEach(() => vi.unstubAllGlobals());

describe('ResearchDataWorkbench', () => {
  it('reads DOCX without PDF page controls and saves the returned document reference', async () => {
    const fetchMock=vi.fn(async(_url: unknown, _options: RequestInit)=>json({sessionId:'prep',dataset:{},result:{summary:'Read DOCX.',extractionId:'docx-hash',tables:[{index:0,page:0,rows:[['site','visits'],['A','12']]}]}}));
    vi.stubGlobal('fetch',fetchMock);
    render(<ResearchDataWorkbench candidateId="candidate" datasets={[]} onDataset={vi.fn()} />);
    fireEvent.click(screen.getByText('Research data tools'));
    fireEvent.change(screen.getByLabelText('Data tool'),{target:{value:'paper-docx'}});
    expect(screen.queryByLabelText('PDF page')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Paper or observed supplement URL'),{target:{value:'https://example.org/supplement.docx'}});
    fireEvent.change(screen.getByLabelText('Preparation rationale'),{target:{value:'Inspect measurements'}});
    fireEvent.click(screen.getByRole('button',{name:'Run data tool'}));
    await screen.findByText('Read DOCX.');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).call).toEqual({tool:'paper-docx',url:'https://example.org/supplement.docx',page:0});
    fireEvent.click(screen.getByRole('button',{name:'Save extracted table 0'}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).call).toMatchObject({tool:'paper-table',page:0,extractionId:'docx-hash'});
  });
  it('shows validation warnings and keeps the saved preparation link', async () => {
    const fetchMock = vi.fn(async () => json({sessionId:'prep',dataset:{id:'left'},result:{summary:'Validation complete.',warnings:['Repeated IDs require design review'],counts:{duplicateRows:2}}}));
    vi.stubGlobal('fetch',fetchMock);
    render(<ResearchDataWorkbench candidateId="candidate" datasetId="left" datasets={[]} onDataset={vi.fn()} />);
    fireEvent.click(screen.getByText('Research data tools'));
    fireEvent.change(screen.getByLabelText('Observation ID column (optional)'),{target:{value:'subject'}});
    fireEvent.click(screen.getByRole('button',{name:'Run data tool'}));
    expect(await screen.findByText('Repeated IDs require design review')).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Download preparation evidence'})).toHaveAttribute('href',expect.stringContaining('/preparations/prep'));
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({body:expect.stringContaining('"idColumn":"subject"')}));
  });
  it('joins using explicit keys and selects the resulting dataset', async () => {
    const onDataset=vi.fn();const fetchMock=vi.fn(async () => json({sessionId:'prep',dataset:{id:'joined'},result:{summary:'2 matched, 1 unmatched.'}}));vi.stubGlobal('fetch',fetchMock);
    render(<ResearchDataWorkbench candidateId="candidate" datasetId="left" datasets={[{id:'right',name:'Right source'}]} onDataset={onDataset} />);
    fireEvent.click(screen.getByText('Research data tools'));
    fireEvent.change(screen.getByLabelText('Data tool'),{target:{value:'dataset-join'}});
    fireEvent.change(screen.getByLabelText('Left join key'),{target:{value:'id'}});
    fireEvent.change(screen.getByLabelText('Right join key'),{target:{value:'subject'}});
    fireEvent.change(screen.getByLabelText('Right dataset'),{target:{value:'right'}});
    fireEvent.change(screen.getByLabelText('Preparation rationale'),{target:{value:'Link observations by subject'}});
    fireEvent.click(screen.getByRole('button',{name:'Run data tool'}));
    await waitFor(()=>expect(onDataset).toHaveBeenCalledWith('joined'));
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({body:expect.stringContaining('"rightKey":"subject"')}));
  });
  it('retains PDF page references and requires a rationale to save a table', async () => {
    vi.stubGlobal('fetch',vi.fn(async ()=>json({sessionId:'prep',dataset:{},result:{summary:'Page extracted.',passages:[{source:'https://example.org/paper.pdf',page:2,offset:0,text:'group value',digest:'hash'}],tables:[{index:0,page:2,rows:[['group','value'],['a','1'],['b','2']]}]}})));
    render(<ResearchDataWorkbench candidateId="candidate" datasets={[]} onDataset={vi.fn()} />);
    fireEvent.click(screen.getByText('Research data tools'));
    fireEvent.change(screen.getByLabelText('Data tool'),{target:{value:'paper-extract'}});
    fireEvent.change(screen.getByLabelText('Paper or observed supplement URL'),{target:{value:'https://example.org/paper.pdf'}});
    fireEvent.change(screen.getByLabelText('PDF page'),{target:{value:'2'}});
    fireEvent.change(screen.getByLabelText('Preparation rationale'),{target:{value:'Check table'}});
    fireEvent.click(screen.getByRole('button',{name:'Run data tool'}));
    expect(await screen.findByText(/https:\/\/example.org\/paper.pdf · page 2/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Preparation rationale'),{target:{value:''}});
    expect(screen.getByRole('button',{name:'Save extracted table 0'})).toBeDisabled();
  });
  it('submits complex table layout and binds saving to the returned extraction', async () => {
    const fetchMock=vi.fn(async()=>json({sessionId:'prep',dataset:{},result:{summary:'Read table.',extractionId:'extract-123',tables:[{index:0,page:2,rows:[['Group','Value'],['Control','12.50'],['Treatment','42.75']]}]}}));
    vi.stubGlobal('fetch',fetchMock);
    render(<ResearchDataWorkbench candidateId="candidate" datasets={[]} onDataset={vi.fn()} />);
    fireEvent.click(screen.getByText('Research data tools'));
    fireEvent.change(screen.getByLabelText('Data tool'),{target:{value:'paper-complex-table'}});
    fireEvent.change(screen.getByLabelText('Paper or observed supplement URL'),{target:{value:'https://example.org/table.pdf'}});
    fireEvent.change(screen.getByLabelText('PDF page'),{target:{value:'2'}});
    fireEvent.change(screen.getByLabelText('Header rows'),{target:{value:'2'}});
    fireEvent.change(screen.getByLabelText('Column boundaries (% from left)'),{target:{value:'30, 60'}});
    fireEvent.change(screen.getByLabelText('Preparation rationale'),{target:{value:'Review multi-row headers'}});
    fireEvent.click(screen.getByRole('button',{name:'Run data tool'}));
    await screen.findByText('Read table.');
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({body:expect.stringContaining('"columnCuts":[30,60]')}));
    fireEvent.click(screen.getByRole('button',{name:'Save extracted table 0'}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({body:expect.stringContaining('"extractionId":"extract-123"')})));
  });

});
