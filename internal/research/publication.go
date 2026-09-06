package research

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image/png"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Andyi955/Gorantula/models"
)

var publicationMu sync.Mutex

func publicationHash(v interface{}) string { b, _ := json.Marshal(v); return digestBytes(b) }
func (s *Service) publicationStore() *Store {
	return NewStore(filepath.Join(s.store.root, "publications"))
}

// Include the corpus revision conservatively: newly ingested evidence requires
// renewed publication review even when the older computation remains replayable.
func (s *Service) publicationSource(candidateID string) (models.CandidateHypothesis, string, error) {
	cs, e := s.ListCandidates()
	if e != nil {
		return models.CandidateHypothesis{}, "", e
	}
	var c models.CandidateHypothesis
	for _, v := range cs {
		if v.ID == candidateID {
			c = v
		}
	}
	if c.ID == "" {
		return c, "", fmt.Errorf("candidate not found")
	}
	claims, e := s.ListClaims()
	if e != nil {
		return c, "", e
	}
	papers, e := s.ListPapers()
	if e != nil {
		return c, "", e
	}
	rels, e := s.ListRelations()
	if e != nil {
		return c, "", e
	}
	return c, publicationHash([]interface{}{c, claims, papers, rels}), nil
}
func publicationRevision(d models.PublicationDraft) string {
	return publicationHash([]interface{}{d.SourceRevision, d.Markdown, d.Figures, d.Candidate, d.Claims, d.Papers, d.Relations, publicationHash(d.Run)})
}

// Preserve each content revision before advancing the current state record.
func (s *Service) savePublication(d models.PublicationDraft) error {
	revisions := NewStore(filepath.Join(s.publicationStore().root, "revisions", d.ID))
	if _, e := os.Stat(filepath.Join(revisions.root, d.Revision+".json")); os.IsNotExist(e) {
		if e = revisions.saveSlice(d.Revision+".json", d); e != nil {
			return e
		}
	} else if e != nil {
		return e
	}
	return s.publicationStore().saveSlice(d.ID+".json", d)
}
func (s *Service) loadPublication(id string) (models.PublicationDraft, error) {
	var d models.PublicationDraft
	if !verificationID.MatchString(id) {
		return d, fmt.Errorf("invalid publication ID")
	}
	e := s.publicationStore().readJSON(id+".json", &d)
	if e != nil {
		return d, e
	}
	if d.ID != id {
		return d, os.ErrNotExist
	}
	if d.Revision != publicationRevision(d) {
		return d, fmt.Errorf("publication content digest mismatch")
	}
	_, rev, e := s.publicationSource(d.CandidateID)
	d.Stale = e != nil || rev != d.SourceRevision
	// Diagnose historical snapshots without rewriting their signed content or audit.
	d.ReviewIssues = nil
	if len(claimsForCandidate(d.Claims, d.Candidate)) != len(d.Claims) {
		d.ReviewIssues = append(d.ReviewIssues, "This report contains claims not selected for this candidate. Run a new verification and prepare a new paper.")
	}
	return d, nil
}
func (s *Service) ListPublications() ([]models.PublicationDraft, error) {
	publicationMu.Lock()
	defer publicationMu.Unlock()
	ids, e := jsonIDs(s.publicationStore().root)
	if e != nil {
		return nil, e
	}
	out := []models.PublicationDraft{}
	for _, id := range ids {
		d, e := s.loadPublication(id)
		if e != nil {
			return nil, e
		}
		d.Run = models.VerificationRun{}
		d.Papers = nil
		d.Claims = nil
		d.Relations = nil
		for i := range d.Figures {
			d.Figures[i].PNG = nil
		}
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out, nil
}
func (s *Service) GetPublication(id string) (models.PublicationDraft, error) {
	publicationMu.Lock()
	defer publicationMu.Unlock()
	return s.loadPublication(id)
}

// The first writer is deliberately extractive: every scientific statement is a
// labelled source claim or literal calculation, never an invented synthesis.
func (s *Service) PreparePublication(ctx context.Context, runID string) (models.PublicationDraft, error) {
	publicationMu.Lock()
	defer publicationMu.Unlock()
	var d models.PublicationDraft
	run, e := s.loadVerificationRun(runID)
	if e != nil {
		return d, e
	}
	if run.ID == "" || run.Status == "running" || run.Status == "queued" || (len(run.Results) == 0 && !literatureReport(run)) {
		return d, fmt.Errorf("choose a finished verification with recorded results")
	}
	c, rev, e := s.publicationSource(run.Candidate.ID)
	if e != nil {
		return d, e
	}
	if publicationHash([]interface{}{c.Hypothesis, c.ClaimIDs, c.PaperIDs, c.Supporting, c.Contradicting}) != publicationHash([]interface{}{run.Candidate.Hypothesis, run.Candidate.ClaimIDs, run.Candidate.PaperIDs, run.Candidate.Supporting, run.Candidate.Contradicting}) {
		return d, fmt.Errorf("candidate statement changed; run verification on its current revision")
	}
	currentClaims, e := s.ListClaims()
	if e != nil {
		return d, e
	}
	if len(claimsForCandidate(run.Claims, run.Candidate)) != len(run.Claims) {
		return d, fmt.Errorf("verification contains claims not selected for this candidate; run a new verification before preparing a paper")
	}
	for _, old := range run.Claims {
		found := false
		for _, current := range currentClaims {
			if current.ID == old.ID && publicationHash(current) == publicationHash(old) {
				found = true
			}
		}
		if !found {
			return d, fmt.Errorf("source claim %s changed; verify its current evidence before preparing a paper", old.ID)
		}
	}
	replay, e := replayPublication(ctx, run)
	if e != nil {
		return d, e
	}
	for i, r := range replay {
		if r.OutputDigest != run.Results[i].OutputDigest {
			return d, fmt.Errorf("verification replay mismatch")
		}
	}
	token := make([]byte, 16)
	if _, e = rand.Read(token); e != nil {
		return d, e
	}
	d = models.PublicationDraft{ID: hex.EncodeToString(token), CandidateID: c.ID, RunID: run.ID, SourceRevision: rev, Status: "draft", EvidenceStatus: "inconclusive", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Candidate: c, Run: run, Claims: run.Claims, Papers: run.Papers, Figures: []models.PublicationFigure{}, Audit: []models.PublicationAudit{}}
	relations, e := s.ListRelations()
	if e != nil {
		return d, e
	}
	for _, r := range relations {
		for _, cl := range d.Claims {
			if r.SourceClaimID == cl.ID && containsClaim(d.Claims, r.TargetClaimID) {
				d.Relations = append(d.Relations, r)
				break
			}
		}
	}
	for i, r := range run.Results {
		if r.Status == "completed" && (len(r.Groups) > 0 || len(r.Metrics) > 0) {
			d.Figures = append(d.Figures, models.PublicationFigure{ID: fmt.Sprintf("fig-%03d", i+1), Title: r.Call.Statement, Kind: "data-summary", Objective: "Visualize only the recorded sample estimates; do not add uncertainty or scientific endorsement.", Data: r.Groups, Metrics: r.Metrics, Caption: r.Summary, Alt: "Recorded sample estimates for " + r.Call.Statement, Style: "Forensic cyan on dark, colorblind-safe labels; no inferred error bars", ResultDigest: r.OutputDigest})
		}
	}
	for i := range d.Figures {
		figure := &d.Figures[i]
		figure.PNG, e = publicationFigurePNG(*figure)
		if e != nil {
			return d, e
		}
		figure.ImageDigest = digestBytes(figure.PNG)
	}
	d.Markdown = writePublication(d)
	d.Revision = publicationRevision(d)
	return d, s.savePublication(d)
}
func writePublication(d models.PublicationDraft) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Candidate paper: %s\n\n## Abstract\n\nThis evidence report evaluates the hypothesis below. Evidential status: **inconclusive**. Operator approval authorizes sharing, not scientific truth.\n\n## Background\n\nHypothesis (not established): %s\n\n", d.Candidate.Hypothesis, d.Candidate.Hypothesis)
	for _, c := range d.Claims {
		fmt.Fprintf(&b, "- Extracted source claim [%s], paper [%s]: %s\n", c.ID, c.PaperID, c.Text)
	}
	fmt.Fprintf(&b, "\n## Method\n\nVerification run `%s`; execution status `%s`. Input `%s`. Tool implementation `%s`; runtime `%s`. Exact calls, preparation history, assumptions and source spans are retained in evidence.json.\n\n## Findings\n\n", d.RunID, d.Run.Status, d.Run.Dataset.Digest, d.Run.ImplementationDigest, d.Run.Runtime)
	for _, r := range d.Run.Results {
		fmt.Fprintf(&b, "- Artifact `%s` (%s; evidential verdict %s): %s\n", r.OutputDigest, r.Status, r.Verdict, r.Summary)
	}
	if d.Run.Interpretation != "" {
		fmt.Fprintf(&b, "\n## Plain-language interpretation\n\nModel commentary, not a measurement:\n\n%s\n", d.Run.Interpretation)
	}
	if len(d.Run.Results) == 0 {
		b.WriteString("\nLiterature report only. No numerical analysis or empirical verification was performed.\n")
	}
	b.WriteString("\n## Source screening\n\nModel assessments with checked source excerpts; not a guarantee of reliable data.\n\n")
	for _, a := range d.Run.PaperSearchAttempts {
		fmt.Fprintf(&b, "- Search provider %s: %d readable records; cached: %t. %s\n", a.Provider, a.Papers, a.Cached, a.Error)
	}
	for _, a := range d.Run.SourceAssessments {
		fmt.Fprintf(&b, "- [%s]: %s evidence; %s. Source excerpt: %s. Limitations: %s\n", a.PaperID, a.Relevance, a.DataKind, a.Quote, a.Limitations)
	}
	b.WriteString("\n## Agent reviews\n\n")
	for _, review := range d.Run.ReportReviews {
		fmt.Fprintf(&b, "### %s\n\n%s\n\n", review.Role, review.Summary)
		for _, c := range review.Concerns {
			fmt.Fprintf(&b, "- %s\n", c)
		}
	}
	b.WriteString("\n## Contradictions & Open Objections\n\n")
	if len(d.Relations) == 0 {
		b.WriteString("No claim relations are attached to this snapshot; absence of a recorded objection is not corroboration.\n")
	}
	for _, r := range d.Relations {
		fmt.Fprintf(&b, "- Relation [%s]: %s between [%s] and [%s].\n", r.ID, r.RelationKind, r.SourceClaimID, r.TargetClaimID)
	}
	for _, r := range d.Run.Results {
		if r.Status != "completed" {
			fmt.Fprintf(&b, "- Unsuccessful attempt retained: `%s`: %s\n", r.OutputDigest, r.Summary)
		}
	}
	b.WriteString("\n## Limitations\n\nCalculations do not establish causation, novelty or correctness of source claims. Missing design facts remain unknown. Model commentary is not a measurement.\n")
	for _, r := range d.Run.Results {
		for _, a := range r.Assumptions {
			fmt.Fprintf(&b, "- %s\n", a)
		}
	}
	b.WriteString("\n## Next Steps\n\nIndependently review the evidence, sampling assumptions and unresolved objections. Replicate with appropriate data before extending conclusions.\n\n## References\n\n")
	for _, p := range d.Papers {
		fmt.Fprintf(&b, "- [%s] %s (%d). %s. License: %s\n", p.ID, p.Title, p.Year, p.SourceURL, p.License)
	}
	b.WriteString("\n## Figures\n\n")
	for _, f := range d.Figures {
		fmt.Fprintf(&b, "![%s](figures/%s.png)\n\n%s\n\n", f.Alt, f.ID, f.Caption)
	}
	return b.String()
}

func (s *Service) PublicationAction(ctx context.Context, id, revision, action, operator, reason, figureID string, pngData []byte) (models.PublicationDraft, error) {
	publicationMu.Lock()
	defer publicationMu.Unlock()
	d, e := s.loadPublication(id)
	if e != nil {
		return d, e
	}
	if revision != d.Revision {
		return d, fmt.Errorf("paper revision changed; reload before acting")
	}
	if strings.TrimSpace(operator) == "" || len(operator) > 100 || strings.TrimSpace(reason) == "" || len(reason) > 2000 {
		return d, fmt.Errorf("operator and decision reason are required")
	}
	if (action == "approve" || action == "export") && len(d.ReviewIssues) > 0 {
		return d, fmt.Errorf("%s", d.ReviewIssues[0])
	}
	if action == "figure" {
		if d.Status != "draft" {
			return d, fmt.Errorf("figures can only change on a draft; prepare a new revision")
		}
		if len(pngData) > 10<<20 {
			return d, fmt.Errorf("PNG exceeds 10 MiB")
		}
		cfg, e := png.DecodeConfig(bytes.NewReader(pngData))
		if e != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width*cfg.Height > 25000000 {
			return d, fmt.Errorf("provide a valid PNG up to 25 megapixels")
		}
		if _, e := png.Decode(bytes.NewReader(pngData)); e != nil {
			return d, fmt.Errorf("invalid PNG")
		}
		found := false
		for i := range d.Figures {
			if d.Figures[i].ID == figureID {
				d.Figures[i].PNG = pngData
				d.Figures[i].ImageDigest = digestBytes(pngData)
				found = true
			}
		}
		if !found {
			return d, fmt.Errorf("figure slot not found")
		}
		d.Revision = publicationRevision(d)
	} else if action == "approve" {
		if d.Status != "draft" || d.Stale {
			return d, fmt.Errorf("approval requires a current draft")
		}
		for _, f := range d.Figures {
			if len(f.PNG) == 0 {
				return d, fmt.Errorf("resolve every figure before approval")
			}
		}
		for _, c := range d.Claims {
			grounded := false
			for _, p := range d.Papers {
				body := p.FullText
				if body == "" {
					body = p.Abstract
				}
				if c.ID != "" && p.ID == c.PaperID && c.SourceSnippet != "" && strings.Contains(body, c.SourceSnippet) {
					grounded = true
				}
			}
			if !grounded {
				return d, fmt.Errorf("claim %s lacks a grounded source span; verify its evidence before approval", c.ID)
			}
		}
		d.Status = "approved"
		d.ApprovedRevision = d.Revision
	} else if action == "reject" || action == "withdraw" {
		if action == "reject" && d.Status != "draft" && d.Status != "approved" {
			return d, fmt.Errorf("only pending publications can be rejected")
		}
		if action == "withdraw" && d.Status != "exported" {
			return d, fmt.Errorf("only exported publications can be withdrawn")
		}
		d.Status = map[string]string{"reject": "rejected", "withdraw": "withdrawn"}[action]
		d.ApprovedRevision = ""
	} else if action == "export" {
		if d.Status != "approved" || d.Stale || d.ApprovedRevision != d.Revision {
			return d, fmt.Errorf("export requires approval of the current paper and evidence revision")
		}
		if _, e := replayPublication(ctx, d.Run); e != nil {
			return d, e
		}
		d.Status = "exported"
	} else {
		return d, fmt.Errorf("unknown publication action")
	}
	d.Audit = append(d.Audit, models.PublicationAudit{Action: action, Operator: operator, Reason: reason, Revision: d.Revision, At: time.Now().UTC().Format(time.RFC3339Nano)})
	if action == "export" {
		d.ExportPath, e = s.exportPublication(d)
		if e != nil {
			return d, e
		}
	}
	return d, s.savePublication(d)
}

// Export is an immutable local repo-ready directory, never a Git operation.
func (s *Service) exportPublication(d models.PublicationDraft) (string, error) {
	root := filepath.Join(s.store.root, "research-output")
	if e := os.MkdirAll(root, 0700); e != nil {
		return "", e
	}
	dest := filepath.Join(root, d.ID+"-"+d.Revision[:12])
	if _, e := os.Stat(dest); e == nil {
		return "", fmt.Errorf("export already exists; inspect its manifest")
	}
	temp, e := os.MkdirTemp(root, ".preparing-")
	if e != nil {
		return "", e
	}
	// Only remove the tool-created staging directory, never an operator path.
	defer os.RemoveAll(temp)
	if e = os.Mkdir(filepath.Join(temp, "figures"), 0700); e != nil {
		return "", e
	}
	pdf, e := publicationPDF(d)
	if e != nil {
		return "", e
	}
	files := map[string][]byte{"paper.md": []byte(d.Markdown), "report.pdf": pdf}
	bundle := d.Run
	// Export metadata and quoted evidence, not complete source PDFs or paper text.
	bundle.Papers = append([]models.Paper{}, bundle.Papers...)
	for i := range bundle.Papers {
		bundle.Papers[i].FullText = ""
		bundle.Papers[i].Abstract = ""
	}
	bundle.Documents = nil
	files["evidence.json"], e = json.MarshalIndent(bundle, "", "  ")
	if e != nil {
		return "", e
	}
	specs := append([]models.PublicationFigure{}, d.Figures...)
	for i, f := range specs {
		files["figures/"+f.ID+".png"] = f.PNG
		specs[i].PNG = nil
	}
	if len(files["evidence.json"]) > 8<<20 {
		return "", fmt.Errorf("reproduction bundle exceeds replay size limit")
	}
	files["figure-specs.json"], _ = json.MarshalIndent(specs, "", "  ")
	files["approval-audit.json"], _ = json.MarshalIndent(d.Audit, "", "  ")
	files["claims.json"], _ = json.MarshalIndent(d.Claims, "", "  ")
	files["publication.json"], _ = json.MarshalIndent(map[string]interface{}{"id": d.ID, "revision": d.Revision, "sourceRevision": d.SourceRevision, "publicationStatus": d.Status, "evidenceStatus": d.EvidenceStatus, "candidate": d.Candidate}, "", "  ")
	files["claim-relations.json"], _ = json.MarshalIndent(d.Relations, "", "  ")
	files["REPRODUCE.md"] = []byte(reproductionReadme(d.Run))
	files["commit-message.txt"] = []byte("research: publish evidence report " + d.CandidateID + "\n\nPublication approval does not establish scientific support. Evidence status: inconclusive.\n")
	manifest := map[string]string{}
	for name, data := range files {
		if e = os.WriteFile(filepath.Join(temp, filepath.FromSlash(name)), data, 0600); e != nil {
			return "", e
		}
		manifest[name] = digestBytes(data)
	}
	raw, _ := json.MarshalIndent(map[string]interface{}{"publicationId": d.ID, "revision": d.Revision, "sourceRevision": d.SourceRevision, "evidenceStatus": d.EvidenceStatus, "files": manifest}, "", "  ")
	if e = os.WriteFile(filepath.Join(temp, "manifest.json"), raw, 0600); e != nil {
		return "", e
	}
	if e = os.Rename(temp, dest); e != nil {
		return "", e
	}
	return filepath.Abs(dest)
}

// reproductionReadme writes a self-describing REPRODUCE.md so a reviewer knows
// the exact toolchain an export was made with before attempting a replay. The
// replay binary enforces an exact match (tool version + implementation digest +
// Go runtime), so a mismatched rebuild fails loudly instead of quietly producing
// different numbers.
func reproductionReadme(bundle models.VerificationRun) string {
	var b strings.Builder
	b.WriteString("# Reproduction\n\n")
	b.WriteString("This folder is an immutable export of one verification result from Gorantula. The numeric results were produced by the fixed local verification tools and recorded; this readme records the exact implementation and runtime used.\n\n")
	b.WriteString("## Replay\n\n")
	b.WriteString("From a checkout of the recorded Gorantula implementation, re-run the recorded calls without an LLM, server, Docker, or OCR re-run:\n\n")
	b.WriteString("```powershell\n")
	b.WriteString("go run ./cmd/research-replay -bundle ./evidence.json\n")
	b.WriteString("```\n\n")
	b.WriteString("The replay recomputes each recorded call and compares its output digest to the saved bundle. It reports `matches: true` only when every result reproduces exactly.\n\n")
	b.WriteString("## Required toolchain (recorded at export time)\n\n")
	b.WriteString(fmt.Sprintf("- Verification tool version: %s\n", bundle.ToolVersion))
	b.WriteString(fmt.Sprintf("- Implementation digest: %s\n", bundle.ImplementationDigest))
	b.WriteString(fmt.Sprintf("- Go runtime: %s\n", bundle.Runtime))
	b.WriteString("\nThe replay binary rejects a bundle whose tool version, implementation digest, or Go runtime differs from the build that re-runs it. If it fails, those recorded values are what is required; do not treat a toolchain mismatch as a different scientific result.\n\n")
	if bundle.Dataset.ID != "" {
		b.WriteString("## Input data\n\n")
		b.WriteString(fmt.Sprintf("- Dataset: %s\n", bundle.Dataset.Name))
		if bundle.Dataset.Source != "" {
			b.WriteString(fmt.Sprintf("- Source: %s\n", bundle.Dataset.Source))
		}
		b.WriteString(fmt.Sprintf("- Prepared rows: %d\n", bundle.Dataset.Rows))
		b.WriteString(fmt.Sprintf("- Input digest: %s\n", bundle.Dataset.Digest))
		b.WriteString("\nThe dataset is recorded as an immutable CSV snapshot in evidence.json. The replay re-verifies the input digest against the recorded bytes before recomputing.\n\n")
	}
	b.WriteString("## Honest limits\n\n")
	b.WriteString("Replay reproduces the recorded computation in the recorded environment; it is not independent replication and it does not establish causation, novelty, or the correctness of the source claims. Inspect evidence.json for source spans, assumptions, and the exact calls. Failed or inconclusive attempts are retained and must not be treated as support.\n")
	return b.String()
}
