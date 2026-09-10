import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, FileText, Play, Square, Trash2, X } from 'lucide-react';
import ResearchPublicationConsole from './ResearchPublicationConsole';

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
  status: string; // running | completed | failed
  createdAt?: string;
  completedAt?: string;
  dismissed?: boolean;
  dismissedAt?: string;
  questions: DiscoveryQuestion[];
  workedCount: number;
  rejectedCount: number;
  error?: string;
}

// One status vocabulary for questions; the run card reuses the same tones, so a
// mint rail always means "produced a recorded finding" and never decoration.
const statusMeta: Record<string, { label: string; tone: string }> = {
  completed: { label: 'Worked', tone: 'hud-tone-worked text-[#90f3da]' },
  rejected: { label: 'No data', tone: 'hud-tone-nodata text-[#f6c879]' },
  failed: { label: 'Failed', tone: 'hud-tone-failed text-[#ff8c86]' },
};
const toneFor = (status: string) => (statusMeta[status] ?? statusMeta.failed).tone;
const running = (d: Discovery) => d.status === 'running';

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function request<T>(path: string, body?: unknown, method?: 'POST' | 'DELETE'): Promise<T> {
  const init: RequestInit = { method: method ?? (body === undefined ? 'GET' : 'POST') };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(API + path, init);
  if (!response.ok) throw new Error((await response.text()) || `Request failed (${response.status})`);
  return (await response.json()) as T;
}

const stamp = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};

// The engine usually echoes the question as the hypothesis. Repeating the same
// sentence twice in one tile is noise, so it only renders when it says more.
const normalize = (value?: string) => (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const addsDetail = (hypothesis?: string, question?: string) => {
  const value = normalize(hypothesis);
  return value.length > 0 && value !== normalize(question);
};

export default function ResearchDiscoveries() {
  const [theme, setTheme] = useState('');
  const [count, setCount] = useState(3);
  const [items, setItems] = useState<Discovery[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [pendingDelete, setPendingDelete] = useState('');
  const [report, setReport] = useState<{ id: string; title: string }>();

  const mounted = useRef(true);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const list = await request<Discovery[]>(`/discoveries${showArchived ? '?includeDismissed=1' : ''}`);
    if (mounted.current) setItems(list);
    return list;
  }, [showArchived]);

  useEffect(() => {
    void refresh().catch((e) => { if (mounted.current) setError(errorMessage(e)); });
  }, [refresh]);

  // Only poll while something is actually running, so an idle tab stays silent.
  const anyRunning = items.some(running);
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => { void refresh().catch(() => undefined); }, 3000);
    return () => clearInterval(timer);
  }, [anyRunning, refresh]);

  // The report opens in-app: the raw /publications/{id} endpoint returns JSON,
  // which the browser renders as unreadable text. Reuse the publication console
  // so a discovery report looks exactly like every other report in the product.
  const openReport = (id: string, title: string) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReport({ id, title });
  };
  useEffect(() => {
    if (!report) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setReport(undefined); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openerRef.current?.focus?.();
    };
  }, [report]);

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(''); setNote('');
    try {
      await work();
      await refresh();
      if (mounted.current) setNote(done);
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true); setError(''); setNote('');
    try {
      await request<Discovery>('/discover', { theme, count });
      await refresh();
      if (mounted.current) setNote('Discovery started. Results appear here as each question finishes.');
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <section aria-label="Autonomous discovery" className="flex flex-col gap-4">
      <div className="hud-panel p-4">
        <p className="hud-label">New discovery batch</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] flex-1 text-xs text-[var(--forensic-text-muted)]">
            Optional theme
            <input
              className="hud-field"
              placeholder="e.g. ecology, metabolism, health (leave blank for any field)"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            />
          </label>
          <label className="text-xs text-[var(--forensic-text-muted)]">
            Questions
            <select className="hud-field" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="hud-button hud-button--primary" disabled={busy} onClick={() => void run()}>
            <Play size={13} aria-hidden />
            {busy ? 'Running…' : 'Run discovery'}
          </button>
        </div>
        {error && <p role="alert" className="mt-3 border-l-2 border-[#ff8c86] pl-3 text-sm text-[#ffb0ab]">{error}</p>}
        <p role="status" aria-live="polite" className="mt-2 text-xs text-[var(--forensic-text-muted)]">{note}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className="hud-tab" aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>Active</button>
        <button className="hud-tab" aria-pressed={showArchived} onClick={() => setShowArchived(true)}>Show archived</button>
        <p className="ml-auto text-[11px] text-[var(--hud-text-faint)]">
          Archiving hides a discovery from this list without deleting its evidence.
        </p>
      </div>

      {items.length === 0 && (
        <p className="rounded border border-dashed border-[var(--hud-line)] px-5 py-8 text-center text-sm text-[var(--forensic-text-muted)]">
          {showArchived ? 'Nothing archived yet.' : 'No discoveries yet. Run one above.'}
        </p>
      )}

      {items.map((d) => {
        const tone = d.dismissed || running(d)
          ? 'hud-tone-archived'
          : toneFor(d.status === 'failed' ? 'failed' : d.workedCount > 0 ? 'completed' : 'rejected');
        return (
          <article
            key={d.id}
            className={`hud-panel hud-panel--action hud-panel--toned ${tone} ${running(d) ? 'hud-panel--live' : ''} p-4`}
          >
            <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--forensic-text)]">{d.theme || 'Any field'}</p>
                <p className="hud-readout mt-1 text-[11px] text-[var(--hud-text-faint)]">
                  {stamp(d.completedAt || d.createdAt)}
                  {d.dismissed && d.dismissedAt ? ` · archived ${stamp(d.dismissedAt)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {running(d) && (
                  <span className="hud-chip text-[var(--forensic-accent)]">
                    <span className="hud-live-dot" aria-hidden />running
                  </span>
                )}
                {d.dismissed && <span className="hud-chip text-[#8b9dae]">Archived</span>}
                <span className="hud-readout text-[11px] text-[#90f3da]">{d.workedCount} worked</span>
                <span className="hud-readout text-[11px] text-[#f6c879]">{d.rejectedCount} no-data</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {running(d) && (
                  <button
                    className="hud-button hud-button--danger"
                    disabled={busy}
                    onClick={() => void act(() => request(`/discoveries/${d.id}/stop`, {}), 'Stopped. Whatever was already found is kept.')}
                  >
                    <Square size={12} aria-hidden />Stop
                  </button>
                )}
                {d.dismissed ? (
                  <button
                    className="hud-button"
                    disabled={busy}
                    onClick={() => void act(() => request(`/discoveries/${d.id}/restore`, {}), 'Restored to the active list.')}
                  >
                    <ArchiveRestore size={13} aria-hidden />Restore
                  </button>
                ) : (
                  <button
                    className="hud-button"
                    disabled={busy || running(d)}
                    title={running(d) ? 'Wait for this run to finish before archiving it' : undefined}
                    onClick={() => void act(() => request(`/discoveries/${d.id}/dismiss`, {}), 'Archived. Use "Show archived" to restore it.')}
                  >
                    <Archive size={13} aria-hidden />Archive
                  </button>
                )}
                {pendingDelete === d.id ? (
                  <>
                    <span className="hud-label text-[#ff8c86]">Delete permanently?</span>
                    <button
                      className="hud-button hud-button--danger"
                      disabled={busy}
                      onClick={() => { setPendingDelete(''); void act(() => request(`/discoveries/${d.id}`, undefined, 'DELETE'), 'Deleted permanently.'); }}
                    >
                      <Trash2 size={13} aria-hidden />Delete
                    </button>
                    <button className="hud-button" onClick={() => setPendingDelete('')}>Cancel</button>
                  </>
                ) : (
                  <button
                    className="hud-button hud-button--danger"
                    aria-label={`Delete the ${d.theme || 'any field'} discovery permanently`}
                    disabled={busy || running(d)}
                    title={running(d) ? 'Wait for this run to finish before deleting it' : 'Delete this discovery and its record'}
                    onClick={() => setPendingDelete(d.id)}
                  >
                    <Trash2 size={13} aria-hidden />Delete
                  </button>
                )}
              </div>
            </header>

            {d.error && <p role="alert" className="mt-3 border-l-2 border-[#ff8c86] pl-3 text-sm text-[#ffb0ab]">{d.error}</p>}

            {d.questions.length === 0 ? (
              <p className="mt-3 text-xs text-[var(--forensic-text-muted)]">
                {running(d) ? 'Proposing research questions…' : 'This run recorded no questions.'}
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {d.questions.map((q) => {
                  const meta = statusMeta[q.status] ?? statusMeta.failed;
                  return (
                    <div key={q.id} className={`hud-tile ${meta.tone}`}>
                      <div className="flex items-start gap-2">
                        <span className="hud-chip mt-0.5 shrink-0">{meta.label}</span>
                        <p className="text-sm font-semibold leading-snug text-[var(--forensic-text)]">{q.question}</p>
                      </div>
                      {q.hypothesis && addsDetail(q.hypothesis, q.question) && (
                        <p className="mt-2 text-xs leading-relaxed text-[var(--forensic-text-muted)]">
                          <span className="hud-label mr-1">Hypothesis</span>{q.hypothesis}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-[var(--hud-text-faint)]">
                        {q.resultsCount > 0 && (
                          <span className="hud-readout">{q.resultsCount} calculation{q.resultsCount === 1 ? '' : 's'}</span>
                        )}
                        {q.error && (
                          <span className={q.status === 'failed' ? 'text-[#ff8c86]' : 'text-[var(--forensic-text-muted)]'}>{q.error}</span>
                        )}
                        {q.publicationId && (
                          <button className="hud-button" onClick={() => openReport(q.publicationId!, q.question)}>
                            <FileText size={12} aria-hidden />Open report
                          </button>
                        )}
                      </div>
                      {q.interpretation && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-[var(--forensic-accent)]">Read result</summary>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--forensic-text-muted)]">{q.interpretation}</p>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        );
      })}

      {report && createPortal(
        <div
          className="hud-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Research report: ${report.title}`}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setReport(undefined); }}
        >
          <div className="hud-overlay__panel">
            <div className="hud-overlay__bar">
              <FileText size={16} className="shrink-0 text-[var(--forensic-accent)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="hud-label">Research report</p>
                <p className="truncate text-sm font-semibold text-[var(--forensic-text)]">{report.title}</p>
              </div>
              <button ref={closeRef} className="hud-button" onClick={() => setReport(undefined)}>
                <X size={13} aria-hidden />Close
              </button>
            </div>
            <div className="hud-overlay__body">
              <ResearchPublicationConsole publicationId={report.id} readOnly />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
