import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import ResearchReportOverview, { type ReportEvidence, type ReportFigure } from './ResearchReportOverview';

const API = 'http://127.0.0.1:8080/api/research';
interface Run { id: string; status: string; candidate: { hypothesis: string }; results: unknown[] }
type Figure = ReportFigure;
interface Draft {
  id: string; revision: string; status: string; stale: boolean; markdown: string; reviewIssues?: string[];
  run?: ReportEvidence; papers?: unknown[]; claims?: unknown[]; relations?: {id:string; relationKind:string; sourceClaimID?:string; targetClaimID?:string}[]; evidenceStatus: string; figures: Figure[]; exportPath?: string;
  candidate: { id?: string; hypothesis: string };
  audit: { action: string; operator: string; reason: string; at: string; revision: string }[];
}
const field = 'w-full rounded-lg border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-panel)] p-2 text-sm text-[var(--forensic-text)]';
const button = 'rounded-lg border border-[var(--forensic-border-soft)] px-3 py-2 text-xs text-[var(--forensic-accent)] disabled:opacity-40';
const card = 'rounded-xl border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-card)] p-4';
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(API + path, body === undefined ? { signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ResearchPublicationConsole({ publicationId, onRebuild }: { publicationId?: string; onRebuild?: (candidateId: string) => void } = {}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<Draft>();
  const [runId, setRunId] = useState('');
  const [operator, setOperator] = useState('');
  const [reason, setReason] = useState('Reviewed the report for sharing, with its uncertainties retained.');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [privateNotice, setPrivateNotice] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const reviewInput = useRef<HTMLInputElement>(null);
  const notesInput = useRef<HTMLInputElement>(null);
  const notesDetails = useRef<HTMLDetailsElement>(null);
  const reportIssues = useRef<HTMLDivElement>(null);
  const figuresDetails = useRef<HTMLDetailsElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    if (publicationId) {
      request<Draft>(`/publications/${publicationId}`, undefined, controller.signal)
        .then(d => { if (!controller.signal.aborted) { setSelected(d); setReviewed(false); setAttempted(false); setPrivateNotice(false); } })
        .catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    } else Promise.all([request<Run[]>('/runs', undefined, controller.signal), request<Draft[]>('/publications', undefined, controller.signal)])
      .then(([r, d]) => { if (!controller.signal.aborted) { setRuns(r.filter(x => !['queued', 'running'].includes(x.status) && x.results.length > 0)); setDrafts(d); } })
      .catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    return () => { mounted.current = false; controller.abort(); };
  }, [publicationId]);
  const act = async (fn: () => Promise<Draft>) => {
    setBusy(true); setError('');
    try {
      const d = await fn();
      if (!mounted.current) return;
      setSelected(d); setReviewed(false); setAttempted(false); setPrivateNotice(false);
      if (!publicationId) setDrafts(await request<Draft[]>('/publications'));
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const mutate = (action: string, extra: object = {}) => selected && act(() => request<Draft>(`/publications/${selected.id}/${action}`, { revision: selected.revision, operator, reason, ...extra }));
  const canDecide = !!operator.trim() && !!reason.trim() && !busy;
  // Every disabled action gets a visible, accessible explanation of its prerequisites.
  const commonReason = busy ? 'An action is in progress.' : !operator.trim() ? 'Enter your name for the sharing record.' : !reason.trim() ? 'Add a note under More sharing options.' : '';
  const missingFigures = selected?.figures.filter(f => !f.imageDigest).length ?? 0;
  const approvalReason = !selected ? '' : selected.status !== 'draft' ? `This paper is ${selected.status}. Only a draft can be approved.` : selected.reviewIssues?.[0] || (selected.stale ? 'Evidence changed. Prepare and review a new paper.' : missingFigures ? `Attach ${missingFigures} missing figure image${missingFigures === 1 ? '' : 's'} in the figure section before approval.` : commonReason || (!reviewed ? 'Read the paper and tick the review checkbox.' : ''));
  const exportReason = !selected ? '' : selected.status !== 'approved' ? selected.status === 'exported' ? 'Already exported. The folder is shown below.' : 'Approve this revision before exporting.' : selected.reviewIssues?.[0] || (selected.stale ? 'Evidence changed. Prepare and review a new paper.' : commonReason);
  const rejectReason = selected && !['draft', 'approved'].includes(selected.status) ? 'Only a draft or approved paper can be rejected.' : commonReason;
  const withdrawalReason = selected?.status !== 'exported' ? 'Available after this paper has been exported.' : commonReason;
  // Keep Approve clickable: point to missing requirements instead of making
  // the user infer why a disabled control cannot respond.
  const approve = () => {
    setAttempted(true);
    if (!approvalReason) { void mutate('approve'); return; }
    setError('');
    if (!operator.trim()) { nameInput.current?.scrollIntoView?.({block:'center', behavior:'smooth'}); nameInput.current?.focus(); }
    else if (!reviewed) { reviewInput.current?.scrollIntoView?.({block:'center', behavior:'smooth'}); reviewInput.current?.focus(); }
    else if (!reason.trim()) { if (notesDetails.current) notesDetails.current.open = true; notesInput.current?.focus(); }
    else if (selected?.stale || selected?.reviewIssues?.length) reportIssues.current?.scrollIntoView?.({block:'center', behavior:'smooth'});
    else if (missingFigures && figuresDetails.current) { figuresDetails.current.open = true; figuresDetails.current.scrollIntoView?.({block:'center', behavior:'smooth'}); }
  };
  const upload = async (figure: Figure, file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('PNG must be at most 10 MiB.'); return; }
    await act(async () => {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Cannot read PNG')); reader.readAsDataURL(file);
      });
      return request<Draft>(`/publications/${selected!.id}/figure`, { revision: selected!.revision, operator, reason, figureId: figure.id, data });
    });
  };
  return <section aria-label="Publication console" className="research-publication">
    {!publicationId && <div><h2 className="text-xl font-semibold">Review and publish</h2><p className="research-muted">Your reports, evidence and sharing decisions.</p></div>}
    {error && <p role="alert" className="text-sm text-[#ff8c86]">{error}</p>}
    {!publicationId && <><div className={card}>
      <label className="text-xs">Finished verification<select aria-label="Finished verification" className={field} value={runId} onChange={e => setRunId(e.target.value)}><option value="">Choose a run</option>{runs.map(r => <option key={r.id} value={r.id}>{r.candidate.hypothesis} — {r.status}</option>)}</select></label>
      <button className={`${button} mt-3`} disabled={busy || !runId} onClick={() => void act(() => request<Draft>('/publications', { runId }))}>Prepare candidate paper</button>
      {!runs.length && <p className="mt-2 text-xs text-[var(--forensic-text-muted)]">Complete a verification first. Failed and inconclusive results can also be reported.</p>}
    </div>
    <div className="flex flex-wrap gap-2" aria-label="Paper drafts">{drafts.map(d => <button className={button} key={d.id} disabled={busy} onClick={() => void act(() => request<Draft>(`/publications/${d.id}`))}>{d.candidate.hypothesis.slice(0, 65)} · {d.status}{d.stale ? ' · evidence changed' : ''}</button>)}</div></>}
    {selected && <>
      <div ref={reportIssues} className={`research-report-state ${attempted && (selected.stale || selected.reviewIssues?.length) ? 'ring-2 ring-[#f6c879]' : ''}`}>
        <p className="text-xs">Publication: <strong>{selected.status}</strong> · Evidence: <strong>{selected.evidenceStatus}</strong></p>
        {selected.reviewIssues?.map(issue => <p key={issue} role="alert" className="mt-2 text-sm text-[#f6c879]">{issue}</p>)}
        {selected.stale && <p role="status" className="mt-2 text-sm text-[#f6c879]">Evidence changed. Prepare a new paper and review it before publishing again.</p>}
        {(selected.stale || !!selected.reviewIssues?.length || missingFigures > 0) && onRebuild && selected.candidate.id && <button className={`${button} mt-3`} disabled={busy} onClick={() => onRebuild(selected.candidate.id!)}>Let the agent rebuild this report</button>}
        
      </div>
      <a className="research-pdf-link" href={`${API}/publications/${selected.id}/pdf`} target="_blank" rel="noreferrer">Open organised PDF</a>
      <ResearchReportOverview run={selected.run} figures={selected.figures} paperCount={selected.papers?.length ?? 0} claimCount={selected.claims?.length ?? 0} relations={selected.relations ?? []} stale={selected.stale} manualFigures={selected.audit.some(a => a.action === 'figure')} />
      <details className="research-full-report"><summary className="cursor-pointer text-sm">Read full report and sources</summary>
      <article aria-label="Candidate paper" className={`${card} publication-paper`}>
        <ReactMarkdown skipHtml components={{
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ children }) => <h2>{children}</h2>,
          // Only resolved local figure slots render; source text cannot load remote images.
          img: ({ src, alt }) => { const f = selected.figures.find(x => src === `figures/${x.id}.png`); return f?.png ? <img src={`data:image/png;base64,${f.png}`} alt={alt} className="max-h-96 max-w-full" /> : <span className="text-[#f6c879]">Image not attached: {alt}</span>; },
        }}>{selected.markdown}</ReactMarkdown>
      </article></details>
      <details ref={figuresDetails} className={`research-surface research-advanced ${attempted && missingFigures ? 'ring-2 ring-[#f6c879]' : ''}`}><summary className="cursor-pointer text-sm">Advanced: figures and attachments</summary><div><h3 className="text-sm font-semibold">Publication figures</h3><p className="mt-2 text-sm text-[var(--forensic-text-muted)]">New reports include charts drawn locally from the recorded values. You can replace an image if you want a different presentation; the original data stays available in the figure specification.</p>{!selected.figures.length && <p className="mt-2 text-sm">This run has no completed numeric results requiring a figure.</p>}</div>
      {selected.figures.map(f => <div className={card} key={f.id}>
        <h3 className="text-sm font-semibold">{f.id}: {f.title}</h3><p className="mt-1 text-xs">{f.caption}</p>
        <button className={`${button} mt-2`} onClick={() => { const { png: _png, ...spec } = f; void _png; download(`${f.id}.json`, JSON.stringify(spec, null, 2)); }}>Download figure spec</button>
        <label className="ml-3 text-xs">Attach generated PNG<input aria-label={`Attach ${f.id}`} type="file" accept="image/png" className="mt-2 block text-xs" disabled={!canDecide || selected.status !== 'draft'} onChange={e => void upload(f, e.target.files?.[0])} /></label>
        <p className="mt-2 text-xs text-[var(--forensic-text-muted)]">{f.imageDigest ? 'Attached — review the image against the recorded data.' : 'Image not attached — download the specification, create a PNG with your preferred plotting tool, then attach it here. A specification is data and instructions, not an image.'}</p>
        {(!canDecide || selected.status !== 'draft') && <p className="mt-2 text-xs text-[#f6c879]">{selected.status !== 'draft' ? 'Attachments can only change on a draft. Prepare a new paper to change figures.' : commonReason}</p>}
      </div>)}</details>
      <div className="research-decision">
        <div className="research-decision-heading"><h3>Your decision</h3><p>{selected.status === 'draft' ? 'Approve sharing this report with its limitations included.' : selected.status === 'withdrawn' ? 'Sharing approval was withdrawn. Start a new research run to prepare another revision.' : selected.status === 'rejected' ? 'This revision was rejected. Start a new research run to prepare another revision.' : selected.status === 'exported' ? 'This report has been saved locally. Its sharing history is available below.' : 'Sharing approved. You can now save the report and evidence locally.'}</p><small>Nothing is posted online by this action.</small></div>
        <label className="research-name">Reviewer name<input ref={nameInput} aria-invalid={attempted && !operator.trim()} className={`${field} ${attempted && !operator.trim() ? 'ring-2 ring-[#f6c879]' : ''}`} placeholder="Your name for the sharing record" value={operator} onChange={e => setOperator(e.target.value)} maxLength={100} /></label>
        <label className={`research-consent flex items-start gap-2 rounded-lg p-2 text-sm leading-relaxed ${attempted && !reviewed ? 'ring-2 ring-[#f6c879]' : ''}`}><input ref={reviewInput} aria-invalid={attempted && !reviewed} type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I want to share this report with its stated uncertainties. This is not a claim that the research is proven.</label>
        {attempted && approvalReason && <div role="alert" className="research-validation mt-3 rounded-lg border border-[#f6c879] p-3 text-sm"><p>Finish the highlighted items:</p><ul className="mt-2 list-disc pl-5">{!operator.trim() && <li>Enter your name.</li>}{!reviewed && <li>Tick the sharing checkbox.</li>}{!reason.trim() && <li>Add a sharing note in More sharing options.</li>}{(selected.stale || !!selected.reviewIssues?.length) && <li>This older report needs rebuilding. Use “Let the agent rebuild this report” above.</li>}{missingFigures > 0 && <li>This older report is missing a chart. Rebuilding will generate it automatically.</li>}</ul></div>}
        <div className="research-decision-actions">
          {selected.status === 'draft' && <><button className={button} aria-describedby="publication-approve-reason" disabled={busy} onClick={approve}>Approve for sharing</button><p id="publication-approve-reason" className="mt-2 text-xs text-[var(--forensic-text-muted)]">{approvalReason || 'Ready for your sharing decision.'}</p></>}
          {selected.status === 'approved' && <><button className={button} aria-describedby="publication-export-reason" disabled={!!exportReason} onClick={() => void mutate('export')}>Export to local repo folder</button><p id="publication-export-reason" className="mt-2 text-xs text-[var(--forensic-text-muted)]">{exportReason || 'Save the approved report and its evidence together.'}</p></>}
          {['withdrawn', 'rejected'].includes(selected.status) && <p role="status" className="research-muted">This revision is closed for sharing.</p>}
          {selected.status === 'exported' && <p className="text-sm">Your report has been saved locally.</p>}
          {selected.status === 'draft' && <button className="research-text-button" onClick={() => { setReviewed(false); setAttempted(false); setPrivateNotice(true); }}>Keep private</button>}
          {privateNotice && <p role="status" className="research-muted">Kept private. No sharing approval recorded.</p>}
        </div>
        <details ref={notesDetails} className="research-sharing-options"><summary className="cursor-pointer text-xs">More sharing options</summary>
          <label className="mt-3 block text-xs">Review notes<input ref={notesInput} aria-invalid={attempted && !reason.trim()} className={field} value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} /></label>
          <div className="mt-3 flex flex-wrap gap-3">
            <div><button className={button} aria-describedby="publication-reject-reason" disabled={!!rejectReason} onClick={() => void mutate('reject')}>Reject publication</button><p id="publication-reject-reason" className="mt-2 text-xs">{rejectReason}</p></div>
            <div><button className={button} aria-describedby="publication-withdraw-reason" disabled={!!withdrawalReason} onClick={() => void mutate('withdraw')}>Record withdrawal</button><p id="publication-withdraw-reason" className="mt-2 text-xs">{withdrawalReason}</p></div>
          </div>
        </details>
        <p className="research-export-note">Saving creates a local folder containing report.pdf, the report text and its evidence. Nothing is posted online.</p>
        {selected.exportPath && <p role="status" className="research-export-note break-all">Export folder: {selected.exportPath}</p>}
      </div>
      <details className="research-surface research-advanced"><summary className="text-xs">Approval audit and revision</summary><button className={`${button} mt-2`} onClick={() => download("verification-evidence.json", JSON.stringify(selected.run, null, 2))}>Download evidence for review</button><code className="mt-2 block break-all text-xs">{selected.revision}</code>{selected.audit.map((a, i) => <p key={i} className="mt-2 text-xs">{a.at} · {a.operator} · {a.action}: {a.reason}</p>)}</details>
    </>}
  </section>;
}
