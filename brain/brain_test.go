package brain

import (
	"testing"
)

func TestValidateSubQueries(t *testing.T) {
	brain := &Brain{}

	tests := []struct {
		name          string
		inputQueries  []string
		expectedCount int
		expectError   bool
	}{
		{
			name:          "Exactly 8 queries",
			inputQueries:  []string{"q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"},
			expectedCount: 8,
			expectError:   false,
		},
		{
			name:          "Fewer than 8 - must pad",
			inputQueries:  []string{"q1"},
			expectedCount: 8,
			expectError:   false,
		},
		{
			name:          "More than 8 - must truncate",
			inputQueries:  []string{"q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9"},
			expectedCount: 8,
			expectError:   false,
		},
		{
			name:          "No queries - must error",
			inputQueries:  []string{},
			expectedCount: 0,
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

			if !tt.expectError && len(subQ.Queries) != tt.expectedCount {
				t.Errorf("ValidateSubQueries() count = %d; want %d", len(subQ.Queries), tt.expectedCount)
			}
		})
	}
}
