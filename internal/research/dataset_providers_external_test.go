package research

import (
	"context"
	"strings"
	"testing"
)

func TestWorldBankMatchesPairsTwoIndicators(t *testing.T) {
	matches := worldBankMatches("Does life expectancy correlate with GDP per capita across countries")
	if len(matches) != 2 {
		t.Fatalf("expected both indicators, got %+v", matches)
	}
	if matches[0].Code != "SP.DYN.LE00.IN" || matches[1].Code != "NY.GDP.PCAP.CD" {
		t.Errorf("order should follow alias specificity, got %+v", matches)
	}
	if len(worldBankMatches("Does income inequality correlate with life expectancy")) != 2 {
		t.Error("inequality + life expectancy should pair two indicators")
	}
	if got := worldBankMatches("Does life expectancy differ"); len(got) != 1 {
		t.Errorf("a single-indicator question must not pair, got %+v", got)
	}
}

func TestWorldBankPairCSVMergesOnCountryAndYear(t *testing.T) {
	left := `[{"page":1},[{"country":{"value":"Kenya"},"countryiso3code":"KEN","date":"2015","value":60.5},{"country":{"value":"Kenya"},"countryiso3code":"KEN","date":"2016","value":61.0},{"country":{"value":"Chad"},"countryiso3code":"TCD","date":"2015","value":52.0}]]`
	right := `[{"page":1},[{"country":{"value":"Kenya"},"countryiso3code":"KEN","date":"2015","value":1350.0},{"country":{"value":"Kenya"},"countryiso3code":"KEN","date":"2016","value":1400.0}]]`
	out, err := worldBankPairCSV([]byte(left), []byte(right), "Life expectancy at birth", "GDP per capita")
	if err != nil {
		t.Fatalf("worldBankPairCSV: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if lines[0] != "country,country_code,year,life_expectancy_at_birth,gdp_per_capita" {
		t.Errorf("header = %q", lines[0])
	}
	if len(lines) != 3 {
		t.Fatalf("Chad has no matching GDP row and must be dropped, got %v", lines)
	}
	if lines[1] != "Kenya,KEN,2015,60.5,1350" {
		t.Errorf("row = %q", lines[1])
	}
}

func TestWorldBankMatchPrefersTheLongestAlias(t *testing.T) {
	if got := worldBankMatch("Does life expectancy correlate with GDP per capita across countries"); got == nil || got.Code != "SP.DYN.LE00.IN" {
		t.Errorf("life expectancy should win the longest-alias match, got %+v", got)
	}
	if got := worldBankMatch("Does income inequality correlate with literacy"); got == nil || got.Code != "SI.POV.GINI" {
		t.Errorf("inequality should match the Gini indicator, got %+v", got)
	}
	if got := worldBankMatch("Do penguin chicks differ in body mass"); got != nil {
		t.Errorf("an unrelated question must not match a World Bank indicator, got %+v", got)
	}
}

func TestOWIDMatchPrefersTheLongestAlias(t *testing.T) {
	if got := owidMatch("Does life expectancy correlate with income"); got == nil || got.Slug != "life-expectancy" {
		t.Errorf("expected the life-expectancy chart, got %+v", got)
	}
	// Keyword matching is deliberately permissive: a question about predator
	// populations also matches the population chart. Pooling every provider and
	// judging relevance is what stops that from being used.
	if got := owidMatch("Do predator populations correlate with prey populations"); got == nil || got.Slug != "population" {
		t.Errorf("expected the permissive population match, got %+v", got)
	}
	if got := owidMatch("Do penguin chicks differ in body mass"); got != nil {
		t.Errorf("a question with no chart alias must not match, got %+v", got)
	}
}

func TestSearchOpenDataPoolsEveryProvider(t *testing.T) {
	original := openDataProviders
	defer func() { openDataProviders = original }()
	openDataProviders = []func(context.Context, string) ([]openDataset, error){
		func(context.Context, string) ([]openDataset, error) {
			return []openDataset{{Provider: "A", DownloadURL: "https://a.example/1.csv"}}, nil
		},
		func(context.Context, string) ([]openDataset, error) {
			return []openDataset{{Provider: "B", DownloadURL: "https://b.example/2.csv"}, {Provider: "A", DownloadURL: "https://a.example/1.csv"}}, nil
		},
		func(context.Context, string) ([]openDataset, error) { return nil, context.DeadlineExceeded },
	}
	out, err := searchOpenData(context.Background(), "does x correlate with y")
	if err != nil {
		t.Fatalf("searchOpenData: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("expected the pooled de-duplicated candidates, got %+v", out)
	}
	if out[0].Provider != "A" || out[1].Provider != "B" {
		t.Errorf("provider order must follow the provider list, got %+v", out)
	}
}

func TestWHOMatchScoresCatalogNames(t *testing.T) {
	catalog := []whoIndicator{
		{Code: "AAA", Name: "Power density (W/m^2)"},
		{Code: "WHOSIS_000001", Name: "Life expectancy at birth (years)"},
		{Code: "WHOSIS_000015", Name: "Life expectancy at age 60 (years)"},
	}
	got := whoMatch("Does life expectancy at birth differ by country", catalog)
	if got == nil || got.Code != "WHOSIS_000001" {
		t.Fatalf("expected the at-birth indicator, got %+v", got)
	}
	if whoMatch("Do penguin chicks differ in body mass", catalog) != nil {
		t.Error("an unrelated question must not match a WHO indicator")
	}
}

func TestWorldBankCSVNamesTheValueColumn(t *testing.T) {
	payload := `[{"page":1},[{"indicator":{"id":"SP.DYN.LE00.IN","value":"Life expectancy"},"country":{"id":"GB","value":"United Kingdom"},"countryiso3code":"GBR","date":"2020","value":81.2},{"indicator":{},"country":{"value":"Nowhere"},"countryiso3code":"XXX","date":"2021","value":null}]]`
	out, err := worldBankCSV([]byte(payload), "Life expectancy at birth, total (years)")
	if err != nil {
		t.Fatalf("worldBankCSV: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected a header and one row (nulls dropped), got %v", lines)
	}
	if lines[0] != "country,country_code,year,life_expectancy_at_birth_total_years" {
		t.Errorf("header = %q", lines[0])
	}
	if lines[1] != "United Kingdom,GBR,2020,81.2" {
		t.Errorf("row = %q", lines[1])
	}
}

func TestWHOCSVNamesTheValueColumn(t *testing.T) {
	payload := `{"value":[{"SpatialDim":"WPR","TimeDim":2011,"Dim1":"SEX_FMLE","NumericValue":78.85},{"SpatialDim":"GBR","TimeDim":2019,"Dim1":"SEX_BTSX","NumericValue":81.3},{"SpatialDim":"","TimeDim":null,"NumericValue":null}]}`
	out, err := whoCSV([]byte(payload), "Life expectancy at birth (years)")
	if err != nil {
		t.Fatalf("whoCSV: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) != 3 {
		t.Fatalf("expected a header and two rows, got %v", lines)
	}
	if lines[0] != "country_code,year,group,life_expectancy_at_birth_years" {
		t.Errorf("header = %q", lines[0])
	}
	if lines[2] != "GBR,2019,SEX_BTSX,81.3" {
		t.Errorf("row = %q", lines[2])
	}
}

func TestColumnNameFromLabel(t *testing.T) {
	cases := map[string]string{
		"Life expectancy at birth, total (years)": "life_expectancy_at_birth_total_years",
		"CO2 emissions (metric tons per capita)":  "co2_emissions_metric_tons_per_capita",
		"   ":                                     "value",
	}
	for input, want := range cases {
		if got := columnNameFromLabel(input); got != want {
			t.Errorf("columnNameFromLabel(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestDownloadOpenDatasetConvertsProviderJSON(t *testing.T) {
	original := dataDownloadFetch
	defer func() { dataDownloadFetch = original }()
	dataDownloadFetch = func(context.Context, string) ([]byte, string, error) {
		return []byte(`[{"page":1},[{"country":{"value":"Kenya"},"countryiso3code":"KEN","date":"2015","value":60.5}]]`), "https://api.worldbank.org/v2/x", nil
	}
	out, _, err := downloadOpenDataset(context.Background(), openDataset{DownloadURL: "https://api.worldbank.org/v2/x", Format: "worldbank:Life expectancy at birth"})
	if err != nil {
		t.Fatalf("downloadOpenDataset: %v", err)
	}
	if !strings.Contains(string(out), "Kenya,KEN,2015,60.5") {
		t.Errorf("converted CSV missing the row: %q", string(out))
	}

	dataDownloadFetch = func(context.Context, string) ([]byte, string, error) {
		return []byte("group,value\na,1\n"), "https://ourworldindata.org/grapher/x.csv", nil
	}
	out, _, err = downloadOpenDataset(context.Background(), openDataset{DownloadURL: "https://ourworldindata.org/grapher/x.csv"})
	if err != nil {
		t.Fatalf("downloadOpenDataset (csv): %v", err)
	}
	if string(out) != "group,value\na,1\n" {
		t.Errorf("a plain CSV must pass through unchanged, got %q", string(out))
	}
}
