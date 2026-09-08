package research

import (
	"sort"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// External data providers.
//
// Zenodo alone only serves research-archive supplementary files, so questions
// about national indicators (income, life expectancy, emissions, sea ice) never
// found data even though it is published and downloadable. These providers
// cover that gap. Each returns candidates whose DownloadURL is either a plain
// CSV or a JSON API converted to CSV by downloadOpenDataset.

// worldBankIndicator pairs an indicator code with the phrases that identify it.
// The World Bank API exposes roughly 29,000 indicators with no text search, so a
// curated map beats downloading the whole catalog for every question.
type worldBankIndicator struct {
	Code    string
	Name    string
	Aliases []string
}

var worldBankIndicators = []worldBankIndicator{
	{"SP.DYN.LE00.IN", "Life expectancy at birth, total (years)", []string{"life expectancy", "life span", "lifespan", "longevity"}},
	{"NY.GDP.PCAP.CD", "GDP per capita (current US$)", []string{"gdp per capita", "income per capita", "income per person", "gdp", "income"}},
	{"EN.ATM.CO2E.PC", "CO2 emissions (metric tons per capita)", []string{"co2 emissions", "carbon dioxide emissions", "co2", "carbon emissions"}},
	{"SP.DYN.IMRT.IN", "Mortality rate, infant (per 1,000 live births)", []string{"infant mortality", "baby deaths", "neonatal mortality"}},
	{"SH.DYN.MORT", "Mortality rate, under-5 (per 1,000 live births)", []string{"under-5 mortality", "under five mortality", "child mortality"}},
	{"SH.XPD.CHEX.GD.ZS", "Current health expenditure (% of GDP)", []string{"health spending", "health expenditure", "healthcare spending", "health care spending"}},
	{"SE.XPD.TOTL.GD.ZS", "Government expenditure on education (% of GDP)", []string{"education spending", "education expenditure", "spending on education"}},
	{"SE.ADT.LITR.ZS", "Literacy rate, adult total (% of people ages 15 and above)", []string{"literacy", "literacy rate"}},
	{"IT.NET.USER.ZS", "Individuals using the Internet (% of population)", []string{"internet access", "internet", "online access"}},
	{"SI.POV.GINI", "Gini index", []string{"gini", "income inequality", "inequality"}},
	{"SP.POP.TOTL", "Population, total", []string{"population size", "population", "inhabitants"}},
	{"AG.YLD.CREL.KG", "Cereal yield (kg per hectare)", []string{"cereal yield", "crop yield", "wheat yield", "maize yield", "grain yield"}},
	{"AG.CON.FERT.ZS", "Fertilizer consumption (% of fertilizer production)", []string{"fertiliser use", "fertilizer use", "fertiliser", "fertilizer"}},
	{"EG.FEC.RNEW.ZS", "Renewable energy consumption (% of total final energy consumption)", []string{"renewable energy", "renewables", "clean energy"}},
	{"SH.IMM.MEAS", "Immunization, measles (% of children ages 12-23 months)", []string{"measles", "vaccination coverage", "immunisation", "immunization"}},
	{"SH.TBS.INCD", "Incidence of tuberculosis (per 100,000 people)", []string{"tuberculosis", "tb incidence"}},
	{"SL.UEM.TOTL.ZS", "Unemployment, total (% of total labor force)", []string{"unemployment"}},
	{"SP.URB.TOTL.IN.ZS", "Urban population (% of total population)", []string{"urbanisation", "urbanization", "urban population"}},
	{"SH.STA.BRTC.ZS", "Births attended by skilled health staff (% of total)", []string{"skilled birth", "birth attendance"}},
	{"SP.DYN.TFRT.IN", "Fertility rate, total (births per woman)", []string{"fertility rate", "birth rate", "births per woman"}},
}

// searchWorldBank matches the question against the curated indicator list and
// returns one candidate. When the question names two indicators — "does life
// expectancy correlate with GDP per capita" — both are fetched and merged on
// country and year, because the analysis tools can only correlate columns of
// one table.
func searchWorldBank(ctx context.Context, query string) ([]openDataset, error) {
	matches := worldBankMatches(query)
	if len(matches) == 0 {
		return nil, nil
	}
	codes := make([]string, 0, len(matches))
	names := make([]string, 0, len(matches))
	for _, match := range matches {
		codes = append(codes, match.Code)
		names = append(names, match.Name)
	}
	name := strings.Join(names, " and ") + " — World Bank, all countries 1990-2024"
	return []openDataset{{
		Name:        name,
		Description: "World Bank indicator(s) " + strings.Join(codes, ", ") + ". One row per country and year.",
		Provider:    "World Bank",
		File:        strings.Join(codes, "+") + ".json",
		DownloadURL: worldBankIndicatorURL(codes[0]),
		Format:      "worldbank:" + strings.Join(codes, "|"),
	}}, nil
}

func worldBankIndicatorURL(code string) string {
	values := url.Values{}
	values.Set("format", "json")
	values.Set("per_page", "20000")
	values.Set("date", "1990:2024")
	return "https://api.worldbank.org/v2/country/all/indicator/" + code + "?" + values.Encode()
}

// worldBankMatches returns up to two distinct indicators, ordered by how
// specific the matched alias is.
func worldBankMatches(query string) []worldBankIndicator {
	lower := strings.ToLower(query)
	type hit struct{ index, length int }
	var hits []hit
	for i := range worldBankIndicators {
		longest := 0
		for _, alias := range worldBankIndicators[i].Aliases {
			if strings.Contains(lower, alias) && len(alias) > longest {
				longest = len(alias)
			}
		}
		if longest > 0 {
			hits = append(hits, hit{index: i, length: longest})
		}
	}
	sort.Slice(hits, func(a, b int) bool { return hits[a].length > hits[b].length })
	out := make([]worldBankIndicator, 0, 2)
	for _, match := range hits {
		out = append(out, worldBankIndicators[match.index])
		if len(out) == 2 {
			break
		}
	}
	return out
}

func worldBankMatch(query string) *worldBankIndicator {
	matches := worldBankMatches(query)
	if len(matches) == 0 {
		return nil
	}
	return &matches[0]
}

func worldBankName(code string) string {
	for _, indicator := range worldBankIndicators {
		if indicator.Code == code {
			return indicator.Name
		}
	}
	return code
}

// whoCatalogLimit bounds the indicator catalog read (about 400 KB, 3,098 rows).
const whoCatalogLimit = 2 << 20

// whoIndicator is one entry of the WHO Global Health Observatory catalog.
type whoIndicator struct {
	Code string `json:"IndicatorCode"`
	Name string `json:"IndicatorName"`
}

func searchWHO(ctx context.Context, query string) ([]openDataset, error) {
	data, _, err := openDataFetch(ctx, "https://ghoapi.azureedge.net/api/Indicator", whoCatalogLimit)
	if err != nil {
		return nil, err
	}
	var catalog struct {
		Value []whoIndicator `json:"value"`
	}
	if err := json.Unmarshal(data, &catalog); err != nil {
		return nil, err
	}
	match := whoMatch(query, catalog.Value)
	if match == nil {
		return nil, nil
	}
	values := url.Values{}
	values.Set("$filter", "SpatialDimType eq 'COUNTRY'")
	values.Set("$top", "8000")
	endpoint := "https://ghoapi.azureedge.net/api/" + match.Code + "?" + values.Encode()
	return []openDataset{{
		Name:        match.Name + " — World Health Organization, by country",
		Description: "WHO Global Health Observatory indicator " + match.Code + ".",
		Provider:    "WHO",
		File:        match.Code + ".json",
		DownloadURL: endpoint,
		Format:      "who:" + match.Name,
	}}, nil
}

// whoMatch scores catalog entries by how many query content words their name
// contains, preferring the shorter name when two score the same.
func whoMatch(query string, catalog []whoIndicator) *whoIndicator {
	words := providerContentWords(query)
	if len(words) == 0 {
		return nil
	}
	bestScore := 0
	var best *whoIndicator
	for i := range catalog {
		lower := strings.ToLower(catalog[i].Name)
		score := 0
		for _, word := range words {
			if strings.Contains(lower, word) {
				score++
			}
		}
		if score > bestScore || (score == bestScore && score > 0 && best != nil && len(catalog[i].Name) < len(best.Name)) {
			bestScore = score
			best = &catalog[i]
		}
	}
	if bestScore == 0 {
		return nil
	}
	return best
}

// owidChart maps a question concept to an Our World in Data grapher slug. OWID
// publishes each chart as a plain CSV at /grapher/<slug>.csv.
type owidChart struct {
	Slug    string
	Name    string
	Aliases []string
}

var owidCharts = []owidChart{
	{"life-expectancy", "Life expectancy", []string{"life expectancy", "life span", "lifespan", "longevity"}},
	{"gdp-per-capita-worldbank", "GDP per capita", []string{"gdp per capita", "income per capita", "gdp"}},
	{"annual-co2-emissions-per-country", "Annual CO2 emissions", []string{"co2 emissions", "carbon emissions", "carbon dioxide emissions", "co2"}},
	{"co2-emissions-per-capita", "CO2 emissions per capita", []string{"co2 per capita", "emissions per capita"}},
	{"child-mortality", "Child mortality", []string{"child mortality", "under-5 mortality", "infant mortality"}},
	{"population", "Population", []string{"population", "population size"}},
	{"human-development-index", "Human Development Index", []string{"human development index", "hdi"}},
	{"daily-per-capita-caloric-supply", "Daily supply of calories per person", []string{"calorie supply", "caloric supply", "calories per person"}},
	{"share-of-the-population-with-access-to-electricity", "Access to electricity", []string{"electricity access", "access to electricity"}},
	{"annual-co2-emissions-per-country", "Annual CO2 emissions", []string{"greenhouse gas emissions", "ghg emissions"}},
	{"death-rate-from-air-pollution", "Death rate from air pollution", []string{"air pollution deaths", "air pollution"}},
	{"renewable-share-energy", "Renewable energy share", []string{"renewable energy", "renewables"}},
}

func searchOurWorldInData(ctx context.Context, query string) ([]openDataset, error) {
	match := owidMatch(query)
	if match == nil {
		return nil, nil
	}
	values := url.Values{}
	values.Set("csvType", "full")
	values.Set("useColumnShortNames", "true")
	return []openDataset{{
		Name:        match.Name + " — Our World in Data",
		Description: "Our World in Data chart " + match.Slug + ". One row per entity and year.",
		Provider:    "Our World in Data",
		File:        match.Slug + ".csv",
		DownloadURL: "https://ourworldindata.org/grapher/" + match.Slug + ".csv?" + values.Encode(),
	}}, nil
}

func owidMatch(query string) *owidChart {
	lower := strings.ToLower(query)
	longest := -1
	var match *owidChart
	for i := range owidCharts {
		for _, alias := range owidCharts[i].Aliases {
			if strings.Contains(lower, alias) && len(alias) > longest {
				longest = len(alias)
				match = &owidCharts[i]
			}
		}
	}
	return match
}

// providerContentWords returns the content words of a question, lowercased and
// without generic question scaffolding, for provider name matching.
func providerContentWords(query string) []string {
	var out []string
	for _, word := range strings.FieldsFunc(strings.ToLower(query), func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9')
	}) {
		if len(word) < 4 || providerStopwords[word] {
			continue
		}
		out = append(out, word)
	}
	return out
}

var providerStopwords = map[string]bool{
	"does": true, "correlate": true, "correlates": true, "correlation": true,
	"between": true, "across": true, "countries": true, "country": true,
	"there": true, "with": true, "than": true, "more": true, "less": true,
	"higher": true, "lower": true, "increase": true, "decrease": true,
	"data": true, "dataset": true, "years": true, "year": true,
}

// downloadOpenDataset fetches a candidate and returns CSV bytes, converting the
// provider JSON payloads into a plain table the analysis tools can read.
func downloadOpenDataset(ctx context.Context, candidate openDataset) ([]byte, string, error) {
	format, label, _ := strings.Cut(candidate.Format, ":")
	switch format {
	case "worldbank":
		parts := strings.Split(label, "|")
		data, final, err := dataDownloadFetch(ctx, candidate.DownloadURL)
		if err != nil {
			return nil, "", err
		}
		if len(parts) == 1 {
			converted, err := worldBankCSV(data, worldBankName(parts[0]))
			return converted, final, err
		}
		second, _, err := dataDownloadFetch(ctx, worldBankIndicatorURL(parts[1]))
		if err != nil {
			return nil, "", err
		}
		converted, err := worldBankPairCSV(data, second, worldBankName(parts[0]), worldBankName(parts[1]))
		return converted, final, err
	case "who":
		data, final, err := dataDownloadFetch(ctx, candidate.DownloadURL)
		if err != nil {
			return nil, "", err
		}
		converted, err := whoCSV(data, label)
		return converted, final, err
	default:
		return dataDownloadFetch(ctx, candidate.DownloadURL)
	}
}

// worldBankPairCSV merges two indicator payloads on country code and year, so a
// correlation question gets both variables in one table.
func worldBankPairCSV(first, second []byte, firstLabel, secondLabel string) ([]byte, error) {
	left, err := worldBankRows(first)
	if err != nil {
		return nil, err
	}
	right, err := worldBankRows(second)
	if err != nil {
		return nil, err
	}
	type key struct{ code, year string }
	rightByKey := make(map[key]worldBankRow, len(right))
	for _, row := range right {
		rightByKey[key{row.CountryCode, row.Date}] = row
	}
	leftColumn := columnNameFromLabel(firstLabel)
	rightColumn := columnNameFromLabel(secondLabel)
	out := [][]string{{"country", "country_code", "year", leftColumn, rightColumn}}
	for _, row := range left {
		other, ok := rightByKey[key{row.CountryCode, row.Date}]
		if !ok || row.Value == nil || other.Value == nil {
			continue
		}
		out = append(out, []string{
			row.Country, row.CountryCode, row.Date,
			strconv.FormatFloat(*row.Value, 'g', -1, 64),
			strconv.FormatFloat(*other.Value, 'g', -1, 64),
		})
	}
	return encodeCSV(out)
}

// worldBankRow is one observation of a World Bank indicator.
type worldBankRow struct {
	Country     string
	CountryCode string
	Date        string
	Value       *float64
}

func worldBankRows(data []byte) ([]worldBankRow, error) {
	var parts []json.RawMessage
	if err := json.Unmarshal(data, &parts); err != nil {
		return nil, err
	}
	if len(parts) < 2 {
		return nil, fmt.Errorf("World Bank response contained no rows")
	}
	var payload []struct {
		Country     struct {
			Value string `json:"value"`
		} `json:"country"`
		CountryCode string   `json:"countryiso3code"`
		Date        string   `json:"date"`
		Value       *float64 `json:"value"`
	}
	if err := json.Unmarshal(parts[1], &payload); err != nil {
		return nil, err
	}
	rows := make([]worldBankRow, 0, len(payload))
	for _, row := range payload {
		if row.Value == nil || row.Date == "" || row.Country.Value == "" {
			continue
		}
		rows = append(rows, worldBankRow{Country: row.Country.Value, CountryCode: row.CountryCode, Date: row.Date, Value: row.Value})
	}
	return rows, nil
}

func worldBankCSV(data []byte, label string) ([]byte, error) {
	rows, err := worldBankRows(data)
	if err != nil {
		return nil, err
	}
	column := columnNameFromLabel(label)
	out := [][]string{{"country", "country_code", "year", column}}
	for _, row := range rows {
		out = append(out, []string{row.Country, row.CountryCode, row.Date, strconv.FormatFloat(*row.Value, 'g', -1, 64)})
	}
	return encodeCSV(out)
}

func whoCSV(data []byte, label string) ([]byte, error) {
	var body struct {
		Value []struct {
			SpatialDim   string   `json:"SpatialDim"`
			TimeDim      *int     `json:"TimeDim"`
			Dim1         string   `json:"Dim1"`
			NumericValue *float64 `json:"NumericValue"`
		} `json:"value"`
	}
	if err := json.Unmarshal(data, &body); err != nil {
		return nil, err
	}
	column := columnNameFromLabel(label)
	out := [][]string{{"country_code", "year", "group", column}}
	for _, row := range body.Value {
		if row.NumericValue == nil || row.TimeDim == nil || row.SpatialDim == "" {
			continue
		}
		out = append(out, []string{row.SpatialDim, strconv.Itoa(*row.TimeDim), row.Dim1, strconv.FormatFloat(*row.NumericValue, 'g', -1, 64)})
	}
	return encodeCSV(out)
}

// columnNameFromLabel turns an indicator title into a usable column name, so the
// analysis tools and the relevance check see a meaningful header instead of a
// generic "value".
func columnNameFromLabel(label string) string {
	var b strings.Builder
	lastUnderscore := true
	for _, r := range strings.ToLower(label) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastUnderscore = false
		case !lastUnderscore:
			b.WriteRune('_')
			lastUnderscore = true
		}
	}
	name := strings.Trim(b.String(), "_")
	if len(name) > 60 {
		name = strings.Trim(name[:60], "_")
	}
	if name == "" {
		name = "value"
	}
	return name
}

func encodeCSV(rows [][]string) ([]byte, error) {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.WriteAll(rows); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
