package brain

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"spider-agent/models"
)

const (
	maxNodeImageCount = 3
	maxNodeImageBytes = 8 << 20
	maxNodeImageRedirects = 3
)

func assetURLForVaultImage(vaultID, fileName string) string {
	return fmt.Sprintf("http://localhost:8080/vault-assets/%s/images/%s", url.PathEscape(vaultID), url.PathEscape(fileName))
}

func sanitizeAssetFilePart(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "asset"
	}

	var builder strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r + ('a' - 'A'))
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '-' || r == '_':
			builder.WriteRune(r)
		default:
			builder.WriteRune('-')
		}
	}

	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "asset"
	}

	return result
}

func imageExtensionFromMimeType(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ""
	}
}

func nodeImagesDir(vaultID string) (string, error) {
	if vaultID == "" || filepath.Base(vaultID) != vaultID || strings.ContainsAny(vaultID, `/\`) {
		return "", fmt.Errorf("invalid vault id")
	}
	directory := filepath.Join("abdomen_vault", vaultID, "images")
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return "", err
	}
	return directory, nil
}

func isBlockedRemoteImageHost(hostname string) bool {
	normalizedHost := strings.ToLower(strings.TrimSpace(hostname))
	if normalizedHost == "" || normalizedHost == "localhost" {
		return true
	}

	ip := net.ParseIP(normalizedHost)
	if ip == nil {
		return false
	}

	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() {
		return true
	}

	if ipv4 := ip.To4(); ipv4 != nil {
		switch {
		case ipv4[0] == 10:
			return true
		case ipv4[0] == 127:
			return true
		case ipv4[0] == 169 && ipv4[1] == 254:
			return true
		case ipv4[0] == 172 && ipv4[1] >= 16 && ipv4[1] <= 31:
			return true
		case ipv4[0] == 192 && ipv4[1] == 168:
			return true
		}
		return false
	}

	if strings.HasPrefix(normalizedHost, "fc") || strings.HasPrefix(normalizedHost, "fd") {
		return true
	}
	if strings.HasPrefix(normalizedHost, "fe80:") {
		return true
	}

	return false
}

func isSafeRemoteImageURL(rawURL string) bool {
	parsedURL, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}

	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return false
	}

	if parsedURL.Hostname() == "" {
		return false
	}

	return !isBlockedRemoteImageHost(parsedURL.Hostname())
}

func decodeImageMetadata(payload []byte, mimeType string) (int, int) {
	config, _, err := image.DecodeConfig(bytes.NewReader(payload))
	if err != nil {
		return 0, 0
	}
	return config.Width, config.Height
}

func (b *Brain) storeNodeImage(vaultID, nodeID, fileName, sourceURL, caption, origin, mimeType string, payload []byte) (models.MemoryNodeImage, error) {
	imagesDir, err := nodeImagesDir(vaultID)
	if err != nil {
		return models.MemoryNodeImage{}, err
	}

	extension := strings.ToLower(filepath.Ext(fileName))
	if extension == "" {
		extension = imageExtensionFromMimeType(mimeType)
	}
	if extension == "" {
		extension = ".jpg"
	}

	safeFileName := fmt.Sprintf(
		"%s-%s-%d%s",
		sanitizeAssetFilePart(nodeID),
		sanitizeAssetFilePart(origin),
		time.Now().UnixNano(),
		extension,
	)
	filePath := filepath.Join(imagesDir, safeFileName)
	if err := os.WriteFile(filePath, payload, 0o644); err != nil {
		return models.MemoryNodeImage{}, err
	}

	width, height := decodeImageMetadata(payload, mimeType)

	return models.MemoryNodeImage{
		ID:        strings.TrimSuffix(safeFileName, extension),
		Path:      assetURLForVaultImage(vaultID, safeFileName),
		SourceURL: sourceURL,
		Caption:   caption,
		Origin:    origin,
		MimeType:  mimeType,
		Width:     width,
		Height:    height,
	}, nil
}

func (b *Brain) PersistRemoteNodeImages(ctx context.Context, vaultID, nodeID string, imageURLs []string) []models.MemoryNodeImage {
	if vaultID == "" || len(imageURLs) == 0 {
		return nil
	}

	client := &http.Client{
		Timeout: 12 * time.Second,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= maxNodeImageRedirects {
				return fmt.Errorf("stopped after %d redirects", maxNodeImageRedirects)
			}
			if !isSafeRemoteImageURL(request.URL.String()) {
				return fmt.Errorf("blocked redirect target")
			}
			return nil
		},
	}
	results := make([]models.MemoryNodeImage, 0, maxNodeImageCount)
	seen := make(map[string]struct{}, len(imageURLs))

	for _, imageURL := range imageURLs {
		imageURL = strings.TrimSpace(imageURL)
		if imageURL == "" {
			continue
		}
		if !isSafeRemoteImageURL(imageURL) {
			continue
		}
		if _, ok := seen[imageURL]; ok {
			continue
		}
		seen[imageURL] = struct{}{}

		request, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
		if err != nil {
			continue
		}
		request.Header.Set("User-Agent", "Gorantula/1.0")

		response, err := client.Do(request)
		if err != nil {
			continue
		}
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			continue
		}

		mimeType := strings.ToLower(strings.TrimSpace(response.Header.Get("Content-Type")))
		if strings.Contains(mimeType, ";") {
			mimeType = strings.TrimSpace(strings.SplitN(mimeType, ";", 2)[0])
		}
		if !strings.HasPrefix(mimeType, "image/") {
			response.Body.Close()
			continue
		}

		payload, err := io.ReadAll(io.LimitReader(response.Body, maxNodeImageBytes+1))
		response.Body.Close()
		if err != nil || len(payload) == 0 || len(payload) > maxNodeImageBytes {
			continue
		}

		stored, err := b.storeNodeImage(vaultID, nodeID, filepath.Base(request.URL.Path), imageURL, "", "scraped", mimeType, payload)
		if err != nil {
			continue
		}
		results = append(results, stored)
		if len(results) >= maxNodeImageCount {
			break
		}
	}

	return results
}

func decodeDataURL(dataURL string) ([]byte, string, error) {
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return nil, "", fmt.Errorf("invalid data url")
	}
	header := parts[0]
	payload := parts[1]
	if !strings.HasPrefix(header, "data:") || !strings.Contains(header, ";base64") {
		return nil, "", fmt.Errorf("unsupported data url")
	}

	mimeType := strings.TrimSpace(strings.SplitN(strings.TrimPrefix(header, "data:"), ";", 2)[0])
	decoded, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, "", err
	}
	if len(decoded) == 0 || len(decoded) > maxNodeImageBytes {
		return nil, "", fmt.Errorf("image payload invalid size")
	}
	return decoded, mimeType, nil
}

func (b *Brain) AttachManualNodeImage(vaultID, nodeID, fileName, dataURL, caption string) (models.MemoryNodeImage, error) {
	payload, mimeType, err := decodeDataURL(dataURL)
	if err != nil {
		return models.MemoryNodeImage{}, err
	}

	if mimeType == "" {
		mimeType = mime.TypeByExtension(strings.ToLower(filepath.Ext(fileName)))
	}
	if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
		return models.MemoryNodeImage{}, fmt.Errorf("uploaded file is not an image")
	}

	return b.storeNodeImage(vaultID, nodeID, fileName, "", caption, "manual", mimeType, payload)
}
