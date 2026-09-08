import { useCallback, useEffect, useMemo, useState } from 'react';
import { Microscope, Plus, Check, GitBranch, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import ResearchVerificationConsole from './ResearchVerificationConsole';
import ResearchPublicationConsole from './ResearchPublicationConsole';
import ResearchPipeline from './ResearchPipeline';
import ResearchDiscoveries from './ResearchDiscoveries';

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

interface ChecklistItem {
  id: string;
  question: string;
  answer: string;
  grade: string;
  reason?: string;
  confidence?: number;
}

interface Candidate {
  id: string;
  signalID: string;
  hypothesis: string;
  supporting?: string[];
  contradicting?: string[];
  claimIDs?: string[];
  paperIDs?: string[];
  noveltyScore?: number;
  nearestWork?: string;
  checklist?: ChecklistItem[];
  expansion?: CandidateExpansion;
  verdict?: string;
  rationale?: string;
  summary?: string;
  evidenceGrade?: string;
  state: string;
  approvedBy?: string;
  approvedAt?: string;
}

interface CandidateExpansion {
  round: number;
  criteria?: string[];
  retrieved?: Paper[];
}

type View = 'pipeline' | 'discoveries' | 'signals' | 'corpus' | 'relations' | 'candidates' | 'verification' | 'publish';

const VERDICT_META: Record<string, { label: string; tone: string }> = {
  agreed: { label: 'Agreed', tone: 'text-[#90f3da] border-[#90f3da]/45 bg-[#90f3da]/10' },
  disputed: { label: 'Disputed', tone: 'text-[#f6c879] border-[#f6c879]/45 bg-[#f6c879]/10' },
  refuted: { label: 'Refuted', tone: 'text-[#ff8c86] border-[#ff8c86]/45 bg-[#ff8c86]/10' },
};

const STATE_LABEL: Record<string, string> = {
  proposed: 'Proposed',
  reviewed: 'Reviewed',
  tested: 'Tested',
  supported: 'Supported',
  refuted: 'Refuted',
  approved: 'Approved',
  rejected: 'Rejected',
};

const VERDICT_RECOMMENDATION: Record<string, { label: string; tone: string }> = {
  agreed: { label: 'Approve — all criteria are satisfied.', tone: 'text-[#90f3da]' },
  disputed: { label: 'Needs more evidence — don’t approve yet.', tone: 'text-[#f6c879]' },
  refuted: { label: 'Reject — the evidence directly fails it.', tone: 'text-[#ff8c86]' },
};

// verdictStatus derives a truthful one-line status from the candidate's final
// checklist (never from the static verdict alone), so the UI never claims the
// evidence is stronger than it is. It's the fallback when no LLM summary exists
// (heuristic review, or older persisted candidates).
function verdictStatus(candidate: Candidate): string {
  const checklist = candidate.checklist || [];
  const total = checklist.length;
  const yes = checklist.filter((item) => item.answer === 'yes').length;
  const unknown = checklist.filter((item) => item.answer === 'unknown').length;
  const no = total - yes - unknown;
  const verdict = candidate.verdict || 'disputed';

  if (total === 0) {
    if (verdict === 'agreed') return 'All criteria satisfied — approvable.';
    if (verdict === 'refuted') return 'Reject — the evidence fails it.';
    return 'Current evidence doesn’t clearly support or refute it.';
  }

  if (verdict === 'agreed') return `All ${total} criteria satisfied — approvable.`;
  if (verdict === 'refuted') return `Reject — ${no} criterion${no === 1 ? '' : 's'} failed.`;

  // disputed / inconclusive
  const parts: string[] = [];
  if (yes > 0) parts.push(`${yes}/${total} criteria satisfied`);
  if (no > 0) parts.push(`${no} failed`);
  if (unknown > 0) parts.push(`${unknown} unresolved`);
  return `Inconclusive — ${parts.join(', ')}.`;
}

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

// Every view is a stage of one research cockpit, so each non-pipeline tab
// renders in the same rail + main-column shell the pipeline uses. That keeps
// the layout from jumping when you move between tabs.
const VIEW_META: Record<Exclude<View, 'pipeline'>, { eyebrow: string; rail: string; heading: string; blurb: string }> = {
  signals: {
    eyebrow: 'Findings',
    rail: 'Contradictions, convergences and gaps the engine surfaced across your papers.',
    heading: 'Cross-paper findings',
    blurb: 'What the corpus says when papers are read against each other.',
  },
  candidates: {
    eyebrow: 'Candidates',
    rail: 'Hypotheses derived from connected claims, each with its own evidence checklist.',
    heading: 'Candidate hypotheses',
    blurb: 'Proposed research ideas, with the review that grades their evidence.',
  },
  discoveries: {
    eyebrow: 'Discoveries',
    rail: 'Questions the engine proposed and ran on its own, scored worked or no-data.',
    heading: 'Autonomous discovery',
    blurb: 'Let the engine propose its own questions and report what the data actually supports.',
  },
  verification: {
    eyebrow: 'Verification',
    rail: 'Recorded calculations on a chosen dataset, with replays and evidence bundles.',
    heading: 'Check a research idea',
    blurb: 'Choose an idea and let the research agent find data, choose the checks and explain the results.',
  },
  publish: {
    eyebrow: 'Publish',
    rail: 'Reports, their evidence and your sharing decisions. Nothing is posted online.',
    heading: 'Review and publish',
    blurb: 'Your reports, evidence and sharing decisions.',
  },
  corpus: {
    eyebrow: 'Corpus',
    rail: 'Papers ingested into this lab and the grounded claims extracted from them.',
    heading: 'Paper corpus',
    blurb: 'Add papers and the engine extracts grounded, entity-tagged claims.',
  },
  relations: {
    eyebrow: 'Claim graph',
    rail: 'How extracted claims connect across papers, and on what basis.',
    heading: 'Claim graph',
    blurb: 'Every recorded connection between claims, with the shared evidence behind it.',
  },
};

const ScientificResearchLab = () => {
  const [view, setView] = useState<View>('pipeline');
  const [pipelineRunId, setPipelineRunId] = useState<string>();
  const rebuildReport = async (candidateId: string) => {
    try {
      const response = await fetch(`${RESEARCH_API}/verify`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mode:'agent', candidateId, autoPrepare:true})});
      if (!response.ok) throw new Error(await response.text());
      const run = await response.json(); setPipelineRunId(run.id); setView('pipeline');
    } catch (e) { setError(String(e)); }
  };
  const [papers, setPapers] = useState<Paper[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [relations, setRelations] = useState<ClaimRelation[]>([]);
  const [signals, setSignals] = useState<ResearchSignal[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [abstract, setAbstract] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Nested collapse for the related-papers list inside a candidate's checklist.
  const [showPapers, setShowPapers] = useState<Record<string, boolean>>({});

  const toggleExpanded = (id: string) => setExpanded((cur) => ({ ...cur, [id]: !cur[id] }));
  const togglePapers = (id: string) => setShowPapers((cur) => ({ ...cur, [id]: !cur[id] }));

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, c, r, s, cands] = await Promise.all([
        fetch(`${RESEARCH_API}/papers`).then((res) => res.json()),
        fetch(`${RESEARCH_API}/claims`).then((res) => res.json()),
        fetch(`${RESEARCH_API}/relations`).then((res) => res.json()),
        fetch(`${RESEARCH_API}/signals`).then((res) => res.json()),
        fetch(`${RESEARCH_API}/candidates`).then((res) => res.json()),
      ]);
      setPapers(Array.isArray(p) ? p : []);
      setClaims(Array.isArray(c) ? c : []);
      setRelations(Array.isArray(r) ? r : []);
      setSignals(Array.isArray(s) ? s : []);
      setCandidates(Array.isArray(cands) ? cands : []);
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

  const transitionCandidate = async (id: string, action: 'approve' | 'reject') => {
    try {
      await fetch(`${RESEARCH_API}/candidates/${id}/${action}?by=operator`, { method: 'POST' });
      await reload();
    } catch {
      setError('Could not update the candidate.');
    }
  };

  const nav = (items: { id: View; label: string; count: string }[]) => (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={view === item.id}
          onClick={() => setView(item.id)}
          className="hud-tab"
        >
          {item.label}
          {item.count && <span className="hud-tab-count">{item.count}</span>}
        </button>
      ))}
    </div>
  );

  const emptyState = (message: string) => (
    <div className="rounded border border-dashed border-[var(--hud-line)] px-5 py-8 text-center text-sm text-[var(--forensic-text-muted)]">
      {message}
    </div>
  );

  const renderSignals = () => {
    if (signals.length === 0) {
      return emptyState('No cross-paper findings yet. Add a couple of papers to surface contradictions and convergences.');
    }
    return (
      <div className="flex flex-col gap-3">
        {signals.map((signal) => {
          const meta = SIGNAL_META[signal.kind] || SIGNAL_META.hypothesis;
          const Icon = meta.icon;
          return (
            <div key={signal.id} className="hud-panel hud-panel--action p-4">
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
    <div className="flex flex-col gap-3">
      <div className="hud-panel p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--forensic-text)]">
          <Plus size={16} className="text-[var(--forensic-accent)]" aria-hidden />
          Add papers
        </div>
        <p className="mt-1 text-xs text-[var(--forensic-text-muted)]">Paste a title + abstract (or full text) and the engine will extract grounded, entity-tagged claims.</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="hud-field mt-3"
        />
        <textarea
          value={abstract}
          onChange={(e) => setAbstract(e.target.value)}
          placeholder="Abstract / full text"
          rows={4}
          className="hud-field mt-2 resize-none"
        />
        <button
          type="button"
          onClick={submitIngest}
          disabled={adding || !title.trim() || !abstract.trim()}
          className="hud-button hud-button--primary mt-3"
        >
          {adding ? 'Ingesting…' : 'Ingest & analyze'}
        </button>
      </div>

      {papers.length === 0 ? (
        emptyState('No papers yet — add one above to seed the corpus.')
      ) : (
        papers.map((paper) => (
          <div key={paper.id} className="hud-panel p-4">
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
      <div className="flex flex-col gap-2">
        {relations.map((relation) => {
          const source = claimById[relation.sourceClaimID];
          const target = claimById[relation.targetClaimID];
          const basis = relation.basis?.map((key) => key.split('|').pop()).filter(Boolean).join(', ') || '';
          return (
            <div key={relation.id} className="hud-panel hud-panel--action p-4">
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

  const renderCandidates = () => {
    if (candidates.length === 0) {
      return emptyState('No candidates yet. Ingest papers that share entities to surface reviewable hypotheses.');
    }
    return (
      <div className="flex flex-col gap-3">
        {candidates.map((candidate) => {
          const verdict = VERDICT_META[candidate.verdict || 'disputed'] || VERDICT_META.disputed;
          const checklist = candidate.checklist || [];
          const confirmed = checklist.filter((item) => item.answer === 'yes').length;
          const title = candidate.hypothesis;
          const noveltyPct = candidate.noveltyScore !== undefined ? Math.round(candidate.noveltyScore * 100) : null;
          const noveltyTone = candidate.noveltyScore === undefined
            ? ''
            : candidate.noveltyScore >= 0.6
              ? 'border-[#90f3da]/55 bg-[#90f3da]/12 text-[#90f3da]'
              : candidate.noveltyScore >= 0.4
                ? 'border-[#f6c879]/55 bg-[#f6c879]/12 text-[#f6c879]'
                : 'border-[#ff8c86]/55 bg-[#ff8c86]/12 text-[#ff8c86]';
          const noveltyLabel = candidate.noveltyScore === undefined
            ? ''
            : candidate.noveltyScore >= 0.6
              ? 'novel'
              : candidate.noveltyScore >= 0.4
                ? 'partially covered'
                : 'already studied';
          return (
            <div key={candidate.id} className="hud-panel hud-panel--action p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${verdict.tone}`}>{verdict.label}</span>
                <span className="rounded-md border border-[var(--forensic-border-soft)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--forensic-text-muted)]">{STATE_LABEL[candidate.state] || candidate.state}</span>
                {noveltyPct !== null && (
                  <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${noveltyTone}`}>
                    <span aria-hidden>◎</span>
                    novelty {noveltyPct}% · {noveltyLabel}
                  </span>
                )}
              </div>

              {candidate.state === 'approved' && (
                <p className="mt-1 text-[11px] text-[#90f3da]">
                  Approved{candidate.approvedBy ? ` by ${candidate.approvedBy}` : ''}
                  {candidate.verdict !== 'agreed'
                    ? ` (operator override — ${checklist.filter((item) => item.answer !== 'yes').length} checklist item(s) unresolved)`
                    : ''}
                </p>
              )}

              <p className={`mt-2 text-sm font-semibold text-[var(--forensic-text)] ${expanded[candidate.id] ? '' : 'line-clamp-3'}`}>{title}</p>
              {candidate.evidenceGrade && <p className="mt-1 text-xs text-[var(--forensic-text-muted)]">{candidate.evidenceGrade} evidence</p>}
              {(candidate.summary || checklist.length > 0) && (
                <p className={`mt-2 text-xs font-semibold ${VERDICT_RECOMMENDATION[candidate.verdict || 'disputed']?.tone ?? ''}`}>
                  {candidate.summary || verdictStatus(candidate)}
                </p>
              )}
              {candidate.rationale && (
                <div className="hud-inset mt-2 px-3 py-2">
                  <p className="text-xs italic leading-relaxed text-[var(--forensic-text-muted)]">{candidate.rationale}</p>
                </div>
              )}
              {candidate.expansion && candidate.expansion.retrieved && candidate.expansion.retrieved.length > 0 && (
                <p className="mt-1 text-[11px] text-[var(--forensic-accent)]">
                  expanded with {candidate.expansion.retrieved.length} related paper(s)
                </p>
              )}

              {expanded[candidate.id] && (
                <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 border-t border-[var(--forensic-border-soft)] pt-3 lg:grid-cols-2">
                  {checklist.map((item) => (
                    <div key={item.id} className="flex items-start gap-2 text-xs">
                      <span className={`mt-0.5 w-16 shrink-0 rounded border px-1.5 py-0.5 text-center text-[10px] font-bold uppercase ${
                        item.answer === 'yes'
                          ? 'border-[#90f3da]/45 bg-[#90f3da]/10 text-[#90f3da]'
                          : item.answer === 'no'
                            ? 'border-[#ff8c86]/45 bg-[#ff8c86]/10 text-[#ff8c86]'
                            : 'border-[#f6c879]/45 bg-[#f6c879]/10 text-[#f6c879]'
                      }`}>{item.answer}</span>
                      <span className="leading-relaxed text-[var(--forensic-text-muted)]">
                        {item.question}
                        {item.reason && <span className="mt-0.5 block text-[11px] text-[var(--forensic-text-faint)]">— {item.reason}</span>}
                      </span>
                    </div>
                  ))}
                  {candidate.nearestWork && (
                    <p className="text-[11px] italic text-[var(--forensic-text-faint)]">nearest existing work: {candidate.nearestWork}</p>
                  )}
                  {candidate.expansion && candidate.expansion.retrieved && candidate.expansion.retrieved.length > 0 && (
                    <div className="col-span-full border-t border-[var(--forensic-border-soft)] pt-2">
                      <button
                        type="button"
                        onClick={() => togglePapers(candidate.id)}
                        aria-expanded={Boolean(showPapers[candidate.id])}
                        className="flex w-full items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--forensic-accent)] hover:underline"
                      >
                        <span>related papers fetched ({candidate.expansion.retrieved.length})</span>
                        <span className="shrink-0">{showPapers[candidate.id] ? 'Hide' : 'Show'}</span>
                      </button>
                      {showPapers[candidate.id] && (
                        <ul className="mt-2 space-y-1.5">
                          {candidate.expansion.retrieved.map((paper) => (
                            <li key={paper.id} className="flex items-baseline gap-1.5 text-[11px] text-[var(--forensic-text-muted)]">
                              {paper.sourceURL ? (
                                <a href={paper.sourceURL} target="_blank" rel="noreferrer" className="hover:underline">{paper.title || paper.id}</a>
                              ) : (
                                <span>{paper.title || paper.id}</span>
                              )}
                              {paper.sourceURL && <span className="text-[var(--forensic-text-faint)]">· {paper.sourceURL}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px] text-[var(--forensic-text-faint)]">
                  <span>checklist {confirmed}/{checklist.length}</span>
                  {(candidate.paperIDs || []).map((id) => (
                    <span key={id} className="rounded border border-[var(--forensic-border-soft)] bg-[var(--forensic-glow)] px-1.5 py-0.5 text-[var(--forensic-accent)]">{id}</span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {checklist.length > 0 && (
                    <button type="button" onClick={() => toggleExpanded(candidate.id)} className="text-[11px] font-semibold uppercase tracking-wider text-[var(--forensic-accent)] hover:underline">
                      {expanded[candidate.id] ? 'Hide checklist' : 'Show checklist'}
                    </button>
                  )}
                  {candidate.state !== 'approved' && (
                    <button type="button" onClick={() => transitionCandidate(candidate.id, 'approve')} className="hud-button text-[#90f3da]">Approve</button>
                  )}
                  {candidate.state !== 'rejected' && (
                    <button type="button" onClick={() => transitionCandidate(candidate.id, 'reject')} className="hud-button hud-button--danger text-[#ff8c86]">Reject</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // The rail tracks the same five stages the pipeline walks, derived from the
  // lab's own data so it stays truthful on every tab.
  const currentCandidate = candidates[0];
  const reviewed = candidates.filter((c) => ['reviewed', 'tested', 'supported', 'refuted'].includes(c.state)).length;
  const approved = candidates.filter((c) => c.state === 'approved').length;
  const journey: { title: string; note: string; done: boolean; target: View }[] = [
    { title: 'Set the topic', note: currentCandidate ? 'A focused research idea' : 'Choose a research idea', done: !!currentCandidate, target: 'pipeline' },
    { title: 'Source papers', note: `${papers.length} paper${papers.length === 1 ? '' : 's'} in the corpus`, done: papers.length > 0, target: 'corpus' },
    { title: 'Connect the evidence', note: `${relations.length} connection${relations.length === 1 ? '' : 's'} recorded`, done: relations.length > 0, target: 'relations' },
    { title: 'Challenge & check', note: reviewed ? `${reviewed} candidate${reviewed === 1 ? '' : 's'} reviewed` : 'Calculations and source review', done: reviewed > 0, target: 'verification' },
    { title: 'Your decision', note: approved ? 'Sharing decision recorded' : 'Review and decide on sharing', done: approved > 0, target: 'publish' },
  ];
  const stage = Math.max(0, journey.findIndex((step) => !step.done));
  const meta = view === 'pipeline' ? undefined : VIEW_META[view];

  const rail = meta && (
    <aside className="research-journey" aria-label="Research context">
      <p className="research-eyebrow">{meta.eyebrow}</p>
      <div className="research-topic"><Microscope size={23} /><span>{meta.rail}</span></div>
      <ol aria-label="Research journey" className="research-steps">
        {journey.map((step, i) => (
          <li key={step.title} className={`${i === stage ? 'is-current' : ''} ${step.done ? 'is-complete' : ''}`} aria-current={i === stage ? 'step' : undefined}>
            <button onClick={() => setView(step.target)}>
              <span className="research-step-number">{step.done ? <Check size={17} /> : i + 1}</span>
              <span><strong>{step.title}</strong><small>{step.note}</small></span>
            </button>
          </li>
        ))}
      </ol>
      <button className="research-new" onClick={() => setView('pipeline')}><Plus size={17} />New research run</button>
    </aside>
  );

  return (
    <div className="research-lab research-lab-pipeline h-full overflow-y-auto text-[var(--forensic-text)]">
      <div className="research-lab-inner">
        <div className="research-lab-title flex items-center gap-2">
          <Microscope size={18} className="text-[var(--forensic-accent)]" aria-hidden />
          <h1 className="text-lg font-black tracking-tight text-[var(--forensic-text)]">Scientific Research</h1>
        </div>
        <p className="mt-1 text-xs text-[var(--forensic-text-faint)]">Cross-paper evidence engine — contradictions, convergences, and grounded claims.</p>

        <div className="research-tabs flex flex-wrap gap-2">
          {nav([
            { id: 'signals', label: 'Findings', count: `${signals.length}` },
            { id: 'candidates', label: 'Candidates', count: `${candidates.length}` },
            { id: 'pipeline', label: 'Pipeline', count: '' },
            { id: 'discoveries', label: 'Discoveries', count: '' },
            { id: 'verification', label: 'Verification', count: '' },
            { id: 'publish', label: 'Publish', count: '' },
            { id: 'corpus', label: 'Corpus', count: `${papers.length}` },
            { id: 'relations', label: 'Claim graph', count: `${relations.length}` },
          ])}
        </div>

        {error && <div className="mx-6 mt-3 rounded border border-[#ff8c86]/40 bg-[#ff8c86]/10 px-3 py-2 text-xs text-[#ffb0ab]">{error}</div>}

        {loading ? (
          <p className="px-6 py-6 text-sm text-[var(--forensic-text-muted)]">Loading corpus…</p>
        ) : view === 'pipeline' ? (
          <ResearchPipeline candidates={candidates} initialRunId={pipelineRunId} onNavigate={next => { setView(next); void reload(); }} />
        ) : (
          <div className="research-workspace">
            {rail}
            <main className="research-workspace-main">
              {meta && (
                <header className="research-page-heading">
                  <h2>{meta.heading}</h2>
                  <p>{meta.blurb}</p>
                </header>
              )}
              {view === 'signals' && renderSignals()}
              {view === 'candidates' && renderCandidates()}
              {view === 'discoveries' && <ResearchDiscoveries />}
              {view === 'verification' && <ResearchVerificationConsole candidates={candidates} />}
              {view === 'publish' && <ResearchPublicationConsole onRebuild={id => void rebuildReport(id)} />}
              {view === 'corpus' && renderCorpus()}
              {view === 'relations' && renderRelations()}
            </main>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScientificResearchLab;
