package document

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/ledongthuc/pdf"
)

// ParseTXT reads a text file and returns its content truncated to the rune limit.
func ParseTXT(path string, limit int) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("failed to read txt file: %w", err)
	}

	content := string(data)
	if len(strings.TrimSpace(content)) == 0 {
		return "", fmt.Errorf("txt file is empty or contains only whitespace")
	}

	return TruncateContent(content, limit), nil
}

// ParsePDF reads a PDF file and returns its text content truncated to the rune limit.
func ParsePDF(path string, limit int) (string, error) {
	fileInfo, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("failed to stat pdf file: %w", err)
	}
	if fileInfo.Size() == 0 {
		return "", fmt.Errorf("pdf file is empty")
	}

	f, r, err := pdf.Open(path)
	if err != nil {
		return "", fmt.Errorf("failed to open pdf file: %w", err)
	}
	defer f.Close()

	var buf bytes.Buffer
	b, err := r.GetPlainText()
	if err != nil {
		return "", fmt.Errorf("failed to read pdf text: %w", err)
	}
	_, err = buf.ReadFrom(b)
	if err != nil {
		return "", fmt.Errorf("failed to parse pdf text stream: %w", err)
	}

	content := buf.String()
	if len(strings.TrimSpace(content)) == 0 {
		return "", fmt.Errorf("pdf file contains no readable text")
	}

	return TruncateContent(content, limit), nil
}

// ParseDOCX reads a DOCX file (zip archive) and extracts the text from word/document.xml.
func ParseDOCX(path string, limit int) (string, error) {
	fileInfo, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("failed to stat docx file: %w", err)
	}
	if fileInfo.Size() == 0 {
		return "", fmt.Errorf("docx file is empty")
	}

	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", fmt.Errorf("failed to open docx zip reader: %w", err)
	}
	defer zr.Close()

	var documentXML *zip.File
	for _, f := range zr.File {
		if f.Name == "word/document.xml" {
			documentXML = f
			break
		}
	}

	if documentXML == nil {
		return "", fmt.Errorf("word/document.xml not found in docx archive")
	}

	rc, err := documentXML.Open()
	if err != nil {
		return "", fmt.Errorf("failed to open word/document.xml: %w", err)
	}
	defer rc.Close()

	content, err := extractTextFromXML(rc)
	if err != nil {
		return "", fmt.Errorf("failed to extract text from docx xml: %w", err)
	}

	if len(strings.TrimSpace(content)) == 0 {
		return "", fmt.Errorf("docx file contains no readable text")
	}

	return TruncateContent(content, limit), nil
}

// extractTextFromXML strips XML tags and gathers inner text
func extractTextFromXML(r io.Reader) (string, error) {
	var buf strings.Builder
	decoder := xml.NewDecoder(r)

	for {
		t, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}

		switch se := t.(type) {
		case xml.CharData:
			buf.WriteString(string(se))
		case xml.StartElement:
			// Add space for new paragraphs to prevent words squishing
			if se.Name.Local == "p" || se.Name.Local == "br" {
				buf.WriteString(" ")
			}
		}
	}

	// Collapse multiple spaces into one to clean up
	return strings.Join(strings.Fields(buf.String()), " "), nil
}

// TruncateContent caps string length by runes to ensure UTF-8 safety
func TruncateContent(content string, limit int) string {
	if limit <= 0 {
		return content
	}
	runes := []rune(content)
	if len(runes) > limit {
		fmt.Printf("[Warning] Document content length (%d runes) exceeded limit (%d), truncating...\n", len(runes), limit)
		return string(runes[:limit])
	}
	return content
}
