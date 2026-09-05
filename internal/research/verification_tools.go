package research

import (
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/Andyi955/Gorantula/models"
)

const verificationToolVersion = "native-v1"
const maxDatasetBytes = 1 << 20
const maxDatasetRows = 2000

func digestBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// Reject malformed/ragged inputs and excessive work before a model or tool sees
// them. All values are data; no cell is interpreted as a formula or command.
func parseVerificationCSV(raw string) ([]string, [][]string, error) {
	if !utf8.ValidString(raw) {
		return nil, nil, fmt.Errorf("CSV must use UTF-8 encoding")
	}
	if len(raw) == 0 || len(raw) > maxDatasetBytes {
		return nil, nil, fmt.Errorf("CSV must contain 1 byte to 1 MiB")
	}
	r := csv.NewReader(strings.NewReader(strings.TrimPrefix(raw, "\ufeff")))
	header, err := r.Read()
	if err != nil || len(header) < 2 || len(header) > 32 {
		return nil, nil, fmt.Errorf("CSV needs 2–32 columns with a header")
	}
	seen := map[string]bool{}
	for i, name := range header {
		name = strings.TrimSpace(name)
		if name == "" || len(name) > 80 || seen[name] {
			return nil, nil, fmt.Errorf("column names must be unique, nonempty, and at most 80 bytes")
		}
		seen[name] = true
		header[i] = name
	}
	rows := [][]string{}
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, nil, fmt.Errorf("invalid CSV row: %w", err)
		}
		if len(rows) >= maxDatasetRows {
			return nil, nil, fmt.Errorf("maximum %d rows", maxDatasetRows)
		}
		for _, cell := range row {
			if len(cell) > 4096 {
				return nil, nil, fmt.Errorf("cell exceeds 4096 bytes")
			}
		}
		rows = append(rows, row)
	}
	if len(rows) < 2 {
		return nil, nil, fmt.Errorf("at least two data rows required")
	}
	return header, rows, nil
}

func validateVerificationCall(call models.VerificationCall) error {
	if call.Tool != "stats-reanalysis" && call.Tool != "figure-reproduce" && !extendedStatistic(call.Tool) {
		return fmt.Errorf("unknown verification tool %q", call.Tool)
	}
	if call.GroupColumn == "" || call.ValueColumn == "" || call.GroupColumn == call.ValueColumn || len(call.GroupColumn) > 80 || len(call.ValueColumn) > 80 {
		return fmt.Errorf("choose distinct group and numeric value columns")
	}
	if strings.TrimSpace(call.Statement) == "" || len(call.Statement) > 2000 || strings.TrimSpace(call.Rationale) == "" || len(call.Rationale) > 2000 {
		return fmt.Errorf("tested statement and method rationale are required (maximum 2000 bytes each)")
	}
	return nil
}

// Both tools share strict group parsing: missing/nonfinite values are errors,
// never silently omitted, and deterministic group ordering fixes the sign.
func verificationGroups(ctx context.Context, data models.ResearchDataset, call models.VerificationCall) ([]models.VerificationGroup, [][]float64, error) {
	if err := validateVerificationCall(call); err != nil {
		return nil, nil, err
	}
	header, rows, err := parseVerificationCSV(data.CSV)
	if err != nil {
		return nil, nil, err
	}
	g, v := -1, -1
	for i, h := range header {
		if h == call.GroupColumn {
			g = i
		}
		if h == call.ValueColumn {
			v = i
		}
	}
	if g < 0 || v < 0 {
		return nil, nil, fmt.Errorf("selected columns do not exist in dataset")
	}
	buckets := map[string][]float64{}
	for i, row := range rows {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		name := strings.TrimSpace(row[g])
		n, err := strconv.ParseFloat(strings.TrimSpace(row[v]), 64)
		if name == "" || len(name) > 80 || err != nil || math.IsNaN(n) || math.IsInf(n, 0) || math.Abs(n) > 1e12 {
			return nil, nil, fmt.Errorf("row %d needs a group label and finite numeric value within ±1e12", i+2)
		}
		buckets[name] = append(buckets[name], n)
		if len(buckets) > 12 {
			return nil, nil, fmt.Errorf("maximum 12 groups")
		}
	}
	names := make([]string, 0, len(buckets))
	for name := range buckets {
		names = append(names, name)
	}
	sort.Strings(names)
	groups := []models.VerificationGroup{}
	values := [][]float64{}
	for _, name := range names {
		nums := buckets[name]
		mean := 0.0
		for _, n := range nums {
			mean += n / float64(len(nums))
		}
		groups = append(groups, models.VerificationGroup{Name: name, Count: len(nums), Mean: mean})
		values = append(values, nums)
	}
	return groups, values, nil
}

// Bind every attempt to its immutable input, including recoverable failures.
func executeVerificationTool(ctx context.Context, data models.ResearchDataset, call models.VerificationCall) models.VerificationResult {
	result := executeVerificationToolResult(ctx, data, call)
	result.InputDigest = data.Digest
	return result
}

func executeVerificationToolResult(ctx context.Context, data models.ResearchDataset, call models.VerificationCall) models.VerificationResult {
	if extendedStatistic(call.Tool) {
		return executeExtendedStatistic(ctx, data, call)
	}
	result := models.VerificationResult{Call: call, Status: "completed", Verdict: "inconclusive", Assumptions: []string{"Dataset provenance and claim relevance require review; these calculations do not establish causation or approve a finding."}}
	groups, values, err := verificationGroups(ctx, data, call)
	if err == nil {
		result.Groups = groups
		switch call.Tool {
		case "stats-reanalysis":
			if len(groups) != 2 || len(values[0]) < 2 || len(values[1]) < 2 {
				err = fmt.Errorf("permutation test needs exactly two independent groups, each with at least two observations")
				break
			}
			result.Assumptions = append(result.Assumptions, "Observations must be independent and group labels exchangeable under the null of identical distributions; paired or clustered observations are not supported.", "Two-sided Monte Carlo permutation test uses absolute mean difference, 1999 shuffles, and the plus-one correction; no multiple-testing correction or equivalence test is performed.")
			difference := groups[1].Mean - groups[0].Mean
			if call.Descriptive {
				result.MeanDifference = &difference
				result.Assumptions = []string{"Descriptive group means and difference only; no independence claim, p-value, interval or causal conclusion."}
				result.Summary = fmt.Sprintf("Descriptive mean difference (%s minus %s): %.6g; no inferential uncertainty computed.", groups[1].Name, groups[0].Name, difference)
				break
			}
			p, testErr := permutationP(ctx, values, difference)
			if testErr != nil {
				err = testErr
				break
			}
			result.MeanDifference = &difference
			result.PValue = &p
			result.Permutations = 1999
			result.Seed = 1
			result.Summary = fmt.Sprintf("Mean difference (%s minus %s): %.6g; two-sided permutation p = %.6g. A large p-value does not establish equivalence; a small p-value is not proof of the candidate.", groups[1].Name, groups[0].Name, difference, p)
		case "figure-reproduce":
			result.SVG = verificationSVG(groups, call)
			result.Summary = "Reproduced group means from the supplied CSV. This plot has not been compared against a published figure and contains no inferred error bars."
			result.Assumptions = append(result.Assumptions, "Bars show arithmetic means; sample counts are labelled. No uncertainty estimates or published-reference agreement are implied.")
		}
	}
	if err != nil {
		result.Status = "failed"
		result.Summary = err.Error()
	}
	encoded, _ := json.Marshal(result)
	result.OutputDigest = digestBytes(encoded)
	return result
}

// Reset the pooled observations before each seeded shuffle. Counting the
// observed assignment prevents zero p-values for a Monte Carlo sample.
func permutationP(ctx context.Context, groups [][]float64, difference float64) (float64, error) {
	pooled := append(append([]float64{}, groups[0]...), groups[1]...)
	work := make([]float64, len(pooled))
	rng := rand.New(rand.NewSource(1))
	extreme := 0
	threshold := math.Abs(difference) * (1 - 1e-12)
	for i := 0; i < 1999; i++ {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		copy(work, pooled)
		rng.Shuffle(len(work), func(a, b int) { work[a], work[b] = work[b], work[a] })
		left, right := 0.0, 0.0
		for j, n := range work {
			if j < len(groups[0]) {
				left += n / float64(len(groups[0]))
			} else {
				right += n / float64(len(groups[1]))
			}
		}
		if math.Abs(right-left) >= threshold {
			extreme++
		}
	}
	return float64(extreme+1) / 2000, nil
}

// SVG is generated exclusively from bounded numbers and escaped text. No model
// markup, scripts, foreign objects, external assets, or active links are accepted.
func verificationSVG(groups []models.VerificationGroup, call models.VerificationCall) string {
	var b strings.Builder
	height := 100 + len(groups)*48
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="%d" viewBox="0 0 900 %d"><rect width="100%%" height="100%%" fill="#101c26"/><g fill="#e3eef5" font-family="sans-serif" font-size="14"><text x="24" y="28">Group means: %s</text>`, height, height, html.EscapeString(call.ValueColumn))
	maxValue := 1.0
	for _, g := range groups {
		maxValue = math.Max(maxValue, math.Abs(g.Mean))
	}
	fmt.Fprintf(&b, `<path d="M510 45 V%d" stroke="#8b9da9"/>`, height-30)
	for i, g := range groups {
		y := 55 + i*48
		width := math.Abs(g.Mean) / maxValue * 170
		x := 510.0
		if g.Mean < 0 {
			x -= width
		}
		label := g.Name
		if len([]rune(label)) > 25 {
			label = string([]rune(label)[:24]) + "…"
		}
		fmt.Fprintf(&b, `<text x="24" y="%d">%s (n=%d)</text><rect x="%.2f" y="%d" width="%.2f" height="24" fill="#75d8ca"/><text x="700" y="%d">%.6g</text>`, y+17, html.EscapeString(label), g.Count, x, y, width, y+17, g.Mean)
	}
	fmt.Fprintf(&b, `<text x="24" y="%d" font-size="12">Means only; no uncertainty estimates. Negative values extend left of zero.</text></g></svg>`, height-10)
	return b.String()
}
