import { useEffect, useRef, useState } from 'react';

interface Dataset { id: string; name: string }
interface ToolResult {
  summary: string; error?: string; links?: string[]; warnings?: string[]; counts?: Record<string, number>; extractionId?: string; engine?: string;
  passages?: { source: string; page?: number; offset: number; text: string; digest: string }[];
  tables?: { index: number; page: number; rows: string[][]; warnings?: string[] }[];
}
interface Props { candidateId?: string; datasetId?: string; datasets: Dataset[]; onDataset: (id: string) => void }
const API = 'http://127.0.0.1:8080/api/research';
const field = 'mt-1 w-full rounded-lg border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-panel)] p-2 text-xs text-[var(--forensic-text)]';
const button = 'justify-self-start self-end rounded-lg border border-[var(--forensic-accent)] bg-[var(--forensic-glow)] px-3 py-2 text-xs font-semibold text-[var(--forensic-accent)] disabled:opacity-40';

export default function ResearchDataWorkbench({candidateId, datasetId, datasets, onDataset}: Props) {
  const pending = useRef<AbortController | null>(null);
  const [tool, setTool] = useState('dataset-validate');
  const [sessionId, setSessionId] = useState('');
  const [result, setResult] = useState<ToolResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [column, setColumn] = useState('');
  const [rightKey, setRightKey] = useState('');
  const [rightId, setRightId] = useState('');
  const [operator, setOperator] = useState('inner');
  const [query, setQuery] = useState('');
  const [url, setURL] = useState('');
  const [page, setPage] = useState(1);
  const [endPage, setEndPage] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [headerRows, setHeaderRows] = useState(1);
  const [columnCuts, setColumnCuts] = useState('');
  const [region, setRegion] = useState('');
  const [joinWrappedRows, setJoinWrappedRows] = useState(false);
  const isLayoutTool = tool === 'paper-scan' || tool === 'paper-complex-table';
  const isPDFTool = isLayoutTool || tool === 'paper-extract';
  const [rationale, setRationale] = useState('');
  const [units, setUnits] = useState('');
  const [rightUnits, setRightUnits] = useState('');
  useEffect(() => { setSessionId(''); setResult(undefined); setBusy(false); return () => { pending.current?.abort(); }; }, [candidateId]);
  const execute = async (call: Record<string, unknown>) => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/datasets/tools`, {signal: controller.signal, method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({candidateId, datasetId, sessionId, call})});
      if (!response.ok) throw new Error(await response.text());
      const body = await response.json(); if (controller.signal.aborted) return; setSessionId(body.sessionId); setResult(body.result);
      if (body.dataset?.id && body.dataset.id !== datasetId) onDataset(body.dataset.id);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const submit = () => {
    try {
      const parseUnits = (text: string) => {
        const result: Record<string, string> = {};
        for (const line of text.split('\n').filter(v => v.trim())) {
          const at = line.indexOf('='); const key = line.slice(0, at).trim(); const unit = line.slice(at + 1).trim();
          if (at < 1 || !key || !unit || Object.hasOwn(result, key)) throw new Error('Invalid units');
          result[key] = unit;
        }
        return result;
      };
      const declaredUnits = parseUnits(units); const declaredRightUnits = parseUnits(rightUnits);
      if (tool === 'dataset-validate') void execute({tool, idColumn: column, units: declaredUnits});
      else if (tool === 'dataset-join') void execute({tool, column, rightKey, datasetId: rightId, operator, rationale, units: declaredUnits, rightUnits: declaredRightUnits});
      else if (tool === 'evidence-lookup') void execute({tool, query});
      else if (isLayoutTool) {
        const numbers = (text: string) => text.trim() ? text.split(',').map(v => {const n = Number(v.trim()); if (!v.trim() || !Number.isFinite(n)) throw new Error('Invalid layout number'); return n;}) : [];
        void execute({tool, url, page, endPage: Math.max(page,endPage), rotation, headerRows, columnCuts:numbers(columnCuts), region:numbers(region), joinWrappedRows});
      } else void execute({tool, url, page});
    } catch { setError('Check your inputs: use column=unit for units and comma-separated numbers for page percentages.'); }
  };
  return <details className="rounded-xl border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-card)] p-4">
    <summary className="cursor-pointer text-sm font-semibold">Research data tools</summary>
    <p className="mt-2 text-xs text-[var(--forensic-text-muted)]">Review source evidence and prepare data before verification. The agent can also use these tools automatically.</p>
    <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={e => {e.preventDefault(); submit();}}>
      <label className="text-xs">Data tool<select aria-label="Data tool" className={field} value={tool} onChange={e => {setTool(e.target.value); setResult(undefined);}}>
        <option value="dataset-validate">Validate dataset</option><option value="dataset-join">Join datasets</option><option value="evidence-lookup">Find source passages</option><option value="dataset-discover">Discover supplementary links</option><option value="paper-extract">Extract PDF page and tables</option><option value="paper-scan">Scan PDF with local OCR</option><option value="paper-complex-table">Read complex PDF table</option>
      </select></label>
      {(tool === 'dataset-validate' || tool === 'dataset-join') && <>
        <label className="text-xs">{tool === 'dataset-join' ? 'Left join key' : 'Observation ID column (optional)'}<input className={field} required={tool === 'dataset-join'} value={column} onChange={e => setColumn(e.target.value)} /></label>
        <label className="text-xs">Column units (optional, one column=unit per line)<textarea className={field} value={units} onChange={e => setUnits(e.target.value)} /></label>
      </>}
      {tool === 'dataset-join' && <>
        <label className="text-xs">Right dataset<select aria-label="Right dataset" required className={field} value={rightId} onChange={e => setRightId(e.target.value)}><option value="">Choose dataset</option>{datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="text-xs">Right join key<input required className={field} value={rightKey} onChange={e => setRightKey(e.target.value)} /></label>
        <label className="text-xs">Join type<select aria-label="Join type" className={field} value={operator} onChange={e => setOperator(e.target.value)}><option value="inner">Inner: keep matching rows</option><option value="left">Left: retain every left row</option></select></label>
        <label className="text-xs">Right column units (optional, one column=unit per line)<textarea className={field} value={rightUnits} onChange={e => setRightUnits(e.target.value)} /></label>
      </>}
      {tool === 'evidence-lookup' && <label className="text-xs">Exact source phrase<input required maxLength={200} className={field} value={query} onChange={e => setQuery(e.target.value)} /></label>}
      {(isPDFTool || tool === 'dataset-discover') && <label className="text-xs">Paper or observed supplement URL<input type="text" required className={field} value={url} onChange={e => setURL(e.target.value)} /></label>}
      {isPDFTool && <label className="text-xs">PDF page<input type="number" min={1} required className={field} value={page} onChange={e => setPage(Number(e.target.value))} /></label>}
      {(isPDFTool || tool === 'dataset-join') && <label className="text-xs">Preparation rationale<input required maxLength={2000} className={field} value={rationale} onChange={e => setRationale(e.target.value)} /></label>}
      {isPDFTool && <label className="text-xs sm:col-span-2">Or upload a PDF (up to 10 MiB)<input type="file" accept=".pdf,application/pdf" disabled={busy} className="mt-1 block" onChange={e => {
        const file=e.target.files?.[0];if(!file)return;if(file.size>10*1048576){setError('PDF must be at most 10 MiB.');return;}
        setBusy(true);setError('');const reader=new FileReader();reader.onerror=()=>{setError('Could not read PDF.');setBusy(false);};reader.onload=()=>{
          const data=String(reader.result).split(',')[1];void fetch(`${API}/datasets/pdf-files`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,data})}).then(async response=>{if(!response.ok)throw new Error(await response.text());const body=await response.json();setURL(body.url);}).catch(e=>setError(String(e))).finally(()=>setBusy(false));
        };reader.readAsDataURL(file);
      }} /></label>}
      {isLayoutTool && <>
        <label className="text-xs">Last PDF page (maximum 3 pages)<input type="number" min={page} max={page+2} className={field} value={Math.max(page,endPage)} onChange={e=>setEndPage(Number(e.target.value))} /></label>
        <label className="text-xs">Clockwise rotation<select aria-label="Clockwise rotation" className={field} value={rotation} onChange={e=>setRotation(Number(e.target.value))}>{[0,90,180,270].map(r=><option key={r} value={r}>{r} degrees</option>)}</select></label>
        <label className="text-xs">Table region: left, top, width, height (%)<input className={field} value={region} onChange={e=>setRegion(e.target.value)} placeholder="0, 20, 100, 60 (blank for whole page)" /></label>
      </>}
      {tool==='paper-complex-table' && <>
        <label className="text-xs">Header rows<input type="number" min={1} max={4} className={field} value={headerRows} onChange={e=>setHeaderRows(Number(e.target.value))} /></label>
        <label className="text-xs">Column boundaries (% from left)<input className={field} value={columnCuts} onChange={e=>setColumnCuts(e.target.value)} placeholder="30, 60 (blank to detect)" /></label>
        <label className="text-xs"><input type="checkbox" checked={joinWrappedRows} onChange={e=>setJoinWrappedRows(e.target.checked)} /> Join wrapped first-column labels</label>
      </>}
      <button className={button} disabled={busy || !candidateId || ((tool === 'dataset-validate' || tool === 'dataset-join') && !datasetId)}>Run data tool</button>
    </form>
    {error && <p role="alert" className="mt-2 text-xs text-[#ffb0ab]">{error}</p>}
    {result && <div className="mt-3 space-y-2 text-xs">
      <p role={result.error ? 'alert' : undefined}>{result.error || result.summary}</p>
      {result.warnings?.map((w, i) => <p key={i} className="text-[#f6c879]">{w}</p>)}
      {result.links?.map(link => <p key={link} className="break-all">{link}</p>)}
      {result.counts && <p>{Object.entries(result.counts).map(([k,v]) => `${k.replace(/([a-z])([A-Z])/g, '$1 $2')}: ${v}`).join(' · ')}</p>}
      {result.passages?.map((p,i) => <blockquote key={i} className="border-l-2 border-[var(--forensic-accent)] pl-3"><p>{p.source} {p.page ? `· page ${p.page}` : `· byte ${p.offset}`}</p><pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap">{p.text}</pre></blockquote>)}
      {result.engine && <p>Reader: {result.engine}</p>}
      {result.tables?.map(t => <div key={t.index} className="overflow-auto"><p>Candidate table {t.index} · page {t.page} · verify cell boundaries before use</p>{t.warnings?.map((w,i)=><p key={i} className="text-[#f6c879]">{w}</p>)}<table className="my-2 text-left"><tbody>{t.rows.map((r,i) => <tr key={i}>{r.map((c,j) => <td key={j} className="border border-[var(--forensic-border-soft)] p-2">{c}</td>)}</tr>)}</tbody></table><button className={button} disabled={busy || !rationale.trim()} onClick={() => void execute({tool:'paper-table',url,page:t.page,tableIndex:t.index,rationale,...(result.extractionId ? {extractionId:result.extractionId} : {})})}>Save extracted table {t.index}</button></div>)}
      {sessionId && <a className="inline-block text-[var(--forensic-accent)] underline" href={`${API}/datasets/preparations/${sessionId}`} download>Download preparation evidence</a>}
    </div>}
  </details>;
}
