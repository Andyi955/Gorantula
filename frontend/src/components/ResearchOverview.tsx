import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Compass, Database, FileText, Lightbulb, Loader, Play, RotateCw, Square } from 'lucide-react';

const API = 'http://127.0.0.1:8080/api/research';

interface DiscoveryQuestion {
  id: string;
  question: string;
  status: string;
}
interface DiscoveryRun {
  id: string;
  status: string;
  planned?: number;
  workedCount: number;
  rejectedCount: number;
  stopReason?: string;
  error?: string;
  questions?: DiscoveryQuestion[];
}
interface Stats {
  runs: number;
  questions: number;
  worked: number;
  noData: number;
  reports: number;
}
interface Progress {
  planned: number;
  done: number;
  worked: number;
  noData: number;
  current?: string;
}

export type ResearchTarget =
  | 'pipeline' | 'discoveries' | 'results' | 'verification' | 'publish'
  | 'signals' | 'candidates' | 'corpus';

// How many questions one press asks. Two keeps a single press short enough to
// watch while still being worth reading afterwards.
const RUN_SIZE = 2;

const readProgress = (run: DiscoveryRun): Progress => {
  const questions = run.questions ?? [];
  const finished = questions.filter((question) => question.status !== 'running');
  const inFlight = questions.find((question) => question.status === 'running');
  return {
    planned: run.planned ?? questions.length,
    done: finished.length,
    worked: finished.filter((question) => question.status === 'completed').length,
    noData: finished.filter((question) => question.status === 'rejected').length,
    current: inFlight?.question,
  };
};

// The Research tab opens here. It answers three questions in plain language
// before showing any of the machinery: what this area does, what it has found
// so far, and how to make it go.
export default function ResearchOverview({
  onNavigate,
  paperCount,
  candidateCount,
  findingCount,
}: {
  onNavigate: (view: ResearchTarget) => void;
  paperCount: number;
  candidateCount: number;
  findingCount: number;
}) {
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [progress, setProgress] = useState<Progress>({ planned: RUN_SIZE, done: 0, worked: 0, noData: 0 });
  const [finished, setFinished] = useState<{ progress: Progress; stopReason?: string; status: string }>();
  const [stopOnFound, setStopOnFound] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);
  const runIdRef = useRef<string | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const [runs, reports] = await Promise.all([
        fetch(`${API}/discoveries`).then((response) => response.json()),
        fetch(`${API}/publications`).then((response) => response.json()),
      ]);
      const list: DiscoveryRun[] = Array.isArray(runs) ? runs : [];
      if (!mounted.current) return;
      setStats({
        runs: list.length,
        questions: list.reduce((total, run) => total + (run.questions?.length ?? 0), 0),
        worked: list.reduce((total, run) => total + (run.workedCount ?? 0), 0),
        noData: list.reduce((total, run) => total + (run.rejectedCount ?? 0), 0),
        reports: Array.isArray(reports) ? reports.length : 0,
      });
      setError('');
    } catch {
      if (mounted.current) setError('Could not reach the research engine. Is the backend running at :8080?');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Elapsed time is shown while a round runs and cleared when it ends, so the
  // panel never implies a stale run is still going.
  useEffect(() => {
    if (phase !== 'running') return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // One press: the engine proposes its own questions, finds public data for
  // each, computes, and writes a report. This only starts it, watches it, and
  // can stop it.
  const runNow = async () => {
    setPhase('running');
    setError('');
    setFinished(undefined);
    setProgress({ planned: RUN_SIZE, done: 0, worked: 0, noData: 0 });
    try {
      const response = await fetch(`${API}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: '', count: RUN_SIZE, stopOnResult: stopOnFound }),
      });
      if (!response.ok) throw new Error((await response.text()) || `Could not start a run (${response.status})`);
      const started: DiscoveryRun = await response.json();
      runIdRef.current = started.id;
      // Apply the start response straight away: the round may already be on a
      // question, and without this the panel shows nothing until the first poll.
      if (mounted.current) setProgress(readProgress(started));
      let current = started;
      while (current.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (!mounted.current) return;
        current = await fetch(`${API}/discoveries/${started.id}`).then((next) => next.json());
        if (mounted.current) setProgress(readProgress(current));
      }
      if (!mounted.current) return;
      // A round that failed or was stopped must not be reported as "Done": the
      // reader has to be told what actually happened.
      if (current.status === 'failed') {
        setError(current.error || 'The round failed before it could ask any questions.');
        setPhase('failed');
        void load();
        return;
      }
      setFinished({ progress: readProgress(current), stopReason: current.stopReason, status: current.status });
      setPhase('done');
      void load();
    } catch (thrown) {
      if (!mounted.current) return;
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setPhase('failed');
    } finally {
      runIdRef.current = undefined;
      if (mounted.current) setStopping(false);
    }
  };

  // Stopping is a request, not a local cancel: the round runs on the server, so
  // the backend has to be told too. The poll loop ends when the record settles.
  const stopNow = async () => {
    const id = runIdRef.current;
    if (!id) return;
    setStopping(true);
    try {
      await fetch(`${API}/discoveries/${id}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const stopped: DiscoveryRun = await fetch(`${API}/discoveries/${id}`).then((next) => next.json());
      if (mounted.current) setProgress(readProgress(stopped));
    } catch (thrown) {
      if (mounted.current) setError(thrown instanceof Error ? thrown.message : String(thrown));
      setStopping(false);
    }
  };

  const tiles: { key: string; label: string; value: number | undefined; tone: string; note: string; target: ResearchTarget }[] = [
    { key: 'questions', label: 'Questions asked', value: stats?.questions, tone: '', note: `across ${stats?.runs ?? 0} rounds`, target: 'discoveries' },
    { key: 'worked', label: 'Produced a result', value: stats?.worked, tone: 'research-overview__value--worked', note: 'the engine computed a real number', target: 'results' },
    { key: 'nodata', label: 'No usable data', value: stats?.noData, tone: 'research-overview__value--nodata', note: 'it looked, found nothing, invented nothing', target: 'discoveries' },
    { key: 'reports', label: 'Reports written', value: stats?.reports, tone: '', note: 'ready to read', target: 'publish' },
  ];

  const inside: { key: string; icon: typeof Lightbulb; count: number | undefined; label: string; note: string; target: ResearchTarget }[] = [
    { key: 'findings', icon: Lightbulb, count: findingCount, label: 'findings', note: 'connections the engine noticed between papers', target: 'signals' },
    { key: 'hypotheses', icon: Compass, count: candidateCount, label: 'hypotheses', note: 'research ideas waiting on your decision', target: 'candidates' },
    { key: 'papers', icon: Database, count: paperCount, label: 'papers', note: 'the source material the engine reads', target: 'corpus' },
    { key: 'reports', icon: FileText, count: stats?.reports, label: 'reports', note: 'read, approve, or export a written result', target: 'publish' },
  ];

  const percent = progress.planned > 0 ? Math.round((progress.done / progress.planned) * 100) : 0;
  const minutes = Math.floor(elapsed / 60);
  const clock = minutes > 0 ? `${minutes}m ${elapsed % 60}s` : `${elapsed}s`;

  return (
    <section aria-label="Research overview" className="research-overview">
      <header className={`hud-panel research-overview__intro ${phase === 'running' ? 'hud-panel--live' : ''}`}>
        <p className="hud-label">Start here</p>
        <h2>Ask a question. The engine finds the data and runs the numbers.</h2>
        <p className="research-overview__lede">
          It searches public datasets and repositories, computes a real result, and writes a short report you can read.
          When there is no usable data it says so — it never invents an answer.
        </p>

        {phase === 'idle' && (
          <div className="research-overview__actions">
            <button type="button" className="hud-button hud-button--primary" onClick={() => void runNow()}>
              <Play size={14} aria-hidden />
              Run a discovery for me
            </button>
            <button type="button" className="hud-button" onClick={() => onNavigate('pipeline')}>
              Research my own topic
            </button>
            <label className="research-overview__option">
              <input type="checkbox" checked={stopOnFound} onChange={(event) => setStopOnFound(event.target.checked)} />
              Stop as soon as it finds a result
            </label>
          </div>
        )}

        {phase === 'running' && (
          <div className="research-overview__progress">
            {progress.planned === 0 ? (
              // The round proposes its questions before it runs any, so an empty
              // progress bar here would read as a stall rather than a step.
              <p className="research-overview__progress-line" role="status" aria-live="polite">
                <Loader size={14} className="research-overview__spin" aria-hidden />
                Proposing research questions…
              </p>
            ) : (
              <>
                <p className="research-overview__progress-line" role="status" aria-live="polite">
                  <Loader size={14} className="research-overview__spin" aria-hidden />
                  Working — {progress.done} of {progress.planned} questions finished
                </p>
                <div
                  className="research-overview__bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={progress.planned}
                  aria-valuenow={progress.done}
                  aria-label="Questions finished"
                >
                  <span style={{ width: `${percent}%` }} />
                </div>
                {progress.current && (
                  <p className="research-overview__current">
                    Now working on <em>{progress.current}</em>
                  </p>
                )}
              </>
            )}
            <p className="research-overview__progress-detail hud-readout">
              {progress.worked} produced a result · {progress.noData} no usable data · {clock} elapsed
            </p>
            <div className="research-overview__actions">
              <button type="button" className="hud-button hud-button--danger" disabled={stopping} onClick={() => void stopNow()}>
                <Square size={12} aria-hidden />
                {stopping ? 'Stopping…' : 'Stop'}
              </button>
            </div>
            <p className="research-overview__hint">
              Stopping keeps whatever has already been found. You can also leave this page — the run keeps going.
            </p>
          </div>
        )}

        {phase === 'done' && finished && (
          <div className="research-overview__progress">
            <p className="research-overview__progress-line" role="status" aria-live="polite">
              <span className="hud-live-dot" aria-hidden />{' '}
              {finished.status === 'stopped' ? 'Stopped.' : 'Done.'} {finished.progress.done} question
              {finished.progress.done === 1 ? '' : 's'} finished, {finished.progress.worked} produced a result.
            </p>
            {finished.stopReason && <p className="research-overview__progress-detail">{finished.stopReason}.</p>}
            <div className="research-overview__actions">
              <button type="button" className="hud-button hud-button--primary" onClick={() => onNavigate('results')}>
                See the results
                <ArrowRight size={14} aria-hidden />
              </button>
              <button type="button" className="hud-button" onClick={() => void runNow()}>
                <RotateCw size={13} aria-hidden />Run another
              </button>
            </div>
          </div>
        )}

        {phase === 'failed' && (
          <div className="research-overview__actions">
            <button type="button" className="hud-button hud-button--primary" onClick={() => void runNow()}>
              <RotateCw size={13} aria-hidden />Try again
            </button>
            <button type="button" className="hud-button" onClick={() => onNavigate('pipeline')}>
              Research my own topic
            </button>
          </div>
        )}

        {error && <p role="alert" className="research-overview__error">{error}</p>}
      </header>

      <div className="research-overview__stats">
        {tiles.map((tile) => (
          <button
            type="button"
            className="hud-tile research-overview__stat"
            key={tile.key}
            onClick={() => onNavigate(tile.target)}
          >
            <span className="hud-label">{tile.label}</span>
            <span className={`hud-readout research-overview__value ${tile.tone}`}>
              {tile.value === undefined ? '—' : tile.value.toLocaleString()}
            </span>
            <span className="research-overview__note">{tile.note}</span>
          </button>
        ))}
      </div>

      <div className="research-overview__row">
        <section className="hud-panel research-overview__panel" aria-label="What the words mean">
          <p className="hud-label">What the words mean</p>
          <dl className="research-overview__glossary">
            <dt>Round</dt>
            <dd>One batch of questions the engine asked and ran on its own.</dd>
            <dt>Produced a result</dt>
            <dd>The engine found real data and computed a number from it.</dd>
            <dt>No usable data</dt>
            <dd>It searched and found nothing it could compute on. Nothing was made up to fill the gap.</dd>
            <dt>Inconclusive</dt>
            <dd>Every report is labelled this. A computed number is evidence, not proof.</dd>
          </dl>
        </section>

        <section className="hud-panel research-overview__panel" aria-label="What is already inside">
          <p className="hud-label">Already inside</p>
          <div className="research-overview__links">
            {inside.map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  type="button"
                  className="research-overview__link"
                  key={entry.key}
                  onClick={() => onNavigate(entry.target)}
                >
                  <Icon size={16} aria-hidden />
                  <span className="research-overview__link-text">
                    <span className="research-overview__link-count">
                      <strong>{entry.count ?? '—'}</strong> {entry.label}
                    </span>
                    <small>{entry.note}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}
