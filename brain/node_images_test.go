package brain

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/models"
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

func TestPersistReviewedRemoteNodeImagesKeepsOnlyApprovedImages(t *testing.T) {
	vaultID := "reviewed-image-vault"
	t.Cleanup(func() {
		_ = os.RemoveAll(filepath.Join("abdomen_vault", vaultID))
	})

	brain := &Brain{}
	provider := &MockProvider{
		NameFunc: func() string { return "mock-reviewer" },
		ReviewImageJSONFunc: func(ctx context.Context, prompt, mimeType string, imageData []byte, target interface{}) error {
			review := target.(*models.ImageReviewResult)
			if strings.Contains(prompt, "Node Summary: Evidence summary") {
				*review = models.ImageReviewResult{
					Keep:    true,
					Reason:  "Directly relevant evidence image.",
					Caption: "Approved evidence",
				}
			}
			return nil
		},
	}

	results, reviewSucceeded := brain.persistReviewedRemoteNodeImages(
		context.Background(),
		provider,
		vaultID,
		"node-1",
		"https://example.com/article",
		"Evidence node",
		"Evidence summary",
		"Detailed article text",
		[]downloadedRemoteNodeImage{
			{
				fileName:  "evidence.png",
				sourceURL: "https://cdn.example.com/evidence.png",
				mimeType:  "image/png",
				payload:   []byte("not-a-real-image-but-storeable"),
			},
		},
	)
	if !reviewSucceeded {
		t.Fatalf("expected image review to succeed")
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 approved image, got %d", len(results))
	}
	if results[0].Caption != "Approved evidence" {
		t.Fatalf("expected reviewed caption to be persisted, got %q", results[0].Caption)
	}
}

func TestImageReviewCandidateLimitDefaultsLowAndCanBeRaised(t *testing.T) {
	if got := imageReviewCandidateLimit(); got != 1 {
		t.Fatalf("default image review candidate limit = %d, want 1", got)
	}

	t.Setenv("GORANTULA_IMAGE_REVIEW_CANDIDATE_LIMIT", "3")
	if got := imageReviewCandidateLimit(); got != 3 {
		t.Fatalf("configured image review candidate limit = %d, want 3", got)
	}

	t.Setenv("GORANTULA_IMAGE_REVIEW_CANDIDATE_LIMIT", "99")
	if got := imageReviewCandidateLimit(); got != maxNodeImageCount {
		t.Fatalf("image review candidate limit should clamp to max node images, got %d", got)
	}
}

func TestAttachManualNodeImageRejectsUnsupportedImageType(t *testing.T) {
	brain := &Brain{}
	_, err := brain.AttachManualNodeImage(
		"test-image-vault",
		"node-123",
		"evidence.svg",
		"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
		"Vector image",
	)
	if err == nil || !strings.Contains(err.Error(), "unsupported image type") {
		t.Fatalf("expected unsupported image type error, got %v", err)
	}
}
