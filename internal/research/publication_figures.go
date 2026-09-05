package research

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"sort"

	"github.com/Andyi955/Gorantula/models"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// Render recorded values locally, without asking a model to invent pixels or data.
// Group means share a zero baseline; unrelated metrics use a table, not a misleading common axis.
func publicationFigurePNG(f models.PublicationFigure) ([]byte, error) {
	rows := len(f.Data) + len(f.Metrics)
	if rows == 0 || rows > 128 {
		return nil, fmt.Errorf("figure requires 1 to 128 recorded values")
	}
	faceData, err := opentype.Parse(goregular.TTF)
	if err != nil {
		return nil, err
	}
	face, err := opentype.NewFace(faceData, &opentype.FaceOptions{Size: 20, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		return nil, err
	}
	defer face.Close()
	canvas := image.NewRGBA(image.Rect(0, 0, 1100, 180+rows*60))
	draw.Draw(canvas, canvas.Bounds(), image.NewUniform(color.RGBA{11, 20, 28, 255}), image.Point{}, draw.Src)
	ink := image.NewUniform(color.RGBA{211, 228, 238, 255})
	accent := image.NewUniform(color.RGBA{117, 216, 202, 255})
	text := func(x, y int, value string) {
		d := font.Drawer{Dst: canvas, Src: ink, Face: face, Dot: fixed.P(x, y)}
		d.DrawString(value)
	}
	label := func(value string, maxWidth int) string {
		chars := []rune(value)
		for len(chars) > 0 && font.MeasureString(face, string(chars)).Ceil() > maxWidth {
			chars = chars[:len(chars)-1]
		}
		if len(chars) < len([]rune(value)) && len(chars) > 3 {
			return string(chars[:len(chars)-3]) + "..."
		}
		return string(chars)
	}
	text(32, 38, "Recorded results")
	text(32, 70, label(f.Title, 1020))
	scale := 0.0
	for _, g := range f.Data {
		if math.IsNaN(g.Mean) || math.IsInf(g.Mean, 0) {
			return nil, fmt.Errorf("non-finite group mean")
		}
		scale = math.Max(scale, math.Abs(g.Mean))
	}
	if scale == 0 {
		scale = 1
	}
	if len(f.Data) > 0 {
		draw.Draw(canvas, image.Rect(650, 94, 652, 100+60*len(f.Data)), ink, image.Point{}, draw.Src)
	}
	for i, g := range f.Data {
		y := 110 + i*60
		text(32, y+18, label(g.Name, 290))
		text(330, y+18, fmt.Sprintf("n=%d", g.Count))
		width := int(math.Abs(g.Mean) / scale * 180)
		left, right := 652, 652+width
		if g.Mean < 0 {
			left, right = 650-width, 650
		}
		draw.Draw(canvas, image.Rect(left, y, right, y+26), accent, image.Point{}, draw.Src)
		text(860, y+20, fmt.Sprintf("%.8g", g.Mean))
	}
	keys := make([]string, 0, len(f.Metrics))
	for key := range f.Metrics {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for i, key := range keys {
		value := f.Metrics[key]
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, fmt.Errorf("non-finite metric")
		}
		y := 130 + (len(f.Data)+i)*60
		text(32, y, label(key, 690))
		text(800, y, fmt.Sprintf("%.8g", value))
	}
	text(32, canvas.Bounds().Dy()-30, "Sample estimates only. Bars show means from zero; no uncertainty bars are inferred.")
	var b bytes.Buffer
	if err := png.Encode(&b, canvas); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}
