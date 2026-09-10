import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, FileText, Sparkles, X } from 'lucide-react';
import ResearchPublicationConsole from './ResearchPublicationConsole';

const API = 'http://127.0.0.1:8080/api/research';

interface Question {
  id: string;
  question: string;
  status: string;
  runId?: string;
  publicationId?: string;
  hypothesis?: string;
  interpretation?: string;
}
interface Run {
  id: string;
  theme: string;
  status: string;
  createdAt?: string;
  completedAt?: string;
  questions?: Question[];
}
interface ResultItem {
  questionId: string;
  question: string;
  theme: string;
  when: string;
  publicationId?: string;
  headline?: string;
  narrative?: string;
}

const firstParagraph = (text?: string) => {
  if (!text) return undefined;
  const trimmed = text.replace(/^\s*What we found:?\s*/i, '').trim();
  const [first] = trimmed.split(/\n\s*\n/);
  return first.trim() || undefined;
};

// The page you land on to see what the engine actually produced: one card per
// question that computed a real number, with the headline result and the three
// things you would want to do with it — read it, open the PDF, download it.
export default function ResearchResults() {
  const [items, setItems] = useState<ResultItem[]>();
  const [error, setError] = useState('');
  const [report, setReport] = useState<{ id: string; title: string }>();
  const mounted = useRef(true);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const runs: Run[] = await fetch(`${API}/discoveries`).then((response) => response.json());
      const found: ResultItem[] = [];
      for (const run of Array.isArray(runs) ? runs : []) {
        for (const question of run.questions ?? []) {
          if (question.status !== 'completed') continue;
          found.push({
            questionId: question.id,
            question: question.question,
            theme: run.theme || 'Any field',
            when: new Date(run.completedAt || run.createdAt || '').toLocaleDateString(),
            publicationId: question.publicationId,
            narrative: firstParagraph(question.interpretation),
          });
        }
      }
      if (!mounted.current) return;
      setItems(found);
      setError('');
      // The headline number lives on the verification run, so it is fetched per
      // result rather than guessed from the narrative.
      for (const item of found) {
        const source = (Array.isArray(runs) ? runs : [])
          .flatMap((run) => run.questions ?? [])
          .find((question) => question.id === item.questionId);
        if (!source?.runId) continue;
        try {
          const detail = await fetch(`${API}/runs/${source.runId}`).then((response) => response.json());
          const completed = (detail.results ?? []).find((result: { status: string }) => result.status === 'completed');
          if (!completed?.summary || !mounted.current) continue;
          setItems((previous) => previous?.map((entry) => (
            entry.questionId === item.questionId ? { ...entry, headline: completed.summary } : entry
          )));
        } catch {
          // A missing headline is not worth failing the page over.
        }
      }
    } catch {
      if (mounted.current) setError('Could not reach the research engine. Is the backend running at :8080?');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <section aria-label="Research results" className="research-results">
      {error && <p role="alert" className="research-results__error">{error}</p>}

      {items === undefined && !error && (
        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          <div className="hud-skeleton w-2/3" />
          <div className="hud-skeleton w-1/2" />
        </div>
      )}

      {items?.length === 0 && (
        <div className="research-results__empty">
          <Sparkles size={20} aria-hidden />
          <p><strong>No results yet.</strong></p>
          <p>Run a discovery from the Overview and anything it finds will appear here.</p>
        </div>
      )}

      {!!items?.length && (
        <ul className="research-results__list">
          {items.map((item) => (
            <li key={item.questionId} className="hud-panel hud-tone-worked research-results__card">
              <p className="research-results__meta">
                <span className="hud-chip text-[#90f3da]">Result</span>
                <span className="hud-readout">{item.theme}</span>
                <span className="hud-readout">{item.when}</span>
              </p>
              <h3 className="research-results__question">{item.question}</h3>
              {item.headline
                ? <p className="hud-readout research-results__headline">{item.headline}</p>
                : <p className="research-results__headline research-results__headline--pending">reading the recorded result…</p>}
              {item.narrative && <p className="research-results__narrative">{item.narrative}</p>}
              {item.publicationId && (
                <div className="research-results__actions">
                  <button type="button" className="hud-button hud-button--primary" onClick={() => openReport(item.publicationId!, item.question)}>
                    <FileText size={13} aria-hidden />Read report
                  </button>
                  <a className="hud-button" href={`${API}/publications/${item.publicationId}/pdf`} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} aria-hidden />Open PDF
                  </a>
                  <a className="hud-button" href={`${API}/publications/${item.publicationId}/pdf?download=1`}>
                    <Download size={13} aria-hidden />Download PDF
                  </a>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

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
