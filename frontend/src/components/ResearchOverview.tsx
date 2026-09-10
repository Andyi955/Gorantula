import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Compass, Database, FileText, Lightbulb } from 'lucide-react';

const API = 'http://127.0.0.1:8080/api/research';

interface DiscoveryRun {
  status: string;
  workedCount: number;
  rejectedCount: number;
  questions?: { status: string }[];
}
interface Stats {
  runs: number;
  questions: number;
  worked: number;
  noData: number;
  reports: number;
}

export type ResearchTarget = 'pipeline' | 'discoveries' | 'verification' | 'publish' | 'signals' | 'candidates' | 'corpus';

// The Research tab opens here. It answers three questions in plain language
// before showing any of the machinery: what this area does, what it has found
// so far, and where to go next.
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

  const load = useCallback(async () => {
    try {
      const [runs, reports] = await Promise.all([
        fetch(`${API}/discoveries`).then((response) => response.json()),
        fetch(`${API}/publications`).then((response) => response.json()),
      ]);
      const list: DiscoveryRun[] = Array.isArray(runs) ? runs : [];
      setStats({
        runs: list.length,
        questions: list.reduce((total, run) => total + (run.questions?.length ?? 0), 0),
        worked: list.reduce((total, run) => total + (run.workedCount ?? 0), 0),
        noData: list.reduce((total, run) => total + (run.rejectedCount ?? 0), 0),
        reports: Array.isArray(reports) ? reports.length : 0,
      });
      setError('');
    } catch {
      setError('Could not reach the research engine. Is the backend running at :8080?');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tiles: { key: string; label: string; value: number | undefined; tone: string; note: string; target: ResearchTarget }[] = [
    { key: 'questions', label: 'Questions asked', value: stats?.questions, tone: '', note: `across ${stats?.runs ?? 0} rounds`, target: 'discoveries' },
    { key: 'worked', label: 'Produced a result', value: stats?.worked, tone: 'research-overview__value--worked', note: 'the engine computed a real number', target: 'discoveries' },
    { key: 'nodata', label: 'No usable data', value: stats?.noData, tone: 'research-overview__value--nodata', note: 'it looked, found nothing, invented nothing', target: 'discoveries' },
    { key: 'reports', label: 'Reports written', value: stats?.reports, tone: '', note: 'ready to read', target: 'publish' },
  ];

  const inside: { key: string; icon: typeof Lightbulb; count: number | undefined; label: string; note: string; target: ResearchTarget }[] = [
    { key: 'findings', icon: Lightbulb, count: findingCount, label: 'findings', note: 'connections the engine noticed between papers', target: 'signals' },
    { key: 'hypotheses', icon: Compass, count: candidateCount, label: 'hypotheses', note: 'research ideas waiting on your decision', target: 'candidates' },
    { key: 'papers', icon: Database, count: paperCount, label: 'papers', note: 'the source material the engine reads', target: 'corpus' },
    { key: 'reports', icon: FileText, count: stats?.reports, label: 'reports', note: 'read, approve, or export a written result', target: 'publish' },
  ];

  return (
    <section aria-label="Research overview" className="research-overview">
      <header className="hud-panel research-overview__intro">
        <p className="hud-label">Start here</p>
        <h2>Ask a question. The engine finds the data and runs the numbers.</h2>
        <p className="research-overview__lede">
          It searches public datasets and repositories, computes a real result, and writes a short report you can read.
          When there is no usable data it says so — it never invents an answer.
        </p>
        <div className="research-overview__actions">
          <button type="button" className="hud-button hud-button--primary" onClick={() => onNavigate('discoveries')}>
            Discover something new
            <ArrowRight size={14} aria-hidden />
          </button>
          <button type="button" className="hud-button" onClick={() => onNavigate('pipeline')}>
            Research my own topic
          </button>
        </div>
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
