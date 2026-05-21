package assets

import "testing"

func TestIsAllowedVaultImageExtension(t *testing.T) {
	t.Parallel()

	tests := []struct {
		extension string
		want      bool
	}{
		{extension: ".png", want: true},
		{extension: ".webp", want: true},
		{extension: ".md", want: false},
		{extension: ".json", want: false},
	}

	for _, test := range tests {
		test := test
		t.Run(test.extension, func(t *testing.T) {
			t.Parallel()

			if got := IsAllowedVaultImageExtension(test.extension); got != test.want {
				t.Fatalf("IsAllowedVaultImageExtension(%q) = %v, want %v", test.extension, got, test.want)
			}
		})
	}
}
