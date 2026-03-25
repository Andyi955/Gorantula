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
