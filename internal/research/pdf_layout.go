package research

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/ledongthuc/pdf"
	"math"
	"sort"
	"strings"

	"github.com/Andyi955/Gorantula/models"
)

func validatePDFLayoutCall(call models.DatasetCall) error {
	end := call.EndPage
	if end == 0 {
		end = call.Page
	}
	if call.Page < 1 || end < call.Page || end-call.Page > 2 {
		return fmt.Errorf("choose one to three consecutive pages, starting at page 1 or later")
	}
	if call.Rotation != 0 && call.Rotation != 90 && call.Rotation != 180 && call.Rotation != 270 {
		return fmt.Errorf("rotation must be 0, 90, 180 or 270 degrees clockwise")
	}
	if call.HeaderRows < 0 || call.HeaderRows > 4 {
		return fmt.Errorf("header rows must be 1 to 4 (default 1)")
	}
	if len(call.ColumnCuts) > 31 {
		return fmt.Errorf("at most 32 columns")
	}
	prev := 0.
	for _, v := range call.ColumnCuts {
		if math.IsNaN(v) || math.IsInf(v, 0) || v <= prev || v >= 100 {
			return fmt.Errorf("column boundaries must be increasing percentages between 0 and 100")
		}
		prev = v
	}
	if len(call.Region) != 0 {
		if len(call.Region) != 4 {
			return fmt.Errorf("region must be [left,top,width,height] in page percentages")
		}
		for _, v := range call.Region {
			if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 100 {
				return fmt.Errorf("invalid region percentage")
			}
		}
		if call.Region[2] <= 0 || call.Region[3] <= 0 || call.Region[0]+call.Region[2] > 100 || call.Region[1]+call.Region[3] > 100 {
			return fmt.Errorf("region must fit inside the page")
		}
	}
	return nil
}

func layoutRows(words []models.OCRWord, region []float64) [][]models.OCRWord {
	selected := []models.OCRWord{}
	for _, w := range words {
		cx, cy := w.X+w.Width/2, w.Y+w.Height/2
		if len(region) == 4 && (cx < region[0] || cx > region[0]+region[2] || cy < region[1] || cy > region[1]+region[3]) {
			continue
		}
		if strings.TrimSpace(w.Text) != "" {
			selected = append(selected, w)
		}
	}
	sort.SliceStable(selected, func(i, j int) bool { return selected[i].Y+selected[i].Height/2 < selected[j].Y+selected[j].Height/2 })
	rows := [][]models.OCRWord{}
	for _, w := range selected {
		if len(rows) == 0 {
			rows = append(rows, []models.OCRWord{w})
			continue
		}
		last := rows[len(rows)-1]
		anchor := last[0]
		if math.Abs(w.Y+w.Height/2-anchor.Y-anchor.Height/2) <= math.Max(.25, math.Min(w.Height, anchor.Height)*.55) {
			rows[len(rows)-1] = append(last, w)
		} else {
			rows = append(rows, []models.OCRWord{w})
		}
	}
	for _, row := range rows {
		sort.SliceStable(row, func(i, j int) bool { return row[i].X < row[j].X })
	}
	return rows
}

// Repeated wide gaps define candidate columns. Explicit boundaries override this
// heuristic for merged headers, borderless layouts and densely packed columns.
func inferColumnCuts(rows [][]models.OCRWord, headerRows int) ([]float64, error) {
	type group struct{ left, right float64 }
	var best []group
	counts := map[int]int{}
	candidates := map[int][][]group{}
	for i, row := range rows {
		if i < headerRows || len(row) < 2 {
			continue
		}
		groups := []group{{row[0].X, row[0].X + row[0].Width}}
		for _, w := range row[1:] {
			last := &groups[len(groups)-1]
			if w.X-last.right > math.Max(1.2, w.Height*1.5) {
				groups = append(groups, group{w.X, w.X + w.Width})
			} else {
				last.right = math.Max(last.right, w.X+w.Width)
			}
		}
		if len(groups) >= 2 && len(groups) <= 32 {
			counts[len(groups)]++
			candidates[len(groups)] = append(candidates[len(groups)], groups)
		}
	}
	modal, bestCount := 0, 0
	for n, count := range counts {
		if count > bestCount || count == bestCount && n < modal {
			modal, bestCount = n, count
		}
	}
	if bestCount < 2 {
		return nil, fmt.Errorf("cannot identify repeated column gaps; specify column boundaries and a table region")
	}
	best = append([]group{}, candidates[modal][0]...)
	for _, row := range candidates[modal] {
		for i, g := range row {
			best[i].left = math.Min(best[i].left, g.left)
			best[i].right = math.Max(best[i].right, g.right)
		}
	}
	cuts := []float64{}
	for i := 0; i < len(best)-1; i++ {
		if best[i].right >= best[i+1].left {
			return nil, fmt.Errorf("ambiguous column alignment; specify column boundaries")
		}
		cuts = append(cuts, (best[i].right+best[i+1].left)/2)
	}
	return cuts, nil
}

func complexTable(pages []models.OCRPage, call models.DatasetCall) (models.ExtractedTable, error) {
	table := models.ExtractedTable{Index: 0, Page: call.Page, EndPage: call.EndPage, Warnings: []string{"Positional extraction may misassign cells; OCR may also confuse digits and symbols. Verify values against the source; no confidence score is inferred.", "Blank body cells remain blank. Merged body values are not copied into neighbouring cells."}}
	if err := validatePDFLayoutCall(call); err != nil {
		return table, err
	}
	headers := call.HeaderRows
	if headers == 0 {
		headers = 1
	}
	cuts := append([]float64{}, call.ColumnCuts...)
	for pageIndex, page := range pages {
		rows := layoutRows(page.Words, call.Region)
		if len(rows) < headers+1 {
			return table, fmt.Errorf("page %d has insufficient rows in the selected region", page.Page)
		}
		if len(cuts) == 0 {
			var err error
			cuts, err = inferColumnCuts(rows, headers)
			if err != nil {
				return table, err
			}
			table.Warnings = append(table.Warnings, "Column boundaries were inferred from repeated gaps; review alignment or supply explicit boundaries.")
		}
		cols := len(cuts) + 1
		values := [][]string{}
		refs := [][]models.TableCellSource{}
		for ri, row := range rows {
			cells := make([]string, cols)
			sources := make([]models.TableCellSource, cols)
			for i := range sources {
				sources[i].Page = page.Page
			}
			for _, w := range row {
				left := sort.SearchFloat64s(cuts, w.X+.05)
				right := sort.SearchFloat64s(cuts, w.X+w.Width-.05)
				if right < left {
					right = left
				}
				if left >= cols {
					left = cols - 1
				}
				if right >= cols {
					right = cols - 1
				}
				last := left
				if ri < headers {
					last = right
				}
				for c := left; c <= last; c++ {
					if cells[c] != "" {
						cells[c] += " "
					}
					cells[c] += w.Text
					sources[c].Words = append(sources[c].Words, w)
					sources[c].ColumnSpan = max(sources[c].ColumnSpan, right-left+1)
				}
				if ri >= headers && right > left {
					table.Warnings = append(table.Warnings, fmt.Sprintf("Page %d body row %d crosses a column boundary; value retained only in its starting column.", page.Page, ri-headers+1))
				}
			}
			values = append(values, cells)
			refs = append(refs, sources)
		}
		names := make([]string, cols)
		headerRefs := make([]models.TableCellSource, cols)
		for c := 0; c < cols; c++ {
			parts := []string{}
			for ri := 0; ri < headers; ri++ {
				v := values[ri][c]
				if v != "" && (len(parts) == 0 || parts[len(parts)-1] != v) {
					parts = append(parts, v)
				}
				headerRefs[c].Words = append(headerRefs[c].Words, refs[ri][c].Words...)
				headerRefs[c].Page = page.Page
				headerRefs[c].ColumnSpan = max(headerRefs[c].ColumnSpan, refs[ri][c].ColumnSpan)
			}
			names[c] = strings.Join(parts, " / ")
			if names[c] == "" {
				return table, fmt.Errorf("column %d has no header; adjust header rows or region", c+1)
			}
		}
		if pageIndex == 0 {
			table.Rows = append(table.Rows, names)
			table.CellSources = append(table.CellSources, headerRefs)
		} else {
			if strings.Join(names, "\x00") != strings.Join(table.Rows[0], "\x00") {
				return table, fmt.Errorf("page %d headers differ; extract separately instead of silently merging", page.Page)
			}
		}
		for ri := headers; ri < len(values); ri++ {
			row := values[ri]
			wrapped := call.JoinWrappedRows && len(table.Rows) > 1 && table.CellSources[len(table.Rows)-1][0].Page == page.Page && row[0] != ""
			for _, v := range row[1:] {
				if v != "" {
					wrapped = false
				}
			}
			if wrapped {
				idx := len(table.Rows) - 1
				table.Rows[idx][0] += " " + row[0]
				table.CellSources[idx][0].Words = append(table.CellSources[idx][0].Words, refs[ri][0].Words...)
			} else {
				table.Rows = append(table.Rows, row)
				table.CellSources = append(table.CellSources, refs[ri])
			}
		}
	}
	if len(table.Rows) < 3 || len(table.Rows) > 2001 {
		return table, fmt.Errorf("table must contain a header and 2–2000 data rows")
	}
	if call.JoinWrappedRows {
		table.Warnings = append(table.Warnings, "First-column-only continuation lines were joined by explicit request. Verify these are wrapped labels, not separate observations.")
	}
	if len(table.Warnings) > 30 {
		table.Warnings = table.Warnings[:30]
	}
	return table, nil
}

func scanPDFResult(ctx context.Context, data []byte, call models.DatasetCall) (models.DatasetResult, error) {
	out := models.DatasetResult{Call: call}
	if err := validatePDFLayoutCall(call); err != nil {
		return out, err
	}
	if len(data) > maxPDFBytes || !bytes.HasPrefix(data, []byte("%PDF-")) {
		return out, fmt.Errorf("expected a PDF up to 10 MiB")
	}
	var scan ocrOutput
	var err error
	if call.Tool == "paper-complex-table" {
		scan, err = nativePDFLayout(ctx, data, call)
	}
	if call.Tool != "paper-complex-table" || err != nil {
		scan, err = scanPDF(ctx, data, call)
	}
	if err != nil {
		return out, err
	}
	out.OCRPages = scan.Pages
	out.Engine = scan.Engine
	out.EngineVersion = scan.Version
	for _, page := range scan.Pages {
		lines := []string{}
		for _, row := range layoutRows(page.Words, call.Region) {
			words := []string{}
			for _, w := range row {
				words = append(words, w.Text)
			}
			lines = append(lines, strings.Join(words, " "))
		}
		text := strings.Join(lines, "\n")
		if text == "" {
			return out, fmt.Errorf("page %d has no recognised text; check rotation, scan quality or installed OCR language", page.Page)
		}
		out.Passages = append(out.Passages, models.EvidencePassage{Source: call.URL, Digest: digestBytes(data), Page: page.Page, Text: text})
	}
	out.Warnings = []string{"Extraction is not authenticated measurement data. Check numbers, symbols and cell positions against the source PDF. OCR, when used, provides no word-confidence score."}
	if call.Tool == "paper-complex-table" {
		table, err := complexTable(scan.Pages, call)
		if err != nil {
			return out, err
		}
		out.Tables = []models.ExtractedTable{table}
		out.Summary = fmt.Sprintf("Read %d table rows across %d pages, retaining cell positions and source PDF.", len(table.Rows)-1, len(scan.Pages))
	} else {
		out.Summary = fmt.Sprintf("Scanned %d PDF pages locally with Windows OCR (%s).", len(scan.Pages), scan.Pages[0].Language)
	}
	encoded, _ := json.Marshal(out)
	out.ExtractionID = digestBytes(encoded)
	return out, nil
}

// Preserve native glyphs when available, so reading a text PDF does not introduce
// OCR transcription errors. Image-only or rotated pages use the scan adapter.
func nativePDFLayout(ctx context.Context, data []byte, call models.DatasetCall) (out ocrOutput, err error) {
	defer func() {
		if recover() != nil {
			err = fmt.Errorf("native layout unavailable")
		}
	}()
	if call.Rotation != 0 {
		return out, fmt.Errorf("rotation requires rendered page")
	}
	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return out, err
	}
	end := call.EndPage
	if end == 0 {
		end = call.Page
	}
	if call.Page < 1 || end > reader.NumPage() {
		return out, fmt.Errorf("invalid page range")
	}
	for number := call.Page; number <= end; number++ {
		if err = ctx.Err(); err != nil {
			return out, err
		}
		page := reader.Page(number)
		if inheritedPDFValue(page, "Rotate").Int64()%360 != 0 {
			return out, fmt.Errorf("rotated page requires rendered layout")
		}
		box := inheritedPDFValue(page, "CropBox")
		if box.IsNull() {
			box = inheritedPDFValue(page, "MediaBox")
		}
		left, bottom := box.Index(0).Float64(), box.Index(1).Float64()
		width, height := box.Index(2).Float64()-left, box.Index(3).Float64()-bottom
		if width <= 0 || height <= 0 {
			return out, fmt.Errorf("invalid page dimensions")
		}
		glyphs := page.Content().Text
		if len(glyphs) == 0 || len(glyphs) > 30000 {
			return out, fmt.Errorf("native text unavailable or excessive")
		}
		sort.SliceStable(glyphs, func(i, j int) bool {
			if math.Abs(glyphs[i].Y-glyphs[j].Y) < .5 {
				return glyphs[i].X < glyphs[j].X
			}
			return glyphs[i].Y > glyphs[j].Y
		})
		words := []models.OCRWord{}
		var word *models.OCRWord
		for _, g := range glyphs {
			if strings.TrimSpace(g.S) == "" {
				word = nil
				continue
			}
			w := models.OCRWord{Text: g.S, X: 100 * (g.X - left) / width, Y: 100 * (height - (g.Y - bottom) - g.FontSize) / height, Width: 100 * g.W / width, Height: 100 * g.FontSize / height}
			if word != nil && math.Abs(w.Y-word.Y) < .15 && w.X-(word.X+word.Width) < w.Height*.25 && w.X >= word.X {
				word.Text += w.Text
				word.Width = w.X + w.Width - word.X
			} else {
				words = append(words, w)
				word = &words[len(words)-1]
			}
		}
		if len(words) == 0 {
			return out, fmt.Errorf("no usable native text")
		}
		out.Pages = append(out.Pages, models.OCRPage{Page: number, Words: words, Language: "native PDF text"})
	}
	out.Engine = "native PDF glyph layout"
	out.Version = "ledongthuc/pdf 5959a4027728"
	return out, nil
}

func inheritedPDFValue(page pdf.Page, key string) pdf.Value {
	v := page.V
	for depth := 0; !v.IsNull() && depth < 50; depth++ {
		if value := v.Key(key); !value.IsNull() {
			return value
		}
		v = v.Key("Parent")
	}
	return pdf.Value{}
}
