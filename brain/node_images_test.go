package brain

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAttachManualNodeImage(t *testing.T) {
	vaultID := "test-image-vault"
	t.Cleanup(func() {
		_ = os.RemoveAll(filepath.Join("abdomen_vault", vaultID))
	})

	brain := &Brain{}
	image, err := brain.AttachManualNodeImage(
		vaultID,
		"node-123",
		"evidence.png",
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s5lH3wAAAAASUVORK5CYII=",
		"Evidence image",
	)
	if err != nil {
		t.Fatalf("AttachManualNodeImage returned error: %v", err)
	}

	if image.Origin != "manual" {
		t.Fatalf("expected manual origin, got %q", image.Origin)
	}
	if image.Caption != "Evidence image" {
		t.Fatalf("expected caption to round-trip")
	}
	if !strings.Contains(image.Path, "/vault-assets/"+vaultID+"/images/") {
		t.Fatalf("unexpected asset path: %s", image.Path)
	}

	matches, err := filepath.Glob(filepath.Join("abdomen_vault", vaultID, "images", "node-123-manual-*"))
	if err != nil {
		t.Fatalf("glob failed: %v", err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected one stored image file, found %d", len(matches))
	}
}

func TestIsSafeRemoteImageURL(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		url  string
		want bool
	}{
		{name: "allows public https host", url: "https://example.com/image.png", want: true},
		{name: "blocks localhost", url: "http://localhost:8080/image.png", want: false},
		{name: "blocks loopback ip", url: "http://127.0.0.1/image.png", want: false},
		{name: "blocks private ip", url: "http://192.168.1.12/image.png", want: false},
		{name: "blocks link local ip", url: "http://169.254.169.254/latest/meta-data", want: false},
		{name: "blocks unsupported scheme", url: "file:///tmp/test.png", want: false},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			if got := isSafeRemoteImageURL(test.url); got != test.want {
				t.Fatalf("isSafeRemoteImageURL(%q) = %v, want %v", test.url, got, test.want)
			}
		})
	}
}
