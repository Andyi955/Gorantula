package document

import (
	"strings"
	"unicode"
)

// ChunkText intelligently splits a large text into chunks of at most `limit` runes,
// attempting to break on whitespace to avoid slicing words in half.
// It skips chunks that contain only whitespace and respects `maxChunks`.
func ChunkText(text string, limit int, maxChunks int) []string {
	if limit <= 0 || maxChunks <= 0 {
		return nil
	}

	runes := []rune(text)
	totalRunes := len(runes)
	var chunks []string

	start := 0
	for start < totalRunes && len(chunks) < maxChunks {
		// Skip leading whitespace to prevent chunks consisting mostly of spaces
		for start < totalRunes && unicode.IsSpace(runes[start]) {
			start++
		}

		if start >= totalRunes {
			break
		}

		end := start + limit

		if end >= totalRunes {
			end = totalRunes
		} else {
			// Try to find a whitespace character to break on, looking backwards from `end`
			lookback := limit / 5
			if lookback < 20 { // Allow generous lookback for small test strings
				lookback = limit
			}
			searchBound := end - lookback
			if searchBound < start {
				searchBound = start
			}

			breakPoint := end
			for i := end - 1; i >= searchBound; i-- {
				if unicode.IsSpace(runes[i]) {
					breakPoint = i + 1 // Break after the whitespace
					break
				}
			}
			end = breakPoint
		}

		chunkStr := string(runes[start:end])
		cleanChunk := strings.TrimSpace(chunkStr)
		if cleanChunk != "" { // Drop purely empty chunks
			chunks = append(chunks, cleanChunk) // Trim edges so Gemini doesn't get weird whitespace
		}

		start = end
	}

	return chunks
}
