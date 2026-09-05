package research

import (
	"bytes"
	"fmt"
	"github.com/Andyi955/Gorantula/models"
	"github.com/go-pdf/fpdf"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/goregular"
	"image/png"
	"net/url"
	"strings"
	"time"
)

// Render saved content only: no network, scripts, external fonts or model calls.
func publicationPDF(d models.PublicationDraft) ([]byte, error) {
	p := fpdf.New("P", "mm", "A4", "")
	p.SetCatalogSort(true)
	created, err := time.Parse(time.RFC3339Nano, d.CreatedAt)
	if err != nil {
		created = time.Unix(0, 0).UTC()
	}
	p.SetCreationDate(created)
	p.SetModificationDate(created)
	p.SetMargins(20, 25, 20)
	p.SetAutoPageBreak(true, 23)
	p.AddUTF8FontFromBytes("Go", "", goregular.TTF)
	p.AddUTF8FontFromBytes("Go", "B", gobold.TTF)
	p.SetTitle("Research report: "+d.Candidate.Hypothesis, true)
	p.SetAuthor("Gorantula", true)
	p.AliasNbPages("")
	p.SetHeaderFunc(func() {
		p.SetY(11)
		p.SetFont("Go", "B", 9)
		p.SetTextColor(22, 105, 119)
		p.CellFormat(170, 6, "GORANTULA / RESEARCH REPORT", "", 1, "L", false, 0, "")
		p.SetDrawColor(201, 216, 222)
		p.Line(20, 20, 190, 20)
		p.SetY(25)
	})
	p.SetFooterFunc(func() {
		p.SetY(-16)
		p.SetFont("Go", "", 8)
		p.SetTextColor(83, 98, 110)
		p.CellFormat(170, 5, fmt.Sprintf("Evidence: inconclusive  |  %s  |  Page %d/{nb}", d.Status, p.PageNo()), "", 0, "R", false, 0, "")
	})
	bodySize, bodyLine := 10.5, 5.7
	body := func(text string) {
		p.SetFont("Go", "", bodySize)
		p.SetTextColor(35, 47, 58)
		p.MultiCell(170, bodyLine, pdfText(text), "", "L", false)
		p.Ln(3)
	}
	heading := func(text string) {
		if p.GetY() > 230 {
			p.AddPage()
		}
		p.Ln(3)
		p.Bookmark(text, 0, -1)
		p.SetFont("Go", "B", 15)
		p.SetTextColor(22, 105, 119)
		p.MultiCell(170, 8, text, "", "L", false)
		p.Ln(2)
	}
	sub := func(text string) {
		if p.GetY() > 251 {
			p.AddPage()
		}
		p.SetFont("Go", "B", 11)
		p.SetTextColor(35, 47, 58)
		p.MultiCell(170, 6, pdfText(text), "", "L", false)
		p.Ln(2)
	}
	p.AddPage()
	p.SetFont("Go", "B", 22)
	p.SetTextColor(21, 42, 54)
	p.MultiCell(170, 10, pdfText(d.Candidate.Hypothesis), "", "L", false)
	p.Ln(5)
	body("Research question / tentative finding. This report does not establish a discovery.")
	body(fmt.Sprintf("Prepared %s | Sharing state: %s", created.Format("2 January 2006"), d.Status))
	if d.Stale {
		body("EVIDENCE CHANGED: this is an older snapshot. Prepare and review a fresh revision before sharing.")
	}
	for _, issue := range d.ReviewIssues {
		body("Review issue: " + issue)
	}
	body(fmt.Sprintf("%d sources | %d grounded claims | %d recorded calculations | %d report reviewer responses", len(d.Papers), len(d.Claims), len(d.Run.Results), len(d.Run.ReportReviews)))
	heading("1. Summary")
	if d.Run.Interpretation != "" {
		body("The following is the agent's interpretation of the recorded evidence, not a measurement.")
		body(d.Run.Interpretation)
	} else {
		body("Read the recorded findings below. No separate model interpretation was recorded.")
	}
	if len(d.Run.Results) == 0 {
		body("Literature report only. No numerical analysis or empirical verification was performed. No chart or measurements have been invented.")
	}
	heading("2. Background and evidence")
	if d.Run.Request.Topic != "" {
		body("Original topic: " + d.Run.Request.Topic)
	}
	if len(d.Claims) == 0 {
		body("No extracted source claims are attached to this report.")
	}
	for i, c := range d.Claims {
		sub(fmt.Sprintf("Claim %d / %s", i+1, c.PaperID))
		body(c.Text)
		if c.SourceSnippet != "" {
			body("Source passage (" + c.Provenance + "): " + c.SourceSnippet)
		}
	}
	heading("3. Findings and figures")
	for i, r := range d.Run.Results {
		sub(fmt.Sprintf("Check %d: %s (%s)", i+1, r.Call.Tool, r.Status))
		body(r.Summary)
	}
	if len(d.Figures) == 0 {
		body("No numerical figures were produced for this report.")
	}
	for i, f := range d.Figures {
		if len(f.PNG) == 0 {
			body("Figure unavailable: " + f.Title)
			continue
		}
		cfg, e := png.DecodeConfig(bytes.NewReader(f.PNG))
		if e != nil {
			return nil, fmt.Errorf("invalid report figure: %w", e)
		}
		width := 170.0
		height := width * float64(cfg.Height) / float64(cfg.Width)
		if height > 120 {
			width *= 120 / height
			height = 120
		}
		if p.GetY()+height+30 > 270 {
			p.AddPage()
		}
		sub(fmt.Sprintf("Figure %d. %s", i+1, f.Title))
		// Long captions can page-break; reserve the image separately after the heading.
		if p.GetY()+height > 270 {
			p.AddPage()
		}
		name := fmt.Sprintf("figure-%d", i)
		p.RegisterImageOptionsReader(name, fpdf.ImageOptions{ImageType: "PNG"}, bytes.NewReader(f.PNG))
		y := p.GetY()
		p.ImageOptions(name, 20, y, width, height, false, fpdf.ImageOptions{ImageType: "PNG"}, 0, "")
		p.SetY(y + height + 4)
		body(f.Caption)
	}
	heading("4. Reviewer checks and limitations")
	body("Agent reviews are recorded opinions about the available evidence, not independent scientific certification. Abstract-only evidence cannot establish full study methods.")
	for _, r := range d.Run.ReportReviews {
		sub(r.Role)
		body(r.Summary)
		for _, c := range r.Concerns {
			body("- " + c)
		}
	}
	for _, r := range d.Run.StudyReviews {
		sub("Study-design check")
		body(r.Reason)
		for _, c := range r.Contradictions {
			body("- " + c)
		}
	}
	if len(d.Run.ReportReviews)+len(d.Run.StudyReviews) == 0 {
		body("No model reviewer response is recorded for this run.")
	}
	for _, r := range d.Run.Results {
		for _, a := range r.Assumptions {
			body("- " + a)
		}
	}
	body("Calculations do not establish causation, novelty, or correctness of source claims. Missing design facts remain unknown. Independent replication and appropriate source evidence are needed before extending conclusions.")
	heading("5. Evidence connections")
	if len(d.Relations) == 0 {
		body("No cross-claim connections were recorded. Absence of a contradiction is not corroboration.")
	}
	for _, r := range d.Relations {
		body(r.SourceClaimID + " / " + r.RelationKind + " / " + r.TargetClaimID)
		body("Connection basis: " + strings.Join(r.Basis, ", "))
	}
	heading("6. References")
	for i, source := range d.Papers {
		sub(fmt.Sprintf("[%d] %s", i+1, source.Title))
		body(fmt.Sprintf("%s (%d). %s", strings.Join(source.Authors, ", "), source.Year, source.Venue))
		body("Source ID: " + source.ID)
		if source.SourceURL != "" {
			body(source.SourceURL)
			u, e := url.Parse(source.SourceURL)
			if e == nil && (u.Scheme == "http" || u.Scheme == "https") {
				p.SetFont("Go", "", 10)
				p.SetTextColor(22, 105, 119)
				p.WriteLinkString(6, "Open original source", source.SourceURL)
				p.Ln(9)
			}
		}
	}
	heading("7. Methods and audit appendix")
	bodySize, bodyLine = 9.5, 5
	body("Publication: " + d.ID + "\nRevision: " + d.Revision + "\nRun: " + d.RunID + "\nTool implementation: " + d.Run.ImplementationDigest + "\nRuntime: " + d.Run.Runtime)
	if d.Run.Dataset.ID != "" {
		body("Dataset: " + d.Run.Dataset.Name + "\nProvenance: " + d.Run.Dataset.Source + fmt.Sprintf("\nRows: %d", d.Run.Dataset.Rows) + "\nInput digest: " + d.Run.Dataset.Digest)
	}
	for _, r := range d.Run.Results {
		body("Tool: " + r.Call.Tool + "\nProposition: " + r.Call.Statement + "\nRationale: " + r.Call.Rationale + "\nGroup/predictor: " + r.Call.GroupColumn + "\nValue/outcome: " + r.Call.ValueColumn + "\nResult digest: " + r.OutputDigest)
	}
	for _, a := range d.Run.DatasetActions {
		body("Preparation: " + a.Call.Tool + "\nReason: " + a.Call.Rationale)
		if a.Error != "" {
			body("Reported error: " + a.Error)
		}
	}
	body("Exact tool calls, source spans and dataset snapshots remain in evidence.json alongside this PDF. The PDF is the reading copy; the evidence files preserve reproducibility.")
	for _, a := range d.Audit {
		body(a.Action + " | " + a.Operator + " | " + a.At + "\n" + a.Reason)
	}
	if len(d.Audit) == 0 {
		body("No sharing decision is recorded. This is a draft preview.")
	}
	var out bytes.Buffer
	if err := p.Output(&out); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func pdfText(s string) string {
	return strings.NewReplacer("\r", "", "—", "-", "–", "-", "‑", "-", "**", "").Replace(s)
}
