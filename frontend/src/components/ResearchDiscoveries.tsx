import { useCallback, useEffect, useRef, useState } from 'react';

const API = 'http://127.0.0.1:8080/api/research';

interface DiscoveryQuestion {
  id: string;
  question: string;
  status: string; // completed | rejected | failed
  hasResult: boolean;
  resultsCount: number;
  publicationId?: string;
  hypothesis?: string;
  interpretation?: string;
  error?: string;
  runId?: string;
}
interface Discovery {
  id: string;
  theme: string;
  status: string;
  completedAt?: string;
  questions: DiscoveryQuestion[];
  workedCount: number;
  rejectedCount: number;
  error?: string;
}
const field = 'w-full rounded-lg border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-panel)] p-2 text-sm text-[var(--forensic-text)]';
const button = 'rounded-lg border border-[var(--forensic-border-soft)] px-3 py-2 text-xs text-[var(--forensic-accent)] disabled:opacity-40';
const card = 'rounded-xl border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-card)] p-4';
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(API + path, body === undefined ? { signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}
const statusMeta: Record<string, { label: string; tone: string }> = {
  completed: { label: 'Worked', tone: 'border-[#90f3da]/55 bg-[#90f3da]/12 text-[#90f3da]' },
  rejected: { label: 'No data', tone: 'border-[#f6c879]/55 bg-[#f6c879]/12 text-[#f6c879]' },
  failed: { label: 'Failed', tone: 'border-[#ff8c86]/55 bg-[#ff8c86]/12 text-[#ff8c86]' },
};
const running = (d: Discovery) => d.status === 'running';

export default function ResearchDiscoveries() {
  const [theme, setTheme] = useState('');
  const [count, setCount] = useState(3);
  const [items, setItems] = useState<Discovery[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const refresh = useCallback(async () => {
    const list = await request<Discovery[]>('/discoveries');
    if (mounted.current) setItems(list);
  }, []);

  useEffect(() => { void refresh().catch((e) => mounted.current && setError(String(e))); }, [refresh]);

  const run = async () => {
    setBusy(true); setError('');
    try {
      const d = await request<Discovery>('/discover', { theme, count });
      await refresh();
      // Poll the new discovery until it is no longer running.
      let cur = d;
      while (cur.status === 'running') {
        await new Promise((r) => setTimeout(r, 3000));
        cur = await request<Discovery>(`/discoveries/${d.id}`);
        if (mounted.current) setItems((prev) => prev.map((x) => (x.id === d.id ? cur : x)));
      }
      await refresh();
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current) setBusy(false); }
  };

  return (
    <section aria-label="Autonomous discovery" className="mt-4 flex flex-col gap-4">
      <div className={card}>
        <h2 className="text-lg font-semibold">Autonomous discovery</h2>
        <p className="research-muted">The engine proposes its own research questions, runs each, and shows which produced a real finding versus which had no usable data.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex-1 text-xs">Optional theme<input className={field} placeholder="e.g. ecology, metabolism, health (leave blank for any field)" value={theme} onChange={(e) => setTheme(e.target.value)} /></label>
          <label className="text-xs">Questions<select className={field} value={count} onChange={(e) => setCount(Number(e.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label>
          <button className={button} disabled={busy} onClick={() => void run()}>{busy ? 'Running…' : 'Run discovery'}</button>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-[#ff8c86]">{error}</p>}
      </div>

      {items.length === 0 && <p className="text-sm text-[var(--forensic-text-muted)]">No discoveries yet. Run one above.</p>}

      {items.map((d) => (
        <div key={d.id} className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{d.theme || 'Any field'}</span>
            {running(d) && <span className="text-xs text-[var(--forensic-accent)]">running…</span>}
            {!running(d) && <span className="text-xs text-[var(--forensic-text-muted)]">completed</span>}
            <span className="ml-auto text-xs"><span className="text-[#90f3da]">{d.workedCount} worked</span> · <span className="text-[#f6c879]">{d.rejectedCount} no-data</span></span>
          </div>
          {d.error && <p role="alert" className="mt-2 text-sm text-[#ff8c86]">{d.error}</p>}
          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 lg:grid-cols-2">
            {d.questions.map((q) => {
              const meta = statusMeta[q.status] || statusMeta.failed;
              return (
                <div key={q.id} className="rounded-lg border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-panel)] p-3">
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.tone}`}>{meta.label}</span>
                    <p className="text-sm font-semibold text-[var(--forensic-text)]">{q.question}</p>
                  </div>
                  {q.hypothesis && <p className="mt-2 text-xs text-[var(--forensic-text-muted)]">Hypothesis: {q.hypothesis}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--forensic-text-faint)]">
                    {q.resultsCount > 0 && <span>{q.resultsCount} calc(s)</span>}
                    {q.error && <span className="text-[#ff8c86]">{q.error}</span>}
                    {q.publicationId && <a className="text-[var(--forensic-accent)] hover:underline" href={`${API}/publications/${q.publicationId}`} target="_blank" rel="noreferrer">Open report</a>}
                  </div>
                  {q.interpretation && <details className="mt-2"><summary className="cursor-pointer text-xs text-[var(--forensic-accent)]">Read result</summary><p className="mt-1 text-xs text-[var(--forensic-text-muted)]">{q.interpretation}</p></details>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
