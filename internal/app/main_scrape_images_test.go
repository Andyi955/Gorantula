package app

import "testing"

func TestExtractScrapeImagesPreference(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		msg  map[string]interface{}
		want bool
	}{
		{
			name: "defaults to false when unset",
			msg:  map[string]interface{}{},
			want: false,
		},
		{
			name: "reads true boolean preference",
			msg: map[string]interface{}{
				"scrapeImages": true,
			},
			want: true,
		},
		{
			name: "ignores non boolean values",
			msg: map[string]interface{}{
				"scrapeImages": "true",
			},
			want: false,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			if got := extractScrapeImagesPreference(test.msg); got != test.want {
				t.Fatalf("extractScrapeImagesPreference() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestExtractRabbitHoleDescentMode(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		msg  map[string]interface{}
		want string
	}{
		{
			name: "defaults to guided",
			msg:  map[string]interface{}{},
			want: "guided",
		},
		{
			name: "accepts max descent",
			msg: map[string]interface{}{
				"descentMode": "max",
			},
			want: "max",
		},
		{
			name: "trims guided",
			msg: map[string]interface{}{
				"descentMode": " guided ",
			},
			want: "guided",
		},
		{
			name: "rejects unknown mode",
			msg: map[string]interface{}{
				"descentMode": "forever",
			},
			want: "guided",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			if got := extractRabbitHoleDescentMode(test.msg); got != test.want {
				t.Fatalf("extractRabbitHoleDescentMode() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestExtractRabbitHoleRunOptions(t *testing.T) {
	t.Parallel()

	options := extractRabbitHoleRunOptions(map[string]interface{}{
		"continuationPass": float64(2),
		"priorFindings": []interface{}{
			"Pass 1 summary: prior report",
			"",
			17,
		},
		"suggestedQueries": []interface{}{
			"Meta Richland Parish water permit",
		},
	})

	if options.ContinuationPass != 2 {
		t.Fatalf("ContinuationPass = %d, want 2", options.ContinuationPass)
	}
	if len(options.PriorFindings) != 1 || options.PriorFindings[0] != "Pass 1 summary: prior report" {
		t.Fatalf("PriorFindings = %#v", options.PriorFindings)
	}
	if len(options.SuggestedQueries) != 1 || options.SuggestedQueries[0] != "Meta Richland Parish water permit" {
		t.Fatalf("SuggestedQueries = %#v", options.SuggestedQueries)
	}
}
