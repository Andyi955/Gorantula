import { useCallback, useEffect, useRef, useState } from 'react';
import ResearchDataWorkbench from './ResearchDataWorkbench';
import { FlaskConical, Plus } from 'lucide-react';

const API = 'http://127.0.0.1:8080/api/research';
interface Dataset { id: string; name: string; source: string; columns: string[]; rows: number; digest: string; parentId?: string }
interface Inspection { summary: string; columns: { name: string; numeric: number; missing: number; text: number; min?: number; max?: number }[]; sample: string[][] }
interface Call { tool: string; groupColumn: string; valueColumn: string; statement: string; rationale: string }
interface Result { call: Call; status: string; verdict: string; summary: string; assumptions: string[]; svg?: string; metrics?: Record<string, number>; intervals?: Record<string, number[]>; outputDigest: string }
interface Run {
  id: string; status: string; error?: string; interpretation?: string; createdAt: string;
  candidate: { id: string; hypothesis: string }; dataset: Dataset; results: Result[];
  datasetActions?: {call: {tool: string}; summary: string; error?: string}[];
  toolVersion: string; implementationDigest: string; runtime: string; replayMatches?: boolean;
}
interface Props { candidates: { id: string; hypothesis: string }[] }

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, body === undefined ? { signal } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!response.ok) throw new Error((await response.text()) || `Request failed (${response.status})`);
  return response.json() as Promise<T>;
}
const field = 'mt-1 w-full min-w-0 rounded-lg border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-panel)] px-3 py-2 text-sm text-[var(--forensic-text)] placeholder-[var(--forensic-text-faint)] outline-none focus:border-[var(--forensic-accent)]';
const button = 'rounded-lg border border-[var(--forensic-border-soft)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--forensic-text-muted)] transition-colors hover:border-[var(--forensic-border)] hover:text-[var(--forensic-text)] disabled:opacity-40';
const primaryButton = 'rounded-lg border border-[var(--forensic-accent)] bg-[var(--forensic-glow)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--forensic-accent-strong)] transition-colors hover:border-[var(--forensic-accent-strong)] disabled:opacity-40';
// Match the research verdict palette; completion describes execution, not scientific support.
const statusTone = (status: string) => status === 'completed' ? 'text-[#90f3da] border-[#90f3da]/45 bg-[#90f3da]/10' : status === 'failed' ? 'text-[#ff8c86] border-[#ff8c86]/45 bg-[#ff8c86]/10' : 'text-[#f6c879] border-[#f6c879]/45 bg-[#f6c879]/10';
const card = 'rounded-xl border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-card)] p-4';

export default function ResearchVerificationConsole({ candidates }: Props) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [details, setDetails] = useState<Record<string, Run>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [csv, setCSV] = useState('');
  const [url, setURL] = useState('');
  const [inspection, setInspection] = useState<{id: string; value: Inspection}>();
  const [candidateId, setCandidateId] = useState('');
  const [datasetId, setDatasetId] = useState('discover');
  const [mode, setMode] = useState('agent');
  const [tool, setTool] = useState('stats-reanalysis');
  const [groupColumn, setGroupColumn] = useState('');
  const [valueColumn, setValueColumn] = useState('');
  const [statement, setStatement] = useState('');
  const [rationale, setRationale] = useState('');
  const mounted = useRef(true);
  const dataset = datasetId === 'discover' ? undefined : datasets.find(d => d.id === datasetId) ?? datasets[0];
  const candidate = candidates.find(c => c.id === candidateId) ?? candidates[0];

  const reload = useCallback(async (signal?: AbortSignal) => {
    const [data, history] = await Promise.all([request<Dataset[]>('/datasets', undefined, signal), request<Run[]>('/runs', undefined, signal)]);
    if (!mounted.current || signal?.aborted) return;
    setDatasets(data); setRuns(history); setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    // Sequential polling avoids overlapping requests; cleanup aborts the active
    // fetch so switching research views cannot update an unmounted console.
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await reload(controller.signal); }
      catch (e) { if (!controller.signal.aborted) { setError(String(e)); setLoading(false); } }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2500);
    };
    void poll();
    return () => { mounted.current = false; controller.abort(); clearTimeout(timer); };
  }, [reload]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await reload(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const loadDetail = async (id: string) => {
    try { const run = await request<Run>(`/runs/${id}`); if (mounted.current) setDetails(old => ({ ...old, [id]: run })); }
    catch (e) { if (mounted.current) setError(String(e)); }
  };

  return <section className="mt-4 flex flex-col gap-3" aria-label="Verification console">
    <div>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--forensic-text)]"><FlaskConical size={16} className="text-[var(--forensic-accent)]" aria-hidden />Check a research idea</h2>
      <p className="mt-1 text-xs leading-relaxed text-[var(--forensic-text-muted)]">Choose an idea and let the research agent look for data, choose the checks, and explain the results. You do not need to choose a statistical test.</p>
    </div>
    {error && <p role="alert" className="rounded-lg border border-[#ff8c86]/40 bg-[#ff8c86]/10 px-3 py-2 text-xs text-[#ffb0ab]">{error}</p>}
    <form className={`${card} grid gap-3 sm:grid-cols-2`} onSubmit={e => { e.preventDefault(); void act(() => request('/verify', {
      mode, candidateId: candidate?.id, datasetId: dataset?.id,
      ...(mode === 'manual' ? { calls: [{ tool, groupColumn, valueColumn, statement, rationale }] } : {}),
    })); }}>
      <label className="text-xs">Candidate<select required className={field} value={candidate?.id ?? ''} onChange={e => setCandidateId(e.target.value)}>
        {!candidates.length && <option value="">Add papers to create a candidate first</option>}
        {candidates.map(c => <option key={c.id} value={c.id}>{c.hypothesis}</option>)}
      </select></label>
      <label className="text-xs">Dataset<select required={mode === 'manual'} className={field} value={datasetId === 'discover' ? (mode === 'agent' ? 'discover' : '') : dataset?.id ?? ''} onChange={e => { setDatasetId(e.target.value); setGroupColumn(''); setValueColumn(''); }}>
        {mode === 'manual' && <option value="">Choose a dataset</option>}
        {mode === 'agent' && !datasets.length && <option value="discover">Find data from candidate papers</option>}
        {mode === 'agent' && datasets.length > 0 && <option value="discover">Find data from candidate papers</option>}
        {datasets.map(d => <option key={d.id} value={d.id}>{d.name} · {d.rows} rows</option>)}
      </select></label>
      {dataset && <p className="break-words text-xs text-[var(--forensic-text-muted)] sm:col-span-2">Source: {dataset.source}</p>}
      {dataset && <div className="sm:col-span-2">
        <button type="button" className={button} disabled={busy} onClick={() => void act(async () => {
          const value = await request<Inspection>(`/datasets/${dataset.id}/inspect`); setInspection({id: dataset.id, value});
        })}>Inspect CSV</button>
        {inspection?.id === dataset.id && <div className="mt-2 overflow-auto text-xs">
          <p className="text-[var(--forensic-text-muted)]">{inspection.value.summary}</p>
          {dataset.parentId && <p className="mt-1 break-all">Filtered from snapshot {dataset.parentId}</p>}
          <table className="mt-2 w-full text-left"><thead><tr>{['Column', 'Numeric', 'Missing', 'Text', 'Range'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>
            {inspection.value.columns.map(c => <tr key={c.name} className="border-t border-[var(--forensic-border-soft)]"><td className="p-2">{c.name}</td><td>{c.numeric}</td><td>{c.missing}</td><td>{c.text}</td><td>{c.min === undefined ? '—' : `${c.min} to ${c.max}`}</td></tr>)}
          </tbody></table>
          <details className="mt-2"><summary>Sample rows</summary><pre className="overflow-auto">{JSON.stringify(inspection.value.sample, null, 2)}</pre></details>
        </div>}
      </div>}
      <label className="text-xs">Run mode<select aria-label="Run mode" className={field} value={mode} onChange={e => setMode(e.target.value)}>
        <option value="agent">Let the research model choose tools</option><option value="manual">Choose a tool myself</option>
      </select></label>
      {mode === 'agent' && <p className="text-xs text-[var(--forensic-text-muted)]">The agent handles data preparation and method selection. It uses your configured research model and reports missing evidence instead of guessing.</p>}
      {mode === 'manual' && <>
        <label className="text-xs">Tool<select aria-label="Tool" className={field} value={tool} onChange={e => setTool(e.target.value)}><option value="stats-reanalysis">Statistics: two-group permutation test</option><option value="figure-reproduce">Figure: plot group means</option><option value="stats-paired">Paired comparison and interval</option><option value="stats-correlation">Pearson correlation and interval</option><option value="stats-regression">Simple linear regression</option><option value="stats-effects">Effect size and mean difference interval</option></select></label>
        <label className="text-xs">{['stats-paired', 'stats-correlation', 'stats-regression'].includes(tool) ? 'Numeric X / before column' : 'Group column'}<select aria-label="Group column" required className={field} value={groupColumn} onChange={e => setGroupColumn(e.target.value)}><option value="">Choose column</option>{dataset?.columns.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="text-xs">Numeric value column<select aria-label="Numeric value column" required className={field} value={valueColumn} onChange={e => setValueColumn(e.target.value)}><option value="">Choose column</option>{dataset?.columns.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="text-xs">Statement being tested<input required maxLength={2000} className={field} value={statement} onChange={e => setStatement(e.target.value)} /></label>
        <label className="text-xs">Why this method and dataset?<input required maxLength={2000} className={field} value={rationale} onChange={e => setRationale(e.target.value)} /></label>
        <p className="text-xs text-[var(--forensic-text-muted)] sm:col-span-2">Choose the method for the study design. Paired tools require one matched pair per row; correlation/regression require numeric X and Y. Independent-group tools do not support clustered observations. The figure plots means without error bars or published-figure matching.</p>
      </>}
      <button className={`${primaryButton} justify-self-start sm:col-span-2`} disabled={busy || !candidate || (mode === 'manual' && !dataset)}>Run verification</button>
    </form>

    <details className={card}>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--forensic-text)]"><Plus size={16} className="mr-2 inline text-[var(--forensic-accent)]" aria-hidden />Add a CSV dataset</summary>
      <button type="button" className={`${button} mt-3`} onClick={() => {
        setName('Known-answer synthetic example'); setSource('Synthetic tool test only: group a mean 2, group b mean 10; expected difference b minus a = 8. Not research evidence.');
        setCSV('group,value\na,1\na,3\nb,9\nb,11\n');
      }}>Load known-answer example</button>
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void act(async () => {
        const added = await request<Dataset>('/datasets', { name, source, csv });
        setDatasetId(added.id); setCSV(''); setName(''); setSource('');
      }); }}>
        <label className="text-xs">Dataset name<input required maxLength={200} className={field} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="text-xs">Provenance (source and relevance)<input required maxLength={2000} className={field} value={source} onChange={e => setSource(e.target.value)} placeholder="Paper DOI, supplement, or synthetic test data" /></label>
        <label className="text-xs sm:col-span-2">CSV file<input type="file" accept=".csv,text/csv" className="mt-1 block" onChange={e => {
          const file = e.target.files?.[0]; if (!file) return;
          if (file.size > 1048576) { setError('CSV must be at most 1 MiB.'); return; }
          void file.text().then(text => { if (mounted.current) { setCSV(text); setName(file.name); } }).catch(e => setError(String(e)));
        }} /></label>
        <label className="text-xs sm:col-span-2">CSV contents<textarea aria-label="CSV contents" required className={`${field} h-28 font-mono`} value={csv} onChange={e => setCSV(e.target.value)} placeholder={'group,value\ncontrol,2\ncontrol,3\ntreatment,4\ntreatment,5'} /></label>
        <p className="text-xs text-[var(--forensic-text-muted)]">Up to 2,000 rows, 32 columns, 1 MiB. Originals stay unchanged.</p>
        <button className={primaryButton} disabled={busy || !csv || !name || !source}>Save dataset snapshot</button>
      </form>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void act(async () => {
        const added = await request<Dataset>('/datasets/import-url', {name: name || 'Imported CSV', url}); setDatasetId(added.id); setURL('');
      }); }}>
        <label className="min-w-0 flex-1 text-xs">Public CSV URL<input type="url" required className={field} value={url} onChange={e => setURL(e.target.value)} placeholder="https://example.org/data.csv" /></label>
        <button className={button} disabled={busy || !url}>Import from URL</button>
      </form>
    </details>

    <details className={card}><summary className="cursor-pointer text-sm">Advanced: work with data manually</summary><ResearchDataWorkbench candidateId={candidate?.id} datasetId={dataset?.id} datasets={datasets} onDataset={id => {setDatasetId(id); void reload();}} /></details>
    <h3 className="text-sm font-bold">Verification history</h3>
    {loading ? <p className="text-sm">Loading verification history…</p> : !runs.length && <p className="rounded-xl border border-dashed border-[var(--forensic-border-soft)] px-5 py-8 text-center text-sm text-[var(--forensic-text-muted)]">No verification runs yet. Choose a candidate and dataset to begin.</p>}
    {runs.map(run => {
      const active = run.status === 'running' || run.status === 'queued';
      // Prefer polled results when a previously opened run has since advanced.
      const detail = details[run.id]?.status === run.status ? details[run.id] : undefined;
      return <article key={run.id} className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">{run.candidate.hypothesis}</h4><span className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${statusTone(run.status)}`}>{run.status}</span></div>
        <p className="mt-1 text-xs text-[var(--forensic-text-muted)]">{run.dataset.name} · {new Date(run.createdAt).toLocaleString()}</p>
        {run.error && <p className="mt-2 text-xs text-[#ffb0ab]">{run.error}</p>}
        {run.datasetActions?.map((action, index) => <p key={`dataset-${index}`} className="mt-2 text-xs text-[var(--forensic-text-muted)]">{action.call.tool}: {action.error || action.summary}</p>)}
        {run.results.map((result, index) => <div key={index} className="mt-3 border-t border-[var(--forensic-border-soft)] pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--forensic-accent)]">{result.call.tool} · {result.status}</p><p className="mt-1 text-xs leading-relaxed text-[var(--forensic-text-muted)]">{result.summary}</p>
          <p className="mt-1 text-xs text-[var(--forensic-text-muted)]">Hypothesis verdict: {result.verdict}</p>
        </div>)}
        {run.interpretation && <div className="mt-3 rounded-lg border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-panel)] px-3 py-2"><p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--forensic-accent)]">What the agent found</p><p className="mt-1 text-sm whitespace-pre-line leading-relaxed text-[var(--forensic-text-muted)]">{run.interpretation}</p></div>}
        {run.replayMatches !== undefined && <p className="mt-2 text-sm">{run.replayMatches ? 'Replay matches saved output digests.' : 'Replay differs from saved outputs — review required.'}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {active ? <button className={button} disabled={busy} onClick={() => void act(() => request(`/runs/${run.id}/cancel`, {}))}>Cancel run</button>
            : <button className={button} disabled={busy || !run.results.length} onClick={() => void act(() => request('/verify', { mode: 'replay', replayOf: run.id }))}>Replay without a model</button>}
          <a className={button} href={`${API}/runs/${run.id}/bundle`} download>Download evidence bundle</a>
        </div>
        <details className="mt-3 text-xs" onToggle={e => { if (e.currentTarget.open) void loadDetail(run.id); }}>
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-[var(--forensic-accent)] hover:underline">Inputs, assumptions, figures &amp; reproduction details</summary>
          <p className="mt-2 break-all">Tool: {run.toolVersion} · Runtime: {run.runtime}<br />Implementation SHA-256: {run.implementationDigest}<br />Input SHA-256: {run.dataset.digest}</p>
          {(detail?.results ?? run.results).map((result, index) => <div key={index} className="mt-3">
            <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-panel)] p-3 text-[11px] text-[var(--forensic-text-muted)]">{JSON.stringify(result.call, null, 2)}</pre>
            <ul className="my-2 list-disc pl-4">{result.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
            {result.metrics && <dl className="my-2">{Object.entries(result.metrics).map(([key, value]) => <div key={key}><dt className="inline font-semibold">{key}: </dt><dd className="inline">{value.toPrecision(6)}{result.intervals?.[key] && ` (95% interval ${result.intervals[key].map(v => v.toPrecision(6)).join(' to ')})`}</dd></div>)}</dl>}
            <p className="break-all">Output SHA-256: {result.outputDigest}</p>
            {result.svg && <><img className="mt-3 w-full" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`} alt={`Group means from ${run.dataset.name}`} /><a className="mt-2 inline-block underline" href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`} download={`verification-${run.id}-${index}.svg`}>Download data figure</a></>}
          </div>)}
          {active && <button className={`${button} mt-2`} onClick={() => void loadDetail(run.id)}>Refresh details</button>}
        </details>
      </article>;
    })}
  </section>;
}
