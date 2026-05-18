package brain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"spider-agent/models"
)

const (
	nodeSummaryCacheBucket        = "node_summaries"
	imageReviewCacheBucket        = "image_reviews"
	nodeSummaryCacheSchemaVersion = "node-summary-v1"
	imageReviewCacheSchemaVersion = "scraped-image-review-v1"
)

// AnalysisCache stores source-level, investigation-neutral AI work.
//
// Keep this cache below source processing only. Relationship synthesis,
// discoveries, personas, and overlap judgments depend on the current board and
// must be recomputed for each investigation.
type AnalysisCache struct {
	root string
	mu   sync.Mutex
}

type nodeSummaryCacheEntry struct {
	Task          string `json:"task"`
	SchemaVersion string `json:"schemaVersion"`
	Provider      string `json:"provider"`
	ContentHash   string `json:"contentHash"`
	PromptHash    string `json:"promptHash"`
	Title         string `json:"title"`
	Summary       string `json:"summary"`
	CreatedAt     string `json:"createdAt"`
}

type imageReviewCacheEntry struct {
	Task          string                   `json:"task"`
	SchemaVersion string                   `json:"schemaVersion"`
	Provider      string                   `json:"provider"`
	ImageHash     string                   `json:"imageHash"`
	PromptHash    string                   `json:"promptHash"`
	MimeType      string                   `json:"mimeType"`
	Review        models.ImageReviewResult `json:"review"`
	CreatedAt     string                   `json:"createdAt"`
}

func NewAnalysisCache(root string) *AnalysisCache {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil
	}
	return &AnalysisCache{root: root}
}

func defaultAnalysisCacheDir() string {
	if configured := strings.TrimSpace(os.Getenv("GORANTULA_ANALYSIS_CACHE_DIR")); configured != "" {
		return configured
	}
	return filepath.Join("abdomen_vault", ".analysis_cache")
}

func hashString(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func hashBytes(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func normalizeCacheText(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return strings.TrimSpace(value)
}

func cacheKey(parts ...string) string {
	return hashString(strings.Join(parts, "\x00"))
}

func (c *AnalysisCache) cachePath(bucket, key string) (string, bool) {
	if c == nil || strings.TrimSpace(c.root) == "" || strings.TrimSpace(bucket) == "" || strings.TrimSpace(key) == "" {
		return "", false
	}
	return filepath.Join(c.root, bucket, key+".json"), true
}

func (c *AnalysisCache) read(bucket, key string, target interface{}) bool {
	path, ok := c.cachePath(bucket, key)
	if !ok {
		return false
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return json.Unmarshal(data, target) == nil
}

func (c *AnalysisCache) write(bucket, key string, value interface{}) {
	path, ok := c.cachePath(bucket, key)
	if !ok {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(path, data, 0o644)
}

func (c *AnalysisCache) getNodeSummary(provider, contentHash, promptHash string) (string, string, bool) {
	key := cacheKey(nodeSummaryCacheSchemaVersion, provider, contentHash, promptHash)
	var entry nodeSummaryCacheEntry
	if !c.read(nodeSummaryCacheBucket, key, &entry) {
		return "", "", false
	}
	if entry.SchemaVersion != nodeSummaryCacheSchemaVersion ||
		entry.Provider != provider ||
		entry.ContentHash != contentHash ||
		entry.PromptHash != promptHash ||
		strings.TrimSpace(entry.Title) == "" ||
		strings.TrimSpace(entry.Summary) == "" {
		return "", "", false
	}
	return entry.Title, entry.Summary, true
}

func (c *AnalysisCache) saveNodeSummary(provider, contentHash, promptHash, title, summary string) {
	title = strings.TrimSpace(title)
	summary = strings.TrimSpace(summary)
	if title == "" || summary == "" {
		return
	}
	key := cacheKey(nodeSummaryCacheSchemaVersion, provider, contentHash, promptHash)
	c.write(nodeSummaryCacheBucket, key, nodeSummaryCacheEntry{
		Task:          "node_summary",
		SchemaVersion: nodeSummaryCacheSchemaVersion,
		Provider:      provider,
		ContentHash:   contentHash,
		PromptHash:    promptHash,
		Title:         title,
		Summary:       summary,
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
	})
}

func (c *AnalysisCache) getImageReview(provider, imageHash, promptHash, mimeType string) (models.ImageReviewResult, bool) {
	key := cacheKey(imageReviewCacheSchemaVersion, provider, imageHash, promptHash, mimeType)
	var entry imageReviewCacheEntry
	if !c.read(imageReviewCacheBucket, key, &entry) {
		return models.ImageReviewResult{}, false
	}
	if entry.SchemaVersion != imageReviewCacheSchemaVersion ||
		entry.Provider != provider ||
		entry.ImageHash != imageHash ||
		entry.PromptHash != promptHash ||
		entry.MimeType != mimeType {
		return models.ImageReviewResult{}, false
	}
	return sanitizeImageReview(entry.Review), true
}

func (c *AnalysisCache) saveImageReview(provider, imageHash, promptHash, mimeType string, review models.ImageReviewResult) {
	key := cacheKey(imageReviewCacheSchemaVersion, provider, imageHash, promptHash, mimeType)
	c.write(imageReviewCacheBucket, key, imageReviewCacheEntry{
		Task:          "scraped_image_review",
		SchemaVersion: imageReviewCacheSchemaVersion,
		Provider:      provider,
		ImageHash:     imageHash,
		PromptHash:    promptHash,
		MimeType:      mimeType,
		Review:        sanitizeImageReview(review),
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
	})
}

func sanitizeImageReview(review models.ImageReviewResult) models.ImageReviewResult {
	review.Reason = strings.TrimSpace(review.Reason)
	review.Caption = strings.TrimSpace(review.Caption)
	if !review.Keep {
		review.Caption = ""
	}
	return review
}

func providerCacheIdentity(provider ModelProvider) string {
	if provider == nil {
		return ""
	}
	switch typed := provider.(type) {
	case *OpenAICompatibleProvider:
		return typed.Name() + ":" + strings.TrimSpace(typed.Model)
	case *MiniMaxProvider:
		if typed.client != nil {
			return typed.Name() + ":" + strings.TrimSpace(typed.client.Model)
		}
	case *GeminiProvider:
		return typed.Name() + ":" + envOrDefault("GEMINI_MODEL", DefaultGeminiModel)
	}
	return provider.Name()
}
