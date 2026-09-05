# Built-in research verification (Phase 3)

Open **Research → Verification**, import a CSV with a name and provenance, select
an existing candidate, and run a tool manually or let the research model choose.
The calculations are compiled into Gorantula. Docker, Python, package installation,
and generated-code execution are not involved.

## Tools and limits

- `stats-reanalysis`: two independent groups, at least two observations per group.
  Reports group means and signed difference (second alphabetically sorted group
  minus first). It tests the absolute mean difference with 1,999 seeded shuffles
  of pooled observations, using `(extreme + 1) / 2000`. This is a Monte Carlo test,
  including for small datasets, not an exact enumeration. Labels must be
  exchangeable under the null of identical distributions. No paired-data,
  clustering, causal, equivalence, confidence-interval, or multiple-testing claims.
- `figure-reproduce`: deterministic SVG bars of arithmetic group means and sample
  counts, up to 12 groups. It does not compare against a published figure, invent
  error bars, or generate imagery with an LLM. Original labels and numbers remain
  in the result even when long display labels are shortened.
- CSV limits: 1 MiB, 2,000 rows, 32 unique named columns, 4,096 bytes per cell.
  Calculated values must be finite and within ±1e12. Missing numeric values fail
  explicitly; they are not silently dropped. Original files are not modified.
- Two active runs per service, two-minute deadlines, up to three calculations and eight dataset calls.
  The LLM uses the existing provider-neutral `GenerateJSON` action protocol and
  receives actual results between turns, with at most twelve model turns. Duplicate
  calculations stop. Unknown tools and extra arguments fail closed.
- Agent mode sends candidate/claim context, dataset metadata, up to five sample
  rows, and summaries/results to the configured search provider. Manual mode and
  replay need no model. Context/response sizes and turn count are bounded; provider
  retries may incur additional usage, which is captured by the existing tracker.

For the null hypothesis, Monte Carlo plus-one correction, and numerical comparison
considerations, see the [SciPy permutation-test reference](https://docs.scipy.org/doc/scipy-1.15.3/reference/generated/scipy.stats.permutation_test.html).
Our two-sided convention counts absolute differences; it is not SciPy's default
twice-the-smaller-tail convention. Seeded results are tested against a known
six-partition example, and replay must match output digests.

## Evidence and replay

Datasets and runs are stored under `research_corpus/verification/`. A run snapshots
the candidate, claims, CSV, provenance, calls, computed results, assumptions, tool
source digest, native runtime version/platform, and token usage where applicable.
Model interpretation is a separate field. Calculations leave the broader hypothesis
verdict inconclusive and never alter candidate approval or review state.

Use **Download evidence bundle** to save the complete JSON, or **Replay without a
model** to rerun in the app. To replay an exported bundle without a running server:

```powershell
go run ./cmd/research-replay --bundle path/to/verification.json
```

The command prints results and `matches`; a mismatch or incompatible tool/runtime
exits unsuccessfully. Keep the original binary/source/runtime for exact replay.
Bundles retain their original CSV even if the active corpus later changes.
The digest detects changes; it is not a signature authenticating the source.

Completed, failed, cancelled, and interrupted runs remain in history. A process
restart marks abandoned active runs interrupted rather than silently completing
them. A tool failure is inconclusive, never empirical refutation. A model can
finish without running a tool if the data do not address the candidate.

## API

- `GET/POST /api/research/datasets`: list metadata or register `{name,source,csv}`.
- `POST /api/research/verify`: `{mode,candidateId,datasetId,calls?}`. Manual calls
  contain `{tool,groupColumn,valueColumn,statement,rationale}`. Agent mode chooses
  calls itself. Replay accepts `{mode:"replay",replayOf:runId}`.
- `GET /api/research/runs`: run summaries.
- `GET /api/research/runs/{id}`: full snapshot and results.
- `GET /api/research/runs/{id}/bundle`: downloadable JSON.
- `POST /api/research/runs/{id}/cancel` with `{}`: request cancellation.

Mutations require JSON, reject unknown fields and cross-site browser origins, and
accept dataset/run IDs rather than filesystem paths. WebSocket events use
`RESEARCH_VERIFICATION_RESULT`; the console polls so it also recovers after refresh.

These tools are intentionally bounded Phase 3 implementations. Additional statistical
methods, published-figure comparison, and publishing are later
work; arbitrary model-generated programs are not exposed through this runner.


## CSV tools for the agent

Agent mode can start without a dataset. `dataset-discover` follows a candidate's
paper source or a supplementary link actually observed on that page;
`dataset-import` retrieves CSV from those URLs. This is bounded link discovery,
not a general search engine: paywalls, ZIP files, and pages larger
than 1 MiB are not supported. The agent must report unavailable data.

`dataset-inspect` returns numeric/text/missing counts, finite numeric ranges and
five sample rows. Blank, NA, N/A and null count as missing. Units and whether data
are measured, extracted or synthetic must be checked against source provenance;
the tool does not infer them or fabricate replacements.

`dataset-filter` keeps rows using exact text eq/ne, finite numeric gt/gte/lt/lte,
or not-missing. It requires a rationale, records the parent ID/digest and exact
filter, and preserves the original snapshot. Numeric comparisons omit nonnumeric
cells; no values are imputed. Every dataset action is saved in the evidence bundle,
including errors and parent CSV snapshots. Filtering for a desired result is
prohibited in the agent instructions. After the first successful calculation, import/filter is blocked. Failed attempts
can be corrected within the existing call budget. Every attempt records its input
digest; replay selects that immutable snapshot from the final dataset or retained
parents and never refetches sources. A successful retry of the same calculation
resolves its earlier failure; unrelated failed calculations remain failures.

The console supports public CSV URL import and an inspection table. Additional API:
- `POST /api/research/datasets/import-url`: `{name,url}`.
- `GET /api/research/datasets/{id}/inspect`: column counts, ranges and sample.

Network imports use bounded HTTP(S) requests with checked public IP connections,
redirect checks, no ambient proxy, and no credentials. Local files are imported
through the existing CSV form. All parsing, filtering and calculations run in Go;
no Docker or separate Python runtime is required.


## Extended research tools

- **dataset-validate**: exact duplicate rows, repeated/missing observation IDs,
  missing and mixed numeric/text cells, and declared/header unit conflicts.
  These are diagnostics, not automatic deletions or proof of study design.
- **dataset-join**: inner or left joins using unique, nonmissing, exact text keys.
  Reports matched/unmatched counts, renames colliding columns, retains both
  parent snapshots and digests. Declared/header unit conflicts are refused;
  unspecified units require review. No automatic conversion or many-to-many join.
- **evidence-lookup**: literal case-sensitive search in up to five frozen candidate
  papers (first 200,000 UTF-8 bytes of full text each, or abstract). Results have
  exact text, byte offsets, paper IDs and source-text digests. No match is reported
  as a gap, never replaced with model-generated evidence.
- **paper-extract**: fetch an observed candidate/supplement PDF up to 1 MiB and
  extract one requested page. Retains original PDF bytes/digest in evidence.
  Finds simple aligned table candidates from positioned text. For scans and more involved layouts use paper-scan or paper-complex-table below. Verify cells against the page.
- **paper-table**: save a previously extracted table with a rationale; first row
  becomes headers. Marked extracted/unverified, never assumed measured data.
- **stats-paired**: numeric X/before and Y/after in the same row, at least four
  independent pairs. Mean difference Y-X, sign-flip permutation p under symmetric
  null differences, and 95% paired percentile-bootstrap interval.
- **stats-correlation**: Pearson r, two-sided permutation p under independence,
  paired-row percentile-bootstrap interval; at least four independent complete rows.
- **stats-regression**: simple OLS of Y on X with intercept, slope, R-squared,
  slope percentile-bootstrap interval and permutation p under exchangeability.
  Constant columns are rejected for inference. No multivariable or causal model.
- **stats-effects**: two independent groups, at least four observations each;
  signed mean difference, its bootstrap interval and pooled sample-SD Cohen's d.
  The interval is for mean difference, not d. No small-sample correction to d.

Bootstrap uses 1,999 seeded resamples and linearly interpolated 2.5/97.5 percentiles.
Pairs are resampled together; independent groups separately. Invalid degenerate
resamples are reported; fewer than 1,800 valid resamples fail. Small-sample interval
coverage may be poor. See the [SciPy bootstrap reference](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html)
for percentile resampling and the [NIST least-squares reference](https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd431.htm)
for the regression method. These references do not imply use of SciPy at runtime.

The **Research data tools** workbench exposes validation, joins, passage lookup,
link discovery and page/table extraction. Preparation snapshots are immutable:
`POST /api/research/datasets/tools` takes `{candidateId,datasetId,sessionId?,call}`
and returns a new session ID, result and selected dataset. Download retained inputs
at `GET /api/research/datasets/preparations/{id}`. Up to 20 actions per preparation.
Agent runs keep the existing eight preparation/three calculation budgets and a
64,000-byte model evidence bound. Numerical replay includes both numerical source
files in its implementation digest and uses frozen inputs without fetching data.

Known-answer tests cover PDF cells -> CSV -> difference 8, exact source snippets,
join population counts/conflicts, paired differences, r=1, OLS slope=2/intercept=3,
Cohen's d, deterministic resampling, and the agent validation -> calculation ->
offline replay path using a scripted provider.


## Scanned PDFs and complex tables

**paper-scan** renders PDF pages and runs the Windows OCR engine locally. Windows
10/11 and an installed OCR language are required (this machine has English en-GB).
The fixed adapter is embedded in the Go application, uses system PowerShell and
Windows PDF/imaging/OCR APIs, and launches without a console window. It does not
use Docker, Python, a cloud OCR API or model-generated commands. See Microsoft's
[PDF rendering API](https://learn.microsoft.com/en-us/uwp/api/windows.data.pdf.pdfpage.rendertostreamasync)
and [OCR sample](https://github.com/Microsoft/Windows-universal-samples/blob/main/Samples/OCR/cs/OcrFileImage.xaml.cs).

**paper-complex-table** preserves native PDF glyphs when available and falls back
to rendered OCR for image-only/rotated pages. It accepts:

- `page`, `endPage`: 1-based range, maximum three consecutive pages.
- `rotation`: 0, 90, 180 or 270 degrees clockwise.
- `region`: optional `[left,top,width,height]` in percentages of the rotated page.
- `columnCuts`: optional increasing column boundary percentages from the page left.
  Without these, repeated wide gaps suggest boundaries; ambiguous alignment fails.
- `headerRows`: 1-4, default 1. Stacked headers are combined and headers crossing
  column boundaries retain span information.
- `joinWrappedRows`: opt-in joining of first-column-only continuation lines within
  a page. Review that these are wrapped labels, not separate observations.

Matching repeated headers are removed when joining pages. Different headers fail
instead of silently combining unlike tables. Blank body cells stay blank; values
crossing column boundaries stay in their starting cell with a warning. This is a
reviewable layout reader, not a guarantee for every publication's table format.
OCR may omit characters or confuse decimal points/symbols, particularly in poor
scans. Windows OCR has no word-confidence score; the app never invents one.

Results retain word boxes (page percentages), source pages, cell references,
extraction settings, engine/version, an extraction digest and original PDF bytes.
Saving a complex table requires its returned `extractionId`, preventing a later
extraction of the same page from silently replacing the selected result. The model
receives short excerpts; full geometry stays in downloadable preparation/run bundles.

PDF inputs are limited to 10 MiB for these tools. Rendering has a 2,400-pixel
long-edge cap, 75-second deadline and bounded output. Native PDFs avoid OCR errors;
OCR results are retained for review rather than promised identical across OS updates.
Numerical replay still uses the frozen extracted CSV and requires no OCR rerun.

The workbench includes local upload: `POST /api/research/datasets/pdf-files` with
`{name,data}` (base64 PDF bytes) returns a `local-pdf:<digest>` URL. This refers to an
immutable stored document, never an arbitrary filesystem path. Uploaded documents
are discoverable by the agent by name; it must check relevance before using them.

Run real OCR checks on Windows with:

```powershell
$env:GORANTULA_OCR_TEST='1'
go test ./internal/research
```

Tests cover an actual image-only PDF (12.50, 42.75 and 55.25), native text fidelity,
stacked/merged headers, multi-page header matching, layout bounds, extraction-ID
binding and unchanged source/cell provenance. Ordinary cross-platform tests skip
only the native Windows OCR integration checks.


## Opt-in live-model checks

`GORANTULA_LIVE_QA=1 go test ./internal/research -run TestLiveResearchQA -v`
uses the configured provider and makes billable model calls on isolated synthetic
fixtures. It is skipped by default. Evidence bundles are written under
`local-test-docs/phase3/live-llm/<timestamp>/`; the real corpus is untouched.

The 5 September 2026 live run passed numeric correlation/regression, paired
validation, independent-group statistics/effects/figure, join/filter/figure and
scanned-PDF/table/filter/figure scenarios. Numerical replay matched every final
bundle. Initial failures led to explicit action envelopes, remaining-budget
metadata, local-paper metadata and callable table-save references. These checks
are directed tool-use scenarios, not proof of reliable open-ended research.


### Agent study-design gate and descriptive alternatives

Agent-requested inference now requires a structured `design` on the calculation:
`paperId`, a verbatim retrieved `quote`, sampling `unit`, `structure` (independent
or paired), `independence` (documented), source-based `basis`, and `limitations`.
The gate checks quote membership in evidence-lookup results and method/structure
compatibility. It does not certify that the quotation semantically proves the
assumptions. Human scientific review remains necessary. Manual tool calls retain
their existing explicit-method behavior; the new gate applies to agent decisions.

Every stats tool accepts `descriptive:true` to compute sample estimates without
bootstrap intervals or permutation p-values. figure-reproduce remains descriptive.
A rejected inference returns an exact descriptive retry action, records the rejection,
and uses a dataset/turn budget slot without consuming a calculation. Quotes must
come from an actual lookup; fabricated, absent or wrong-source quotes are rejected.

Model context separates results on the current input digest from earlier-input
results. One bounded completion check offers recovery if a run tries to stop with
only failed calculations and budget remains. It never changes data automatically.
Successful retries preserve earlier failures and each original input for replay.

The opt-in TestLiveFiveTrials now checks actual expected numerical outputs and
absence of unsupported inference, not only runtime completion. Historical attempts
remain under local-test-docs/phase3/five-trials/runs. Tool implementation changes
require the original binary/runtime to replay older implementation bundles exactly.


### Structured source facts and separate critique

The inference gate additionally requires seven `design.facts` entries, each with
`name`, `value`, `paperId`, and `quote`: measurement, rowUnit, repeated, pairing,
clustering, assignment, and independence. Every fact must be supported by both
retrieved evidence and the frozen source. Unknown facts block inference. Code
checks paired/independent compatibility, refuses clustered methods not implemented,
and checks a declared sampling-unit ID column for missing/repeated IDs. Obvious
row-number columns cannot establish units. Unique IDs never establish independence.

After deterministic checks, a separate provider call critiques the complete frozen
sources and the planner's facts. It must review all seven facts and report no
contradictions before an inferential call can proceed. The critic is a separate
prompt to the configured provider, not an independent human or different model.
It is fallible; this is layered error reduction, not certification.

Each critique has a 25-second timeout and 64 KB source-context limit, within the
existing overall run timeout; at most three critiques run per verification. Errors,
oversized context, missing review fields or rejection fail closed to descriptive
alternatives. `studyReviews` retains the exact call, input digest, review decision,
reason and contradictions in the run bundle and is copied for replay provenance.
Offline numerical replay does not call the reviewer again. Descriptive and manual
calculation behavior is unchanged. The additional model call incurs provider usage
only when an agent requests inference and the deterministic checks pass.

`GORANTULA_DESIGN_QA=1 go test ./internal/research -run '^TestLiveDesignCritique$'`
(PowerShell: set the environment variable separately) tests synthetic documented
sampling, a misleading true quote, and contradictory methods text. It is not an
empirical paper benchmark. Ordinary tests cover structural rejection and review
acceptance requirements without network calls.
