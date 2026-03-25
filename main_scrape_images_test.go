package main

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
