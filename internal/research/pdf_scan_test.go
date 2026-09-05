package research

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/Andyi955/Gorantula/models"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"
)

func TestNativePDFScan(t *testing.T) {
	if runtime.GOOS != "windows" || os.Getenv("GORANTULA_OCR_TEST") != "1" {
		t.Skip("set GORANTULA_OCR_TEST=1 for real Windows OCR")
	}
	out, err := scanPDFResult(context.Background(), researchFixturePDF(), models.DatasetCall{Tool: "paper-scan", Page: 1, URL: "fixture.pdf"})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Passages) != 1 || !strings.Contains(out.Passages[0].Text, "value") {
		t.Fatalf("unexpected OCR %+v", out)
	}
	t.Log(out.Passages[0].Text)
}

func TestNativeComplexTable(t *testing.T) {
	out, err := scanPDFResult(context.Background(), researchFixturePDF(), models.DatasetCall{Tool: "paper-complex-table", Page: 1, URL: "fixture.pdf"})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Tables) != 1 || len(out.Tables[0].Rows) != 5 || out.Tables[0].Rows[4][1] != "11" {
		t.Fatalf("bad native table %+v", out.Tables)
	}
	if out.ExtractionID == "" || len(out.Tables[0].CellSources) != 5 {
		t.Fatal("missing cell provenance")
	}
}

func scannedFixturePDF(rotations ...int) []byte {

	large := image.NewRGBA(image.Rect(0, 0, 1680, 800))
	draw.Draw(large, large.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	parsed, _ := opentype.Parse(goregular.TTF)
	face, _ := opentype.NewFace(parsed, &opentype.FaceOptions{Size: 36, DPI: 72, Hinting: font.HintingFull})
	defer face.Close()
	drawer := font.Drawer{Dst: large, Src: image.NewUniform(color.Black), Face: face}
	for i, row := range [][]string{{"SCANNED RESEARCH DATA", ""}, {"Sample", "Measurement"}, {"Control", "12.50"}, {"Treatment", "42.75"}, {"Total", "55.25"}} {
		for j, value := range row {
			drawer.Dot = fixed.P(60+j*590, 100+i*120)
			drawer.DrawString(value)
		}
	}
	if len(rotations) > 0 && rotations[0] == 180 {
		rotated := image.NewRGBA(large.Bounds())
		for y := 0; y < 800; y++ {
			for x := 0; x < 1680; x++ {
				rotated.Set(x, y, large.At(1679-x, 799-y))
			}
		}
		large = rotated
	}
	var jpg bytes.Buffer
	_ = jpeg.Encode(&jpg, large, &jpeg.Options{Quality: 100})
	stream := "q 630 0 0 300 0 0 cm /Im0 Do Q"
	objects := [][]byte{[]byte("<< /Type /Catalog /Pages 2 0 R >>"), []byte("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"), []byte("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 630 300] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"), append(append([]byte(fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width 1680 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n", jpg.Len())), jpg.Bytes()...), []byte("\nendstream")...), []byte(fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream))}
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	offsets := []int{}
	for i, obj := range objects {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n", i+1)
		b.Write(obj)
		b.WriteString("\nendobj\n")
	}
	start := b.Len()
	b.WriteString("xref\n0 6\n0000000000 65535 f \n")
	for _, n := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", n)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", start)
	return b.Bytes()
}

func TestImageOnlyPDFScan(t *testing.T) {
	if runtime.GOOS != "windows" || os.Getenv("GORANTULA_OCR_TEST") != "1" {
		t.Skip("real local Windows OCR test")
	}
	raw := scannedFixturePDF()
	if _, err := extractPDFPage(context.Background(), raw, "scan", 1); err == nil {
		t.Fatal("fixture unexpectedly has native text")
	}
	call := models.DatasetCall{Tool: "paper-scan", Page: 1, URL: "scan.pdf"}
	out, err := scanPDFResult(context.Background(), raw, call)
	if err != nil {
		t.Fatal(err)
	}
	text := out.Passages[0].Text
	t.Log(text)
	if !strings.Contains(text, "42.75") || !strings.Contains(text, "12.50") {
		t.Fatal("known scanned values not recognised")
	}
	rotated, rotationErr := scanPDFResult(context.Background(), scannedFixturePDF(180), models.DatasetCall{Tool: "paper-scan", Page: 1, Rotation: 180, URL: "rotated.pdf"})
	if rotationErr != nil || !strings.Contains(rotated.Passages[0].Text, "42.75") {
		t.Fatal("rotated scan", rotationErr)
	}
	call.Tool = "paper-complex-table"
	call.Region = []float64{0, 20, 100, 75}
	call.ColumnCuts = []float64{25}
	out, err = scanPDFResult(context.Background(), raw, call)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Tables) != 1 || len(out.Tables[0].Rows) != 4 || out.Tables[0].Rows[2][1] != "42.75" {
		t.Fatalf("scan table %+v", out.Tables)
	}
}

func TestComplexHeadersPagesAndAmbiguity(t *testing.T) {
	word := func(s string, x, y, w float64) models.OCRWord {
		return models.OCRWord{Text: s, X: x, Y: y, Width: w, Height: 2}
	}
	pages := []models.OCRPage{}
	for n := 1; n <= 2; n++ {
		pages = append(pages, models.OCRPage{Page: n, Words: []models.OCRWord{word("Group", 5, 5, 10), word("Measurements", 42, 5, 30), word("Before", 35, 9, 10), word("After", 65, 9, 10), word("Control", 5, 15, 10), word("12.50", 35, 15, 8), word("42.75", 65, 15, 8)}})
	}
	call := models.DatasetCall{Tool: "paper-complex-table", Page: 1, EndPage: 2, HeaderRows: 2, ColumnCuts: []float64{30, 60}}
	table, err := complexTable(pages, call)
	if err != nil {
		t.Fatal(err)
	}
	if len(table.Rows) != 3 || table.Rows[0][1] != "Measurements / Before" || table.Rows[0][2] != "Measurements / After" || table.CellSources[2][1].Page != 2 {
		t.Fatalf("multi-page headers %+v", table)
	}
	pages[1].Words[2].Text = "Different"
	if _, err := complexTable(pages, call); err == nil {
		t.Fatal("mismatched page headers silently joined")
	}
	for _, bad := range []models.DatasetCall{{Page: 0}, {Page: 1, EndPage: 5}, {Page: 1, Rotation: 45}, {Page: 1, ColumnCuts: []float64{60, 30}}, {Page: 1, Region: []float64{90, 0, 20, 100}}} {
		if validatePDFLayoutCall(bad) == nil {
			t.Fatalf("invalid layout accepted %+v", bad)
		}
	}
}

func TestLocalComplexTableSelectionAndSources(t *testing.T) {
	s, _ := verificationFixture(t)
	data := researchFixturePDF()
	id := digestBytes(data)
	url := "local-pdf:" + id
	if err := s.verificationStore("documents").saveSlice(id+".json", models.ResearchDocument{URL: url, Digest: id, Bytes: data}); err != nil {
		t.Fatal(err)
	}
	run := models.VerificationRun{}
	call := models.DatasetCall{Tool: "paper-complex-table", URL: url, Page: 1}
	result := s.executeDatasetCall(context.Background(), &run, call)
	if result.Error != "" {
		t.Fatal(result.Error)
	}
	run.DatasetActions = append(run.DatasetActions, result)
	save := models.DatasetCall{Tool: "paper-table", URL: url, Page: 1, TableIndex: 0, Rationale: "Known local PDF fixture"}
	if got := s.executeDatasetCall(context.Background(), &run, save); got.Error == "" {
		t.Fatal("unbound extraction ID accepted")
	}
	save.ExtractionID = result.ExtractionID
	got := s.executeDatasetCall(context.Background(), &run, save)
	if got.Error != "" || run.Dataset.Rows != 4 {
		t.Fatalf("save failed %+v", got)
	}
	if len(run.Documents) != 1 || digestBytes(run.Documents[0].Bytes) != id {
		t.Fatal("original PDF lost")
	}
	short := modelDatasetActions(run.DatasetActions)
	if len(short[0].OCRPages) != 0 || len(short[0].Tables[0].CellSources) != 0 || len(run.DatasetActions[0].Tables[0].CellSources) == 0 {
		t.Fatal("model summary mutated retained cell provenance")
	}
}

func TestPDFUploadAPI(t *testing.T) {
	s, _ := verificationFixture(t)
	data := researchFixturePDF()
	body, _ := json.Marshal(map[string]interface{}{"name": "fixture.pdf", "data": data})
	req := httptest.NewRequest("POST", "/api/research/datasets/pdf-files", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	if !handleVerificationAPI(w, req, s) || w.Code != 200 {
		t.Fatalf("upload %d %s", w.Code, w.Body.String())
	}
	var got map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["url"] != "local-pdf:"+digestBytes(data) {
		t.Fatal(got)
	}
	req = httptest.NewRequest("POST", "/api/research/datasets/pdf-files", strings.NewReader(`{"name":"bad.pdf","data":"bm90IHBkZg=="}`))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	handleVerificationAPI(w, req, s)
	if w.Code != 400 {
		t.Fatal("non-PDF accepted")
	}
}
