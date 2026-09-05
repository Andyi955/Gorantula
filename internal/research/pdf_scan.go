package research

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	"github.com/Andyi955/Gorantula/models"
)

//go:embed pdf_ocr_windows.ps1
var windowsOCRScript []byte

type ocrOutput struct {
	Pages   []models.OCRPage `json:"pages"`
	Engine  string           `json:"engine"`
	Version string           `json:"version"`
}

// This runs a fixed embedded adapter with generated local paths and validated
// integers only. Neither document text nor agent content becomes shell code.
func scanPDF(ctx context.Context, data []byte, call models.DatasetCall) (ocrOutput, error) {
	var out ocrOutput
	if runtime.GOOS != "windows" {
		return out, fmt.Errorf("local PDF OCR currently requires Windows 10/11 with an installed OCR language")
	}
	if err := validatePDFLayoutCall(call); err != nil {
		return out, err
	}
	if len(data) > maxPDFBytes || !bytes.HasPrefix(data, []byte("%PDF-")) {
		return out, fmt.Errorf("expected a PDF up to 10 MiB")
	}
	ctx, cancel := context.WithTimeout(ctx, 75*time.Second)
	defer cancel()
	dir, err := os.MkdirTemp("", "gorantula-ocr-")
	if err != nil {
		return out, err
	}
	defer os.RemoveAll(dir)
	script, input := filepath.Join(dir, "ocr.ps1"), filepath.Join(dir, "source.pdf")
	if err = os.WriteFile(script, windowsOCRScript, 0600); err != nil {
		return out, err
	}
	if err = os.WriteFile(input, data, 0600); err != nil {
		return out, err
	}
	end := call.EndPage
	if end == 0 {
		end = call.Page
	}
	// Resolve the system executable, never an executable named by the model or PDF.
	shell := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	cmd := exec.CommandContext(ctx, shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-InputPDF", input, "-FirstPage", strconv.Itoa(call.Page), "-LastPage", strconv.Itoa(end), "-Rotation", strconv.Itoa(call.Rotation))
	hideOCRWindow(cmd)
	var stdout, stderr boundedOCROutput
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err = cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		return out, fmt.Errorf("local OCR failed: %s", stderr.String())
	}
	if err = json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return out, fmt.Errorf("invalid OCR output: %w", err)
	}
	if len(out.Pages) != end-call.Page+1 {
		return out, fmt.Errorf("OCR returned an incomplete page range")
	}
	return out, nil
}

type boundedOCROutput struct{ bytes.Buffer }

func (b *boundedOCROutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 2<<20 {
		return 0, fmt.Errorf("OCR output exceeds 2 MiB")
	}
	return b.Buffer.Write(p)
}

const maxPDFBytes = 10 << 20
