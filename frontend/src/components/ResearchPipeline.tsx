import { useEffect, useState } from 'react';
import { Check, FileText, GitBranch, Microscope, Plus, Sparkles } from 'lucide-react';
import ResearchPublicationConsole from './ResearchPublicationConsole';

const API = 'http://127.0.0.1:8080/api/research';
interface Candidate { id: string; hypothesis: string; paperIDs?: string[]; claimIDs?: string[] }
interface Run {
  id: string; status: string; pipelineStage?: string; publicationId?: string;
  reportError?: string; error?: string; interpretation?: string; createdAt: string;
  candidate: Candidate; dataset?: { id?: string }; results: unknown[];
  request?: { autoPrepare?: boolean };
}
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(API + path, body === undefined ? { signal } : {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body), signal});
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

export default function ResearchPipeline({ candidates, initialRunId, onNavigate }: { candidates: Candidate[]; initialRunId?: string; onNavigate?: (view: 'corpus' | 'relations' | 'verification') => void }) {
  const [choosing, setChoosing] = useState(false);
  const [candidateId, setCandidateId] = useState('');
  const [runId, setRunId] = useState(initialRunId ?? '');
  const [run, setRun] = useState<Run>();
  const [history, setHistory] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (initialRunId) setRunId(initialRunId); }, [initialRunId]);
  // Poll persisted server progress; never launch model work from an effect.
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const runs = await request<Run[]>('/runs', undefined, controller.signal);
        if (controller.signal.aborted) return;
        const pipelines = runs.filter(r => r.request?.autoPrepare);
        setHistory(pipelines);
        const current = pipelines.find(r => r.id === runId);
        if (current) setRun(current);
        else if (!runId && pipelines.length) { setRunId(pipelines[0].id); setRun(pipelines[0]); }
      } catch (e) { if (!controller.signal.aborted) setError(String(e)); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId]);
  const start = async (id = candidateId || candidates[0]?.id) => {
    if (!id || busy) return;
    setBusy(true); setError('');
    try {
      const next = await request<Run>('/verify', { mode: 'agent', candidateId: id, autoPrepare: true });
      setRun(next); setRunId(next.id); setChoosing(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const active = !!run && (['queued', 'running'].includes(run.status) || run.pipelineStage === 'preparing');
  const currentCandidate = run?.candidate ?? candidates.find(c => c.id === candidateId) ?? candidates[0];
  const stage = run?.publicationId ? 4 : run ? 3 : 0;
  const showForm = choosing || !run;
  const steps = [
    { title:'Set the topic', note:currentCandidate ? 'A focused research idea' : 'Choose a research idea', icon:Microscope, done:!!currentCandidate, action:() => setChoosing(true) },
    { title:'Source papers', note:`${currentCandidate?.paperIDs?.length ?? 0} papers attached to this idea`, icon:FileText, done:false, action:() => onNavigate?.('corpus') },
    { title:'Connect the evidence', note:`${currentCandidate?.claimIDs?.length ?? 0} extracted claims attached`, icon:GitBranch, done:false, action:() => onNavigate?.('relations') },
    { title:'Challenge & check', note:run?.publicationId ? 'Recorded checks and report ready' : active ? 'The agent is working' : 'Calculations and source review', icon:Sparkles, done:!!run?.publicationId, action:() => onNavigate?.('verification') },
    { title:'Your decision', note:'Review and decide on sharing', icon:Check, done:false, action:() => document.querySelector('.research-decision')?.scrollIntoView({behavior:'smooth', block:'center'}) },
  ];
  return <section aria-label="Research pipeline" className="research-workspace">
    <aside className="research-journey" aria-label="Research journey">
      <p className="research-eyebrow">This research</p>
      <div className="research-topic"><Microscope size={23} /><span>{currentCandidate?.hypothesis || 'Your next research question'}</span></div>
      <ol aria-label="Pipeline progress" className="research-steps">{steps.map((step,i) => <li key={step.title} className={`${i === stage && !showForm ? 'is-current' : ''} ${step.done ? 'is-complete' : ''}`} aria-current={i === stage && !showForm ? 'step' : undefined}>
        <button onClick={step.action} disabled={(i === 4 && !run?.publicationId) || (i > 0 && i < 4 && !onNavigate)}><span className="research-step-number">{step.done ? <Check size={17} /> : i+1}</span><span><strong>{step.title}</strong><small>{step.note}</small></span></button>
      </li>)}</ol>
      <button className="research-new" disabled={active || busy} onClick={() => setChoosing(true)}><Plus size={17} />New research run</button>
      {!!history.length && <details className="research-history"><summary>Previous research</summary>{history.map(r => <button key={r.id} onClick={() => {setRunId(r.id); setRun(r); setChoosing(false);}}><span>{r.candidate.hypothesis}</span><small>{new Date(r.createdAt).toLocaleString()} · {r.pipelineStage}</small></button>)}</details>}
    </aside>
    <main className="research-workspace-main">
      <header className="research-page-heading"><h2>{showForm ? 'Research to report' : run?.publicationId ? 'Your research is ready to review' : 'Your research is in progress'}</h2><p>{showForm ? 'Choose a topic. Let the agents follow the evidence.' : run?.publicationId ? 'Here is what the checks found — and what still needs evidence.' : 'The agent handles the data and calculations. Progress is saved as it works.'}</p></header>
      {showForm && <div className="research-surface research-start-form">
        <label>Research idea<select aria-label="Research idea" value={candidateId || candidates[0]?.id || ''} onChange={e => setCandidateId(e.target.value)}>
          {!candidates.length && <option value="">Add papers in Corpus to find research ideas</option>}
          {candidates.map(c => <option key={c.id} value={c.id}>{c.hypothesis}</option>)}
        </select></label>
        <button className="research-primary" disabled={busy || active || !candidates.length} onClick={() => void start()}>{busy ? 'Starting…' : active ? 'Research in progress…' : 'Start research pipeline'}</button>
        {run && <button className="research-text-button" onClick={() => setChoosing(false)}>Back to current research</button>}
        <p className="research-muted">No CSV or chart upload needed. If usable data cannot be found, the agent explains the gap.</p>
      </div>}
      {error && <p role="alert" className="research-error">{error}</p>}
      {run && !showForm && !run.publicationId && <div className="research-surface research-progress-card">
        <Sparkles size={26} /><h3>{run.pipelineStage === 'needs_attention' ? 'The pipeline needs attention' : run.pipelineStage === 'preparing' ? 'Building your report and charts' : 'Following the evidence'}</h3>
        <p role="status" className="research-muted">{run.pipelineStage === 'needs_attention' ? 'The agent stopped with a specific gap to resolve.' : run.pipelineStage === 'preparing' ? 'Checking reproducibility and preparing your report…' : active ? 'The research agent is working. You can leave this tab; progress is saved.' : run.status}</p>
        {active && <button className="research-text-button" onClick={() => void request(`/runs/${run.id}/cancel`, {}).catch(e => setError(String(e)))}>Stop this run</button>}
        {run.pipelineStage === 'needs_attention' && <div><p>{run.reportError || run.error}</p>{run.interpretation && <p className="research-narrative">{run.interpretation}</p>}<button className="research-primary" disabled={busy} onClick={() => void start(run.candidate.id)}>Ask the agent to try again</button></div>}
      </div>}
      {run?.publicationId && !showForm && <ResearchPublicationConsole key={run.publicationId} publicationId={run.publicationId} onRebuild={id => void start(id)} />}
    </main>
  </section>;
}
