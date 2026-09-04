import { useCallback, useEffect, useMemo, useState } from 'react';
import { Microscope, Plus, GitBranch, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';

const RESEARCH_API = 'http://127.0.0.1:8080/api/research';

interface Paper {
  id: string;
  title: string;
  authors?: string[];
  venue?: string;
  year?: number;
  abstract?: string;
  fullText?: string;
  sourceURL?: string;
  license?: string;
  ingestedAt?: string;
}

interface Claim {
  id: string;
  paperId: string;
  text: string;
  kind?: string;
  entities?: string[];
  confidence?: number;
  provenance?: string;
  sourceOffset?: number;
  sourceSnippet?: string;
}

interface ClaimRelation {
  id: string;
  sourceClaimID: string;
  targetClaimID: string;
  relationKind: string;
  basis?: string[];
  strength?: number;
  createdBy?: string;
}

interface ResearchSignal {
  id: string;
  kind: string;
  title: string;
  claimIDs: string[];
  paperIDs: string[];
  reasoning?: string;
  strength?: number;
  createdAt?: string;
}

type View = 'signals' | 'corpus' | 'relations';

const SIGNAL_META: Record<string, { label: string; icon: typeof AlertTriangle; tone: string }> = {
  contradiction: { label: 'Contradiction', icon: AlertTriangle, tone: 'text-[#ff8c86] border-[#ff8c86]/40 bg-[#ff8c86]/10' },
  convergence: { label: 'Convergence', icon: CheckCircle2, tone: 'text-[#90f3da] border-[#90f3da]/40 bg-[#90f3da]/10' },
  divergence: { label: 'Divergence', icon: GitBranch, tone: 'text-[#f6c879] border-[#f6c879]/40 bg-[#f6c879]/10' },
  hypothesis: { label: 'Hypothesis', icon: ArrowRight, tone: 'text-[var(--forensic-accent)] border-[#8ee8ff]/40 bg-[#8ee8ff]/10' },
  gap: { label: 'Gap', icon: Microscope, tone: 'text-[var(--forensic-text-muted)] border-[#a2b3c4]/40 bg-[#a2b3c4]/10' },
};

const relationLabel = (kind: string) => {
  switch (kind) {
    case 'CONTRADICTS': return 'contradicts';
    case 'CONVERGES': return 'converges with';
    case 'SUPPORTS': return 'supports';
    default: return kind.toLowerCase();
  }
};

const ScientificResearchLab = () => {
  const [view, setView] = useState<View>('signals');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [relations, setRelations] = useState<ClaimRelation[]>([]);
  const [signals, setSignals] = useState<ResearchSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [abstract, setAbstract] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpanded = (id: string) => setExpanded((cur) => ({ ...cur, [id]: !cur[id] }));

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, c, r, s] = await Promise.all([
        fetch(`${RESEARCH_API}/papers`).then((res) => res.json()),
        fetch(`${RESEARCH_API}/claims`).then((res) => res.json()),
        fetch(`${RESEARCH_API}/relations`).then((res) => res.json()),
        fetch(`${RESEARCH_API}/signals`).then((res) => res.json()),
      ]);
      setPapers(Array.isArray(p) ? p : []);
      setClaims(Array.isArray(c) ? c : []);
      setRelations(Array.isArray(r) ? r : []);
      setSignals(Array.isArray(s) ? s : []);
    } catch {
      setError('Could not reach the research engine. Is the backend running at :8080?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const claimCountByPaper = useMemo(() => {
    const map: Record<string, number> = {};
    for (const claim of claims) {
      map[claim.paperId] = (map[claim.paperId] || 0) + 1;
    }
    return map;
  }, [claims]);

  const claimById = useMemo(() => {
    const map: Record<string, Claim> = {};
    for (const claim of claims) {
      map[claim.id] = claim;
    }
    return map;
  }, [claims]);

  const submitIngest = async () => {
    if (!title.trim() || !abstract.trim()) return;
    const paper: Paper = {
      id: `paper-${Date.now()}`,
      title: title.trim(),
      abstract: abstract.trim(),
    };
    setAdding(true);
    setError(null);
    try {
      await fetch(`${RESEARCH_API}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ papers: [paper] }),
      });
      setTitle('');
      setAbstract('');
      await reload();
    } catch {
      setError('Ingest failed. Check the backend + provider config.');
    } finally {
      setAdding(false);
    }
  };

  const nav = (items: { id: View; label: string; count: string }[]) => (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setView(item.id)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            view === item.id
              ? 'border-[var(--forensic-accent)] bg-[var(--forensic-glow)] text-[var(--forensic-accent-strong)]'
              : 'border-[var(--forensic-border-soft)] text-[var(--forensic-text-muted)] hover:border-[var(--forensic-border)] hover:text-[var(--forensic-text)]'
          }`}
        >
          {item.label}
          <span className="ml-1.5 opacity-60">{item.count}</span>
        </button>
      ))}
    </div>
  );

  const emptyState = (message: string) => (
    <div className="mt-6 rounded-xl border border-dashed border-[var(--forensic-border-soft)] px-5 py-8 text-center text-sm text-[var(--forensic-text-muted)]">
      {message}
    </div>
  );

  const renderSignals = () => {
    if (signals.length === 0) {
      return emptyState('No cross-paper findings yet. Add a couple of papers to surface contradictions and convergences.');
    }
    return (
      <div className="mt-4 flex flex-col gap-3">
        {signals.map((signal) => {
          const meta = SIGNAL_META[signal.kind] || SIGNAL_META.hypothesis;
          const Icon = meta.icon;
          return (
            <div key={signal.id} className="rounded-xl border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-card)] p-4">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${meta.tone}`}>
                  <Icon size={12} aria-hidden />
                  {meta.label}
                </span>
                <span className="text-[11px] text-[var(--forensic-text-faint)]">strength {signal.strength ?? '—'}</span>
              </div>
              <p className={`mt-2 text-sm font-semibold text-[var(--forensic-text)] ${expanded[signal.id] ? '' : 'line-clamp-3'}`}>{signal.title}</p>
              {signal.reasoning && <p className="mt-1 text-xs text-[var(--forensic-text-muted)]">{signal.reasoning}</p>}
              {expanded[signal.id] && (
                <div className="mt-2 flex flex-col gap-3 border-t border-[var(--forensic-border-soft)] pt-2">
                  {signal.claimIDs.map((cid) => {
                    const claim = claimById[cid];
                    if (!claim) {
                      return null;
                    }
                    return (
                      <div key={cid} className="text-xs">
                        <p className="text-[var(--forensic-text)]">{claim.text}</p>
                        {claim.entities && claim.entities.length > 0 && (
                          <p className="mt-0.5 text-[var(--forensic-accent)]">{claim.entities.join('  ')}</p>
                        )}
                        {claim.sourceSnippet && (
                          <p className="mt-0.5 italic leading-relaxed text-[var(--forensic-text-faint)]">“{claim.sourceSnippet}”</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {signal.paperIDs.map((id) => (
                    <span key={id} className="rounded border border-[var(--forensic-border-soft)] bg-[var(--forensic-glow)] px-1.5 py-0.5 text-[var(--forensic-accent)]">{id}</span>
                  ))}
                </div>
                {signal.title.length > 120 && (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(signal.id)}
                    className="text-[11px] font-semibold uppercase tracking-wider text-[var(--forensic-accent)] hover:underline"
                  >
                    {expanded[signal.id] ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderCorpus = () => (
    <div className="mt-4 flex flex-col gap-3">
      <div className="rounded-xl border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-card)] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--forensic-text)]">
          <Plus size={16} className="text-[var(--forensic-accent)]" aria-hidden />
          Add papers
        </div>
        <p className="mt-1 text-xs text-[var(--forensic-text-muted)]">Paste a title + abstract (or full text) and the engine will extract grounded, entity-tagged claims.</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="mt-3 w-full rounded-lg border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-panel)] px-3 py-2 text-sm text-[var(--forensic-text)] placeholder-[var(--forensic-text-faint)] outline-none focus:border-[var(--forensic-accent)]"
        />
        <textarea
          value={abstract}
          onChange={(e) => setAbstract(e.target.value)}
          placeholder="Abstract / full text"
          rows={4}
          className="mt-2 w-full resize-none rounded-lg border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-panel)] px-3 py-2 text-sm text-[var(--forensic-text)] placeholder-[var(--forensic-text-faint)] outline-none focus:border-[var(--forensic-accent)]"
        />
        <button
          type="button"
          onClick={submitIngest}
          disabled={adding || !title.trim() || !abstract.trim()}
          className="mt-3 rounded-lg border border-[var(--forensic-accent)] bg-[var(--forensic-glow)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--forensic-accent-strong)] disabled:opacity-40"
        >
          {adding ? 'Ingesting…' : 'Ingest & analyze'}
        </button>
      </div>

      {papers.length === 0 ? (
        emptyState('No papers yet — add one above to seed the corpus.')
      ) : (
        papers.map((paper) => (
          <div key={paper.id} className="rounded-xl border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--forensic-text)]">{paper.title}</p>
                <p className="mt-0.5 text-xs text-[var(--forensic-text-faint)]">
                  {paper.venue || '—'} {paper.year ? `· ${paper.year}` : ''} · {claimCountByPaper[paper.id] || 0} claim(s)
                </p>
              </div>
              <span className="rounded border border-[var(--forensic-border-soft)] px-1.5 py-0.5 text-[11px] text-[var(--forensic-accent)]">{paper.id}</span>
            </div>
            {paper.abstract && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--forensic-text-muted)]">{paper.abstract}</p>}
          </div>
        ))
      )}
    </div>
  );

  const renderRelations = () => {
    if (relations.length === 0) {
      return emptyState('No cross-paper claim relations yet. Ingest papers that share entities to see them connect.');
    }
    return (
      <div className="mt-4 flex flex-col gap-2">
        {relations.map((relation) => {
          const source = claimById[relation.sourceClaimID];
          const target = claimById[relation.targetClaimID];
          const basis = relation.basis?.map((key) => key.split('|').pop()).filter(Boolean).join(', ') || '';
          return (
            <div key={relation.id} className="rounded-xl border border-[var(--forensic-border-soft)] bg-[var(--forensic-bg-card)] p-4">
              <p className={`text-sm text-[var(--forensic-text)] ${expanded[relation.id] ? '' : 'line-clamp-3'}`}>
                <span className="font-semibold">{source ? source.text : relation.sourceClaimID}</span>{' '}
                <span className="text-[var(--forensic-accent)]">{relationLabel(relation.relationKind)}</span>{' '}
                <span className="font-semibold">{target ? target.text : relation.targetClaimID}</span>
              </p>
              {basis && <p className="mt-1 text-[11px] text-[var(--forensic-text-faint)]">shared: {basis}</p>}
              {expanded[relation.id] && (
                <div className="mt-2 flex flex-col gap-3 border-t border-[var(--forensic-border-soft)] pt-2">
                  {[source, target].filter((claim): claim is Claim => Boolean(claim)).map((claim) => (
                    <div key={claim.id} className="text-xs">
                      <p className="text-[var(--forensic-text)]">{claim.text}</p>
                      {claim.entities && claim.entities.length > 0 && (
                        <p className="mt-0.5 text-[var(--forensic-accent)]">{claim.entities.join('  ')}</p>
                      )}
                      {claim.sourceSnippet && (
                        <p className="mt-0.5 italic leading-relaxed text-[var(--forensic-text-faint)]">“{claim.sourceSnippet}”</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {((source?.text.length || 0) + (target?.text.length || 0)) > 180 && (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(relation.id)}
                    className="text-[11px] font-semibold uppercase tracking-wider text-[var(--forensic-accent)] hover:underline"
                  >
                    {expanded[relation.id] ? 'Show less' : 'Show more'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--forensic-bg-root)] p-6 text-[var(--forensic-text)]">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center gap-2">
          <Microscope size={18} className="text-[var(--forensic-accent)]" aria-hidden />
          <h1 className="text-lg font-black tracking-tight text-[var(--forensic-text)]">Scientific Research</h1>
        </div>
        <p className="mt-1 text-xs text-[var(--forensic-text-faint)]">Cross-paper evidence engine — contradictions, convergences, and grounded claims.</p>

        <div className="mt-3 flex flex-wrap gap-2">
          {nav([
            { id: 'signals', label: 'Findings', count: `${signals.length}` },
            { id: 'corpus', label: 'Corpus', count: `${papers.length}` },
            { id: 'relations', label: 'Claim graph', count: `${relations.length}` },
          ])}
        </div>

        {error && <div className="mt-3 rounded-lg border border-[#ff8c86]/40 bg-[#ff8c86]/10 px-3 py-2 text-xs text-[#ffb0ab]">{error}</div>}

        {loading ? (
          <p className="mt-6 text-sm text-[var(--forensic-text-muted)]">Loading corpus…</p>
        ) : (
          <>
            {view === 'signals' && renderSignals()}
            {view === 'corpus' && renderCorpus()}
            {view === 'relations' && renderRelations()}
          </>
        )}
      </div>
    </div>
  );
};

export default ScientificResearchLab;
