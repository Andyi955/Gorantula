package research

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"

	"github.com/Andyi955/Gorantula/models"
)

// Read only bounded document XML; external links, embedded objects and macros are never executed.
func extractDOCX(data []byte, source string) (models.DatasetResult, error) {
	out := models.DatasetResult{Engine: "native-docx", ExtractionID: digestBytes(data)}
	if bytes.Contains(bytes.ToLower(data[:min(len(data), 512)]), []byte("<html")) {
		return out, fmt.Errorf("source returned an HTML download/access page, not DOCX document bytes; an accessible document source is needed")
	}
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return out, fmt.Errorf("invalid DOCX archive: %w", err)
	}
	if len(z.File) > 2000 {
		return out, fmt.Errorf("DOCX has too many archive entries")
	}
	var document *zip.File
	for _, f := range z.File {
		if f.Name == "word/document.xml" {
			if document != nil {
				return out, fmt.Errorf("duplicate DOCX document XML")
			}
			document = f
		}
	}
	if document == nil {
		return out, fmt.Errorf("DOCX document XML missing")
	}
	const limit = 8 << 20
	if document.UncompressedSize64 > limit {
		return out, fmt.Errorf("DOCX document XML too large")
	}
	r, err := document.Open()
	if err != nil {
		return out, err
	}
	defer r.Close()
	x, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return out, err
	}
	if len(x) > limit {
		return out, fmt.Errorf("DOCX document XML too large")
	}
	d := xml.NewDecoder(bytes.NewReader(x))
	var text, cell strings.Builder
	var rows [][]string
	var row []string
	depth, tableIndex := 0, 0
	inCell, inText, ambiguous, root := false, false, false, false
	for {
		t, e := d.Token()
		if e == io.EOF {
			break
		}
		if e != nil {
			return out, fmt.Errorf("invalid DOCX XML: %w", e)
		}
		switch v := t.(type) {
		case xml.StartElement:
			if v.Name.Space != "http://schemas.openxmlformats.org/wordprocessingml/2006/main" && v.Name.Space != "http://purl.oclc.org/ooxml/wordprocessingml/main" {
				continue
			}
			switch v.Name.Local {
			case "document":
				root = true
			case "tbl":
				depth++
				if depth == 1 {
					rows = nil
					ambiguous = false
				} else {
					ambiguous = true
				}
			case "tr":
				if depth == 1 {
					row = nil
				}
			case "tc":
				if depth == 1 {
					inCell = true
					cell.Reset()
				}
			case "gridSpan", "vMerge", "hMerge", "gridBefore", "gridAfter", "del", "ins":
				if depth > 0 {
					ambiguous = true
				}
			case "t":
				inText = true
			case "tab", "br":
				text.WriteString(" ")
				if inCell {
					cell.WriteString(" ")
				}
			}
		case xml.CharData:
			if inText {
				text.Write(v)
				if inCell {
					cell.Write(v)
				}
			}
		case xml.EndElement:
			if v.Name.Space != "http://schemas.openxmlformats.org/wordprocessingml/2006/main" && v.Name.Space != "http://purl.oclc.org/ooxml/wordprocessingml/main" {
				continue
			}
			switch v.Name.Local {
			case "t":
				inText = false
			case "p":
				text.WriteString("\n")
				if inCell {
					cell.WriteString(" ")
				}
			case "tc":
				if depth == 1 {
					row = append(row, strings.TrimSpace(cell.String()))
					inCell = false
				}
			case "tr":
				if depth == 1 {
					rows = append(rows, row)
				}
			case "tbl":
				depth--
				if depth == 0 {
					valid := len(rows) >= 2 && len(rows[0]) > 0
					for _, row := range rows {
						if len(row) != len(rows[0]) {
							valid = false
						}
					}
					if len(rows) > 2000 || (len(rows) > 0 && len(rows[0]) > 64) || tableIndex >= 50 {
						return out, fmt.Errorf("DOCX table extraction exceeds bounded table/row/column limits")
					}
					if valid && !ambiguous {
						out.Tables = append(out.Tables, models.ExtractedTable{Index: tableIndex, Rows: rows})
					} else {
						out.Warnings = append(out.Warnings, fmt.Sprintf("Table %d cannot be saved automatically: merged/nested/revised cells or irregular rows require review.", tableIndex))
					}
					tableIndex++
				}
			}
		}
	}
	if !root {
		return out, fmt.Errorf("DOCX Word document element missing")
	}
	content := boundedPaperText(strings.TrimSpace(text.String()))
	out.Passages = []models.EvidencePassage{{Source: source, Digest: out.ExtractionID, Text: content}}
	out.Summary = fmt.Sprintf("Read DOCX text and %d rectangular table candidates. Tables may contain summary statistics, not raw observations. Verify the parent paper, topic, outcomes and study units before analysis.", len(out.Tables))
	out.Warnings = append(out.Warnings, "Extraction does not establish scientific reliability. Figures, equations and embedded files are not interpreted; document text may include tracked revisions.")
	return out, nil
}
