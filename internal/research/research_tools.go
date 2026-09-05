package research

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/Andyi955/Gorantula/models"
	"github.com/ledongthuc/pdf"
)

func validateDataset(d models.ResearchDataset, call models.DatasetCall) (models.DatasetResult, error) {
	out, err := inspectDataset(d)
	if err != nil {
		return out, err
	}
	out.Call = call
	headers, rows, _ := parseVerificationCSV(d.CSV)
	out.Counts = map[string]int{"rows": len(rows), "duplicateRows": 0, "repeatedIDs": 0, "missingIDs": 0}
	seen := map[string]bool{}
	ids := map[string]bool{}
	idIndex := -1
	for i, h := range headers {
		if h == call.IDColumn {
			idIndex = i
		}
	}
	if call.IDColumn != "" && idIndex < 0 {
		return out, fmt.Errorf("ID column does not exist")
	}
	for _, row := range rows {
		key, _ := json.Marshal(row)
		if seen[string(key)] {
			out.Counts["duplicateRows"]++
		}
		seen[string(key)] = true
		if idIndex >= 0 {
			v := strings.TrimSpace(row[idIndex])
			if missingDatasetCell(v) {
				out.Counts["missingIDs"]++
			} else {
				if ids[v] {
					out.Counts["repeatedIDs"]++
				}
				ids[v] = true
			}
		}
	}
	for _, col := range out.Columns {
		if col.Missing > 0 {
			out.Warnings = append(out.Warnings, fmt.Sprintf("%s: %d missing cells", col.Name, col.Missing))
		}
		if col.Numeric > 0 && col.Text > 0 {
			out.Warnings = append(out.Warnings, col.Name+": mixed numeric and text values; check embedded units or codes")
		}
		declared := strings.TrimSpace(call.Units[col.Name])
		unit := headerUnit(col.Name)
		if declared != "" && unit != "" && !strings.EqualFold(declared, unit) {
			out.Warnings = append(out.Warnings, col.Name+": declared unit conflicts with the header")
		}
		if declared == "" && unit == "" && col.Numeric > 0 {
			out.Warnings = append(out.Warnings, col.Name+": unit unspecified; may be dimensionless, verify source")
		}
	}
	for name := range call.Units {
		found := false
		for _, h := range headers {
			if h == name {
				found = true
			}
		}
		if !found {
			return out, fmt.Errorf("unit declaration names unknown column %q", name)
		}
	}
	if out.Counts["duplicateRows"] > 0 {
		out.Warnings = append(out.Warnings, "Exact duplicate rows found; do not automatically delete legitimate repeated measurements")
	}
	if out.Counts["repeatedIDs"] > 0 {
		out.Warnings = append(out.Warnings, "Repeated IDs may indicate paired, longitudinal or clustered observations; independent-group methods may be inappropriate")
	}
	out.Summary = "Validation completed without changing data. Study design and unit compatibility require source review; unique IDs do not prove independence."
	return out, nil
}

var unitHeader = regexp.MustCompile(`(?:\[([^\[\]]+)\]|\(([^()]+)\))$`)

func headerUnit(name string) string {
	m := unitHeader.FindStringSubmatch(strings.TrimSpace(name))
	if len(m) == 0 {
		return ""
	}
	return strings.TrimSpace(m[1] + m[2])
}

// Unique nonmissing keys prevent accidental many-to-many multiplication. All
// collisions are renamed, and unmatched observations are explicitly counted.
func (s *Service) joinDatasets(left, right models.ResearchDataset, call models.DatasetCall) (models.ResearchDataset, models.DatasetResult, error) {
	out := models.DatasetResult{Call: call}
	if strings.TrimSpace(call.Rationale) == "" || len(call.Rationale) > 2000 {
		return left, out, fmt.Errorf("join rationale required")
	}
	if call.Operator != "inner" && call.Operator != "left" {
		return left, out, fmt.Errorf("join must be inner or left")
	}
	lh, lr, err := parseVerificationCSV(left.CSV)
	if err != nil {
		return left, out, err
	}
	rh, rr, err := parseVerificationCSV(right.CSV)
	if err != nil {
		return left, out, err
	}
	keyIndex := func(h []string, k string) int {
		for i, v := range h {
			if v == k {
				return i
			}
		}
		return -1
	}
	for name, unit := range call.Units {
		if keyIndex(lh, name) < 0 || strings.TrimSpace(unit) == "" || len(unit) > 80 {
			return left, out, fmt.Errorf("invalid left unit declaration for %s", name)
		}
	}
	for name, unit := range call.RightUnits {
		if keyIndex(rh, name) < 0 || strings.TrimSpace(unit) == "" || len(unit) > 80 {
			return left, out, fmt.Errorf("invalid right unit declaration for %s", name)
		}
	}
	li, ri := keyIndex(lh, call.Column), keyIndex(rh, call.RightKey)
	if li < 0 || ri < 0 {
		return left, out, fmt.Errorf("join keys must name existing columns")
	}
	index := func(rows [][]string, i int) (map[string][]string, error) {
		m := map[string][]string{}
		for _, r := range rows {
			k := r[i]
			if missingDatasetCell(k) {
				return nil, fmt.Errorf("join keys must be nonmissing")
			}
			if _, ok := m[k]; ok {
				return nil, fmt.Errorf("join keys must be unique; aggregate or explicitly resolve repeated IDs first")
			}
			m[k] = r
		}
		return m, nil
	}
	lm, err := index(lr, li)
	if err != nil {
		return left, out, err
	}
	rm, err := index(rr, ri)
	if err != nil {
		return left, out, err
	}
	// Only compare declared/header units. No implicit conversion or guessed units.
	for _, h := range lh {
		for _, r := range rh {
			if strings.TrimSpace(unitHeader.ReplaceAllString(h, "")) == strings.TrimSpace(unitHeader.ReplaceAllString(r, "")) || h == call.Column && r == call.RightKey {
				a, b := call.Units[h], call.RightUnits[r]
				if a == "" {
					a = headerUnit(h)
				}
				if b == "" {
					b = headerUnit(r)
				}
				if a != "" && b != "" && !strings.EqualFold(a, b) {
					return left, out, fmt.Errorf("unit conflict for %s and %s: %s versus %s; convert explicitly first", h, r, a, b)
				}
			}
		}
	}
	headers := append([]string{}, lh...)
	seen := map[string]bool{}
	for _, h := range headers {
		seen[h] = true
	}
	for i, h := range rh {
		if i == ri {
			continue
		}
		name := h
		for seen[name] {
			name = "right_" + name
		}
		headers = append(headers, name)
		seen[name] = true
	}
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	_ = w.Write(headers)
	matched, unmatched := 0, 0
	for _, l := range lr {
		r, ok := rm[l[li]]
		if !ok {
			unmatched++
			if call.Operator == "inner" {
				continue
			}
			r = make([]string, len(rh))
		} else {
			matched++
		}
		row := append([]string{}, l...)
		for i, v := range r {
			if i != ri {
				row = append(row, v)
			}
		}
		_ = w.Write(row)
	}
	w.Flush()
	if w.Error() != nil {
		return left, out, w.Error()
	}
	columns, rows, err := parseVerificationCSV(buf.String())
	if err != nil {
		return left, out, err
	}
	rightUnmatched := 0
	for k := range rm {
		if _, ok := lm[k]; !ok {
			rightUnmatched++
		}
	}
	child := models.ResearchDataset{Name: "Joined dataset", Source: "Join of " + left.ID + " and " + right.ID, CSV: buf.String(), Digest: digestBytes(buf.Bytes()), Columns: columns, Rows: len(rows), ParentID: left.ID, ParentDigest: left.Digest, OtherParentID: right.ID, OtherParentDigest: right.Digest, Join: &call}
	encoded, _ := json.Marshal(child)
	child.ID = digestBytes(encoded)
	err = s.verificationStore("datasets").saveSlice(child.ID+".json", child)
	out.DatasetID = child.ID
	out.Warnings = []string{"Only declared or header-labelled units were checked. Verify unspecified units and population compatibility; no conversion was performed."}
	out.Counts = map[string]int{"matched": matched, "unmatchedLeft": unmatched, "unmatchedRight": rightUnmatched, "outputRows": len(rows)}
	out.Summary = fmt.Sprintf("%s join: %d matched, %d unmatched left, %d unmatched right. Keys matched exactly; no unit conversion. Review missing cells and population selection.", call.Operator, matched, unmatched, rightUnmatched)
	return child, out, err
}

func lookupEvidence(papers []models.Paper, call models.DatasetCall) (models.DatasetResult, error) {
	out := models.DatasetResult{Call: call}
	if strings.TrimSpace(call.Query) == "" || len(call.Query) > 200 {
		return out, fmt.Errorf("provide a literal search phrase up to 200 bytes")
	}
	for _, p := range papers {
		if call.PaperID != "" && p.ID != call.PaperID {
			continue
		}
		body, source := p.FullText, "fullText"
		if body == "" {
			body, source = p.Abstract, "abstract"
		}
		start := 0
		// Exact matching keeps byte offsets valid, including non-ASCII source text.
		for len(out.Passages) < 10 {
			at := strings.Index(body[start:], call.Query)
			if at < 0 {
				break
			}
			at += start
			lo, hi := max(0, at-400), min(len(body), at+len(call.Query)+900)
			for lo > 0 && (body[lo]&0xc0) == 0x80 {
				lo--
			}
			for hi < len(body) && (body[hi]&0xc0) == 0x80 {
				hi++
			}
			out.Passages = append(out.Passages, models.EvidencePassage{PaperID: p.ID, Source: p.SourceURL + " (" + source + ")", Digest: digestBytes([]byte(body)), Offset: lo, Text: body[lo:hi]})
			start = at + len(call.Query)
		}
	}
	out.Summary = fmt.Sprintf("%d literal source matches (case-sensitive), with byte offsets and source-text digests. A match is evidence location, not endorsement of the claim.", len(out.Passages))
	if len(out.Passages) == 0 {
		out.Summary += " This is not keyword search: retry a single short literal term from the title or measurement, not a list of words. Zero matches do not establish that evidence is unavailable."
	}
	return out, nil
}

// Text positions identify simple aligned table candidates. Ambiguous layouts,
// scanned pages and merged cells need human review; extraction never uses an LLM.
func extractPDFPage(ctx context.Context, data []byte, source string, page int) (out models.DatasetResult, err error) {
	defer func() {
		if v := recover(); v != nil {
			err = fmt.Errorf("cannot parse PDF page: %v", v)
		}
	}()
	if len(data) > maxDatasetBytes || !bytes.HasPrefix(data, []byte("%PDF-")) {
		return out, fmt.Errorf("expected a PDF up to 1 MiB")
	}
	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return out, err
	}
	if page < 1 || page > reader.NumPage() {
		return out, fmt.Errorf("page must be between 1 and %d", reader.NumPage())
	}
	if err = ctx.Err(); err != nil {
		return out, err
	}
	rows, err := reader.Page(page).GetTextByRow()
	if err != nil {
		return out, err
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Position > rows[j].Position })
	var lines []string
	var cells [][]string
	for _, row := range rows {
		if err = ctx.Err(); err != nil {
			return out, err
		}
		sort.Slice(row.Content, func(i, j int) bool { return row.Content[i].X < row.Content[j].X })
		var line []string
		for _, part := range row.Content {
			if v := strings.TrimSpace(part.S); v != "" {
				line = append(line, v)
			}
		}
		if len(line) > 0 {
			lines = append(lines, strings.Join(line, " "))
			cells = append(cells, line)
		}
		if len(lines) > 2000 {
			return out, fmt.Errorf("page exceeds row limit")
		}
	}
	text := strings.Join(lines, "\n")
	if len(text) == 0 {
		return out, fmt.Errorf("page has no readable text; scanned PDFs need OCR")
	}
	if len(text) > 24000 {
		return out, fmt.Errorf("page text exceeds 24000 bytes")
	}
	out.Passages = []models.EvidencePassage{{Source: source, Digest: digestBytes(data), Page: page, Text: text}}
	// Emit runs of equally sized positioned rows; retain every cell for review.
	for i := 0; i < len(cells); {
		j := i + 1
		for j < len(cells) && len(cells[j]) == len(cells[i]) {
			j++
		}
		if len(cells[i]) >= 2 && len(cells[i]) <= 32 && j-i >= 3 && len(out.Tables) < 10 {
			out.Tables = append(out.Tables, models.ExtractedTable{Index: len(out.Tables), Page: page, Rows: cells[i:j]})
		}
		i = j
	}
	out.Summary = fmt.Sprintf("Page %d of %d: extracted text and %d possible aligned tables. Verify cell boundaries, headers and units against the original PDF; no OCR or merged-cell reconstruction.", page, reader.NumPage(), len(out.Tables))
	return out, nil
}

func (s *Service) executeResearchDataTool(ctx context.Context, run *models.VerificationRun, call models.DatasetCall, fetch func(context.Context, string) ([]byte, string, error)) models.DatasetResult {
	out := models.DatasetResult{Call: call}
	var err error
	switch call.Tool {
	case "dataset-validate":
		out, err = validateDataset(run.Dataset, call)
	case "evidence-lookup":
		out, err = lookupEvidence(run.Papers, call)
	case "dataset-join":
		if hasSuccessfulCalculation(run.Results) {
			err = fmt.Errorf("dataset is frozen after the first successful calculation")
			break
		}
		var right, child models.ResearchDataset
		right, err = s.loadDataset(call.DatasetID)
		if err != nil {
			break
		}
		child, out, err = s.joinDatasets(run.Dataset, right, call)
		if err == nil {
			run.DatasetParents = append(run.DatasetParents, run.Dataset, right)
			run.Dataset = child
		}
	case "paper-extract", "paper-table", "paper-scan", "paper-complex-table", "paper-docx":
		if strings.HasPrefix(call.URL, "local-pdf:") {
			id := strings.TrimPrefix(call.URL, "local-pdf:")
			if !verificationID.MatchString(id) {
				err = fmt.Errorf("invalid local PDF ID")
				break
			}
			var doc models.ResearchDocument
			err = s.verificationStore("documents").readJSON(id+".json", &doc)
			if err != nil {
				break
			}
			if doc.URL != call.URL || doc.Digest != id || digestBytes(doc.Bytes) != id {
				err = fmt.Errorf("local PDF digest mismatch")
				break
			}
			found := false
			for _, saved := range run.Documents {
				if saved.URL == doc.URL {
					found = true
				}
			}
			if !found {
				run.Documents = append(run.Documents, doc)
			}
		}
		allowed := false
		for _, doc := range run.Documents {
			if doc.URL == call.URL {
				allowed = true
			}
		}
		for _, u := range run.PaperSources {
			if u == call.URL {
				allowed = true
			}
		}
		for _, r := range run.DatasetActions {
			for _, u := range r.Links {
				if u == call.URL {
					allowed = true
				}
			}
		}
		if !allowed {
			err = fmt.Errorf("Document URL must be a candidate source or observed link")
			break
		}
		if call.Tool == "paper-table" {
			if hasSuccessfulCalculation(run.Results) {
				err = fmt.Errorf("dataset is frozen after the first successful calculation")
				break
			}
			if strings.TrimSpace(call.Rationale) == "" || len(call.Rationale) > 2000 {
				err = fmt.Errorf("table extraction rationale required")
				break
			}
			var table *models.ExtractedTable
			for _, r := range run.DatasetActions {
				if (r.Call.Tool == "paper-extract" || r.Call.Tool == "paper-complex-table" || r.Call.Tool == "paper-docx") && r.Call.URL == call.URL && r.Call.Page == call.Page && (r.ExtractionID == "" && call.ExtractionID == "" || r.ExtractionID != "" && r.ExtractionID == call.ExtractionID) {
					for _, v := range r.Tables {
						if v.Index == call.TableIndex {
							copy := v
							table = &copy
						}
					}
				}
			}
			if table == nil {
				err = fmt.Errorf("no matching saved table reference: use the page, tableIndex and extractionId from the matching paper-complex-table result (availableTableSaves), or extract this page first")
				break
			}
			var buf bytes.Buffer
			w := csv.NewWriter(&buf)
			err = w.WriteAll(table.Rows)
			if err != nil {
				break
			}
			var d models.ResearchDataset
			d, err = s.RegisterDataset("Extracted document table", fmt.Sprintf("%s page %d table candidate %d; extracted, unverified cell boundaries. %s", call.URL, call.Page, call.TableIndex, call.Rationale), buf.String())
			if err == nil {
				run.Dataset = d
				out.DatasetID = d.ID
				out.Summary = "Saved extracted table; verify headers, cells and units against the retained document before scientific use."
			}
			break
		}
		var data []byte
		resolved := call.URL
		pmcVerified := false
		for _, doc := range run.Documents {
			if doc.URL == call.URL {
				data = doc.Bytes
				pmcVerified = doc.PMCChecksumVerified
				if doc.ResolvedURL != "" {
					resolved = doc.ResolvedURL
				}
			}
		}
		if data == nil {
			data, resolved, err = fetch(ctx, call.URL)
			if call.Tool == "paper-docx" && ctx.Err() == nil && (err != nil || !bytes.HasPrefix(data, []byte("PK"))) && strings.HasPrefix(call.URL, "https://pmc.ncbi.nlm.nih.gov/") {
				data, resolved, err = fetchPMCSupplement(ctx, call.URL, fetch)
				pmcVerified = err == nil
			}
			if err != nil {
				break
			}
		}
		if call.Tool == "paper-docx" {
			if call.Page != 0 {
				err = fmt.Errorf("DOCX has no stable page numbers; use page 0 or omit page")
				break
			}
			out, err = extractDOCX(data, resolved)
			if err == nil && pmcVerified {
				out.Links = []string{resolved}
				out.Warnings = append(out.Warnings, "Read via the official PMC public repository; repository checksum verified. Source availability does not establish study quality.")
			}
		} else if call.Tool == "paper-scan" || call.Tool == "paper-complex-table" {
			out, err = scanPDFResult(ctx, data, call)
		} else {
			out, err = extractPDFPage(ctx, data, call.URL, call.Page)
		}
		out.Call = call
		if err == nil {
			found := false
			for _, doc := range run.Documents {
				if doc.URL == call.URL {
					found = true
				}
			}
			if !found {
				run.Documents = append(run.Documents, models.ResearchDocument{URL: call.URL, ResolvedURL: resolved, PMCChecksumVerified: pmcVerified, Digest: digestBytes(data), Bytes: data})
			}
		}
	default:
		err = fmt.Errorf("unknown research data tool")
	}
	if err != nil {
		out.Error = err.Error()
	}
	return out
}

// Keep UTF-8 source offsets stable when bounding frozen paper text.
func boundedPaperText(text string) string {
	if len(text) <= 200000 {
		return text
	}
	end := 200000
	for end > 0 && (text[end]&0xc0) == 0x80 {
		end--
	}
	return text[:end]
}
