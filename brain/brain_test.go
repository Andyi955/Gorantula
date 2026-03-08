package brain

import (
	"testing"
)

func TestValidateSubQueries(t *testing.T) {
	brain := &Brain{}

	tests := []struct {
		name          string
		inputQueries  []string
		minCount      int
		maxCount      int
		expectError   bool
	}{
		{
			name:          "Exactly 8 queries",
			inputQueries:  []string{"q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"},
			minCount:      8,
			maxCount:      8,
			expectError:   false,
		},
		{
			name:          "Fewer than 4 - must pad",
			inputQueries:  []string{"q1"},
			minCount:      4,
			maxCount:      4,
			expectError:   false,
		},
		{
			name:          "More than 12 - must truncate",
			inputQueries:  []string{"q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "q11", "q12", "q13"},
			minCount:      12,
			maxCount:      12,
			expectError:   false,
		},
		{
			name:          "No queries - must error",
			inputQueries:  []string{},
			minCount:      0,
			maxCount:      0,
			expectError:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			subQ := SubQueries{Queries: tt.inputQueries}
			err := brain.ValidateSubQueries(&subQ)

			if (err != nil) != tt.expectError {
				t.Errorf("ValidateSubQueries() error = %v; expectError %v", err, tt.expectError)
				return
			}

			if !tt.expectError {
				if len(subQ.Queries) < tt.minCount || len(subQ.Queries) > tt.maxCount {
					t.Errorf("ValidateSubQueries() count = %d; want between %d and %d", len(subQ.Queries), tt.minCount, tt.maxCount)
				}
			}
		})
	}
}
