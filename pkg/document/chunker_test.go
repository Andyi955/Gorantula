package document

import (
	"reflect"
	"testing"
)

func TestChunkText(t *testing.T) {
	tests := []struct {
		name      string
		text      string
		limit     int
		maxChunks int
		want      []string
	}{
		{
			name:      "basic splitting perfectly fits",
			text:      "hello world",
			limit:     11,
			maxChunks: 5,
			want:      []string{"hello world"},
		},
		{
			name:      "empty chunk skipping", // EDGE CASE 3
			text:      "hello           world",
			limit:     6,
			maxChunks: 5,
			want:      []string{"hello", "world"},
		},
		{
			name:      "max chunks enforcement", // EDGE CASE 2
			text:      "a b c d e f g h i j",
			limit:     2,
			maxChunks: 3,
			want:      []string{"a", "b", "c"}, // Drops the rest
		},
		{
			name:      "multibyte unicode safety", // EDGE CASE 1
			text:      "世界你好",                     // 4 runes
			limit:     2,
			maxChunks: 5,
			want:      []string{"世界", "你好"},
		},
		{
			name:      "word boundary preservation", // EDGE CASE 1
			text:      "the quick brown fox",
			limit:     8,
			maxChunks: 5,
			want:      []string{"the", "quick", "brown", "fox"},
		},
		{
			name:      "zero or negative limits",
			text:      "hello",
			limit:     0,
			maxChunks: 5,
			want:      nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ChunkText(tt.text, tt.limit, tt.maxChunks); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("ChunkText() = %#v, want %#v", got, tt.want)
			}
		})
	}
}
