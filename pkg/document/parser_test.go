package document

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTruncateContent(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		limit    int
		expected string
	}{
		{
			name:     "no truncation needed",
			content:  "hello world",
			limit:    20,
			expected: "hello world",
		},
		{
			name:     "truncate ascii",
			content:  "hello world",
			limit:    5,
			expected: "hello",
		},
		{
			name:     "truncate multi-byte (chinese)",
			content:  "你好世界",
			limit:    2,
			expected: "你好",
		},
		{
			name:     "truncate multi-byte mixed",
			content:  "hello你好world世界", // 5 + 2 + 5 + 2 = 14 runes
			limit:    6,
			expected: "hello你",
		},
		{
			name:     "zero limit",
			content:  "hello world",
			limit:    0,
			expected: "hello world", // Should return full if limited to <= 0 (unlimited)
		},
		{
			name:     "negative limit",
			content:  "hello world",
			limit:    -5,
			expected: "hello world",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := TruncateContent(tt.content, tt.limit)
			if got != tt.expected {
				t.Errorf("TruncateContent() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestParseTXT(t *testing.T) {
	tempDir := t.TempDir()

	tests := []struct {
		name          string
		createFile    func() string
		limit         int
		expectedText  string
		expectedError string
	}{
		{
			name: "valid text file",
			createFile: func() string {
				path := filepath.Join(tempDir, "valid.txt")
				os.WriteFile(path, []byte("Hello World!"), 0644)
				return path
			},
			limit:        5,
			expectedText: "Hello",
		},
		{
			name: "valid multi-byte text file",
			createFile: func() string {
				path := filepath.Join(tempDir, "valid_mb.txt")
				os.WriteFile(path, []byte("こんにちは世界"), 0644)
				return path
			},
			limit:        2,
			expectedText: "こん",
		},
		{
			name: "empty file",
			createFile: func() string {
				path := filepath.Join(tempDir, "empty.txt")
				os.WriteFile(path, []byte(""), 0644)
				return path
			},
			limit:         10,
			expectedError: "txt file is empty or contains only whitespace",
		},
		{
			name: "whitespace only file",
			createFile: func() string {
				path := filepath.Join(tempDir, "space.txt")
				os.WriteFile(path, []byte("   \n \t "), 0644)
				return path
			},
			limit:         10,
			expectedError: "txt file is empty or contains only whitespace",
		},
		{
			name: "file not found",
			createFile: func() string {
				return filepath.Join(tempDir, "notfound.txt")
			},
			limit:         10,
			expectedError: "failed to read txt file",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := tt.createFile()
			got, err := ParseTXT(path, tt.limit)

			if tt.expectedError != "" {
				if err == nil || !strings.Contains(err.Error(), tt.expectedError) {
					t.Errorf("ParseTXT() error = %v, want substring %v", err, tt.expectedError)
				}
				return
			}

			if err != nil {
				t.Errorf("ParseTXT() unexpected error = %v", err)
				return
			}

			if got != tt.expectedText {
				t.Errorf("ParseTXT() = %v, want %v", got, tt.expectedText)
			}
		})
	}
}

func TestParseDOCX(t *testing.T) {
	tempDir := t.TempDir()

	tests := []struct {
		name          string
		createFile    func() string
		limit         int
		expectedText  string
		expectedError string
	}{
		{
			name: "valid docx file",
			createFile: func() string {
				path := filepath.Join(tempDir, "valid.docx")
				f, _ := os.Create(path)
				zw := zip.NewWriter(f)
				w, _ := zw.Create("word/document.xml")
				// Simulated DOCX XML structure with paragraphs
				xmlData := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:p><w:r><w:t>World</w:t></w:r></w:p></w:body></w:document>`
				w.Write([]byte(xmlData))
				zw.Close()
				f.Close()
				return path
			},
			limit:        20,
			expectedText: "Hello World",
		},
		{
			name: "empty docx file (0 bytes)",
			createFile: func() string {
				path := filepath.Join(tempDir, "empty.docx")
				os.WriteFile(path, []byte{}, 0644)
				return path
			},
			limit:         10,
			expectedError: "docx file is empty",
		},
		{
			name: "invalid docx archive",
			createFile: func() string {
				path := filepath.Join(tempDir, "invalid.docx")
				os.WriteFile(path, []byte("not a zip file"), 0644)
				return path
			},
			limit:         10,
			expectedError: "failed to open docx zip reader",
		},
		{
			name: "missing word/document.xml",
			createFile: func() string {
				path := filepath.Join(tempDir, "missing_xml.docx")
				f, _ := os.Create(path)
				zw := zip.NewWriter(f)
				w, _ := zw.Create("other.xml")
				w.Write([]byte("<test/>"))
				zw.Close()
				f.Close()
				return path
			},
			limit:         10,
			expectedError: "word/document.xml not found in docx archive",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := tt.createFile()
			got, err := ParseDOCX(path, tt.limit)

			if tt.expectedError != "" {
				if err == nil || !strings.Contains(err.Error(), tt.expectedError) {
					t.Errorf("ParseDOCX() error = %v, want substring %v", err, tt.expectedError)
				}
				return
			}

			if err != nil {
				t.Errorf("ParseDOCX() unexpected error = %v", err)
				return
			}

			if got != tt.expectedText {
				t.Errorf("ParseDOCX() = '%v', want '%v'", got, tt.expectedText)
			}
		})
	}
}

func TestParsePDF(t *testing.T) {
	tempDir := t.TempDir()

	tests := []struct {
		name          string
		createFile    func() string
		limit         int
		expectedText  string
		expectedError string
	}{
		{
			name: "empty pdf file (0 bytes)",
			createFile: func() string {
				path := filepath.Join(tempDir, "empty.pdf")
				os.WriteFile(path, []byte{}, 0644)
				return path
			},
			limit:         10,
			expectedError: "pdf file is empty",
		},
		{
			name: "file not found",
			createFile: func() string {
				return filepath.Join(tempDir, "notfound.pdf")
			},
			limit:         10,
			expectedError: "failed to stat pdf file",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := tt.createFile()
			got, err := ParsePDF(path, tt.limit)

			if tt.expectedError != "" {
				if err == nil || !strings.Contains(err.Error(), tt.expectedError) {
					t.Errorf("ParsePDF() error = %v, want substring %v", err, tt.expectedError)
				}
				return
			}

			if err != nil {
				t.Errorf("ParsePDF() unexpected error = %v", err)
				return
			}

			if got != tt.expectedText {
				t.Errorf("ParsePDF() = %v, want %v", got, tt.expectedText)
			}
		})
	}
}
