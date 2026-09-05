# Phase 4: approval and local publication export

The Publish view prepares a candidate paper from a finished verification. It uses
an extractive writer: structured Abstract, Background, Method, Findings,
Contradictions & Open Objections, Limitations, Next Steps and References sections
contain labelled hypotheses, claim IDs, relation IDs and literal result artifacts.
It does not use a model to invent new scientific narrative. Evidence status stays
inconclusive; publication approval is a separate operator decision.

## Workflow

1. Select a finished run and prepare a candidate paper. Preparation verifies exact
   numerical replay and refuses a changed candidate statement or changed claims.
2. Preparation automatically renders and attaches local PNG figures from recorded
   values. Group means use a zero baseline; other metrics use a table. Advanced
   controls retain figure specs and optional replacement PNGs (10 MiB / 25 megapixels).
3. Read the result summary and choose whether to share it with its uncertainties.
   The full paper, sources, figure overrides and audit remain expandable. Enter a
   reviewer name; sharing notes have an editable default. Approve that revision. Names are local audit labels, not an
   authenticated identity or scientific certification.
4. Export the approved revision to a new local folder. This does not execute Git,
   publish externally, or change the candidate's scientific/review state.

Corpus changes conservatively mark older approvals stale. Rejection requires a
new draft before approval. Withdrawal records a decision and preserves prior
exports; it does not erase any copies already shared. Repeated approval/export
requests are rejected. Every content revision is retained under
`research_corpus/publications/revisions/`, with the current decision audit on the
publication record. Attachments cannot change approved/exported content.

## API

All routes use the local-origin / JSON protections of the verification API:
- GET /api/research/publications
- POST /api/research/publications with `{runId}`
- GET /api/research/publications/{id}
- POST /api/research/publications/{id}/{approve|reject|withdraw|export|figure}
  with `{revision,operator,reason}`; figure also needs `{figureId,data}` where
  data is base64 PNG. No request can set scientific evidence status or supply
  approval inside a draft-creation request.

## Export

Local exports land beneath the configured corpus root at
`research-output/{publication-id}-{revision-prefix}/`. With the default corpus,
this is `research_corpus/research-output/`. Copy the chosen folder into the
operator's publication repository after review; it contains:

- paper.md and generated figures
- figure-specs.json
- evidence.json (offline numerical replay bundle)
- claims.json and claim-relations.json
- publication.json and approval-audit.json
- REPRODUCE.md, commit-message.txt and SHA-256 manifest.json

The complete original PDFs and full paper texts are excluded from exports;
datasets, source metadata and quoted evidence remain and must be reviewed for
sharing permissions. No new packages or environment variables are required.
The numerical replay still needs its original implementation and runtime.
The output folder is staged and renamed into place so a partial write is not
mistaken for a complete package. Existing export folders are not overwritten.
If a process/storage failure occurs after directory creation but before the audit
record is saved, retain and inspect that folder; do not assume it was published.

This first Phase 4 slice does not automatically push a publication repo, generate
AI images, write unsupported scientific prose, or retract external copies. The
operator handles those external actions. Backend tests cover approval, stale
revisions/evidence, missing figures, invalid PNG, rejection, withdrawal, export
integrity and offline replay. UI tests and browser smoke cover the guarded flow.


## Continuous research pipeline

The default Pipeline screen starts `/verify` with `mode: agent` and
`autoPrepare: true`. The agent selects relevant stored data using `dataset-use`
or uses the existing discovery/import tools. `pipelineStage` advances from
`checking` to `preparing` and then `review`, with `publicationId` linking the
unapproved draft. Failures without usable results and interrupted preparation use
`needs_attention` with an explanation. Browser navigation does not own execution.
Preparation is bounded by the remaining run timeout and 30 seconds maximum.

Approval remains explicit. Clicking an incomplete approval highlights the name,
consent, notes or affected report section and moves focus; it makes no approval
request until the prerequisites pass. Older affected drafts can start a fresh
agent pipeline through the rebuild action. No automatic export or Git action.

## Topic pipeline

Send `POST /api/research/verify` with `{"mode":"agent","topic":"your research question","autoPrepare":true}`. A persisted, cancellable run searches OpenAlex for up to five papers, uses available abstracts to extract grounded claims, computes claim connections, asks the model for a bounded proposal citing real claim IDs, and hands the selected evidence to the verification agent. Two separate model calls review methods and overstatement before draft preparation. Sources without readable text are excluded; abstracts are not full-paper review. Search failures and invalid citations stop with an explicit error. Empty numerical evidence produces a literature-only report with no fabricated chart when both reviewers finish. Existing candidate verification remains available separately.

Progress uses saved `searching`, `connecting`, `proposing`, `checking`, `reviewing`, `preparing`, and `review` stages with `completedStages`. Topic runs have a ten-minute limit; verification retains its fixed tool and turn budgets. No approval or export runs automatically.

## Organised PDF

Every new export includes `report.pdf` in the immutable export directory and its SHA-256 in `manifest.json`. The native Go renderer embeds fonts and saved PNG figures and never requests external resources. Sections cover summary, background and source passages, findings and figures, reviewer comments and limitations, claim connections, linked references, and methods/audit. Literature-only reports explicitly state that no numerical verification took place. Historical exports remain untouched.

`GET /api/research/publications/{id}/pdf` previews the saved revision without approving or exporting it. Stale evidence and the current sharing state remain visible. The UI exposes **Open organised PDF** before approval. Previewing is read-only. Exact data and tool calls remain in the companion JSON files.

Topic verification now performs a server-enforced data-discovery pass before the first model action when no dataset is selected: at most three candidate source URLs and two observed supplementary links, sharing the eight-call preparation budget and reserving at least three calls for model preparation. Each attempt, observed link, and access failure is persisted and supplied to both the verification agent and report reviewers. The pass never fabricates URLs or automatically selects unrelated measurements. Access failure is not evidence that data does not exist.

If the initial paper pages expose no supplementary links, a single Brave Web Search fallback uses the existing `BRAVE_API_KEY`, with up to five repository-focused results (Dryad, Zenodo, Figshare, GitHub, PMC). Its query, result URLs, and failures are recorded as `web-search`; the same safe public-URL fetcher probes a returned lead within the existing preparation budget. Search results do not become grounded paper claims or verified datasets automatically. Missing keys and rate-limit failures are visible; the investigation-board search behavior is unchanged.
