import { AlertCircle, CheckCircle2, FileText, GitBranch, Scale, Table2 } from 'lucide-react';

export interface ReportFigure {
  id: string; title: string; caption: string; alt: string; imageDigest?: string; png?: string;
  data?: {name: string; count: number; mean: number}[];
}
export interface ReportEvidence {
  interpretation?: string;
  results?: {status: string; summary: string; outputDigest?: string}[];
  datasetActions?: {call: {tool: string}; error?: string; passages?: unknown[]}[];
  studyReviews?: {supported: boolean; reason: string}[];
}

// Separate the model's narrative from actual recorded checks. A completed
// calculation or an attached paper never becomes a scientific-review pass.
export default function ResearchReportOverview({run, figures, paperCount, claimCount, relations, stale, manualFigures}: {
  run?: ReportEvidence; figures: ReportFigure[]; paperCount: number; claimCount: number;
  relations: {id: string; relationKind: string; sourceClaimID?: string; targetClaimID?: string}[];
  stale: boolean; manualFigures: boolean;
}) {
  const parts = run?.interpretation?.split(/\n\s*\n/).filter(Boolean) ?? [];
  const intro = parts[0]?.replace(/^What we found\s*:?\s*/i, '') || run?.results?.[0]?.summary || 'Open the full report to read the recorded findings.';
  const checks = run?.results?.filter(r => r.status === 'completed').length ?? 0;
  const sourceChecks = run?.datasetActions?.filter(a => a.call.tool === 'evidence-lookup' && !a.error && !!a.passages?.length).length ?? 0;
  const reviews = run?.studyReviews ?? [];
  const reviewLabel = stale ? 'Needs a fresh review' : reviews.some(r => !r.supported) ? 'Review raised concerns' : 'Broader claim unresolved';
  return <>
    <div className="research-summary-strip">
      <span><FileText size={18} />{paperCount} source{paperCount === 1 ? '' : 's'} attached</span>
      <span><Table2 size={18} />{checks} completed check{checks === 1 ? '' : 's'}</span>
      <span><AlertCircle size={18} />Evidence remains inconclusive</span>
    </div>
    <div className="research-result-grid">
      <section className="research-surface research-finding" aria-label="Research finding">
        <p className="research-eyebrow">What we found</p>
        <p className="research-finding-summary">{intro}</p>
        <p className="research-muted">These results describe the recorded evidence. A broader scientific claim still needs independent support.</p>
        {figures.map(f => <figure key={f.id} className="research-chart">
          {!manualFigures && !!f.data?.length && f.data.every(g => Number.isFinite(g.mean)) ? <>
            <figcaption>{f.title}</figcaption>
            <div role="img" aria-label={f.alt} className="research-bars">
              {(() => {
                const low = Math.min(0, ...f.data.map(g => g.mean));
                const high = Math.max(0, ...f.data.map(g => g.mean));
                const range = high - low || 1;
                const zero = -low / range * 100;
                return f.data.map(g => <div className="research-bar-row" key={g.name}>
                  <span className="research-bar-label">{g.name}<small>n = {g.count}</small></span>
                  <div className="research-bar-track"><i className="research-zero" style={{left:`${zero}%`}} /><span className="research-bar" style={{left:`${Math.min(zero, (g.mean-low)/range*100)}%`, width:`${Math.abs(g.mean)/range*100}%`}} /></div>
                  <strong>{g.mean.toLocaleString(undefined, {maximumFractionDigits:2})}</strong>
                </div>);
              })()}
            </div>
            <p className="research-chart-note">Recorded group means · bars start at zero · no uncertainty bars inferred</p>
          </> : f.png ? <><img src={`data:image/png;base64,${f.png}`} alt={f.alt} /><figcaption>{f.caption}</figcaption></> : <p className="research-muted">This older report needs its chart rebuilt.</p>}
        </figure>)}
        {parts.length > 1 && <details className="research-explanation"><summary>Read the agent’s explanation and limitations</summary><p className="research-narrative">{run?.interpretation}</p></details>}
      </section>
      <section className="research-surface research-review" aria-label="Reviewer verdict">
        <p className="research-eyebrow">Reviewer verdict</p>
        <div className="research-verdict"><AlertCircle size={19} />{reviewLabel}</div>
        <p className="research-muted">{reviews.length ? `${reviews.length} recorded study-design review${reviews.length === 1 ? '' : 's'}. These checks do not certify a discovery.` : 'No formal study-design review is recorded for this run. Descriptive calculations can still be reported.'}</p>
        <div className="research-review-rows">
          <div><FileText size={20} /><span>Source context<small>{sourceChecks ? `${sourceChecks} source lookup${sourceChecks === 1 ? '' : 's'} recorded` : 'Not checked in this run'}</small></span>{sourceChecks ? <CheckCircle2 size={18} /> : <AlertCircle size={18} className="research-amber" />}</div>
          <div><Table2 size={20} /><span>Recorded calculations<small>{checks ? `${checks} completed · replay checked during preparation` : 'No completed calculations'}</small></span>{checks ? <CheckCircle2 size={18} /> : <AlertCircle size={18} className="research-amber" />}</div>
          <div><Scale size={20} /><span>Broader claim<small>Unresolved</small></span><AlertCircle size={18} className="research-amber" /></div>
        </div>
        {!!reviews.length && <details className="research-explanation"><summary>Read reviewer comments</summary>{reviews.map((r,i) => <p key={i}>{r.reason}</p>)}</details>}
      </section>
    </div>
    <details className="research-evidence-link"><summary><GitBranch size={20} />See how the brain connected the evidence <span>›</span></summary>
      <div className="research-evidence-content"><p>{claimCount} extracted claim{claimCount === 1 ? '' : 's'} and {relations.length} connection{relations.length === 1 ? '' : 's'} attached to this report.</p>
        {relations.length ? relations.map(r => <p key={r.id}><code>{r.sourceClaimID}</code> → <strong>{r.relationKind}</strong> → <code>{r.targetClaimID}</code></p>) : <p>No claim connections were recorded for this report. The chart alone is not a brain-generated discovery.</p>}
      </div>
    </details>
  </>;
}
