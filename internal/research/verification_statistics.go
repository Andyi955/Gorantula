package research

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"strings"

	"github.com/Andyi955/Gorantula/models"
)

func extendedStatistic(tool string) bool {
	return tool == "stats-paired" || tool == "stats-correlation" || tool == "stats-regression" || tool == "stats-effects"
}
func numericColumns(data models.ResearchDataset, call models.VerificationCall) ([]float64, []float64, error) {
	h, rows, err := parseVerificationCSV(data.CSV)
	if err != nil {
		return nil, nil, err
	}
	a, b := -1, -1
	for i, v := range h {
		if v == call.GroupColumn {
			a = i
		}
		if v == call.ValueColumn {
			b = i
		}
	}
	if a < 0 || b < 0 {
		return nil, nil, fmt.Errorf("selected numeric columns do not exist")
	}
	if len(rows) < 4 {
		return nil, nil, fmt.Errorf("at least four complete observations are required")
	}
	x, y := []float64{}, []float64{}
	for i, row := range rows {
		pair := []float64{}
		for _, j := range []int{a, b} {
			v, e := strconv.ParseFloat(strings.TrimSpace(row[j]), 64)
			if e != nil || math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > 1e12 {
				return nil, nil, fmt.Errorf("row %d needs finite numeric values within ±1e12; no missing values are dropped", i+2)
			}
			pair = append(pair, v)
		}
		x = append(x, pair[0])
		y = append(y, pair[1])
	}
	return x, y, nil
}
func sampleMean(x []float64) float64 {
	v := 0.
	for _, n := range x {
		v += n / float64(len(x))
	}
	return v
}
func sampleVariance(x []float64) float64 {
	m := sampleMean(x)
	v := 0.
	for _, n := range x {
		v += (n - m) * (n - m)
	}
	return v / float64(len(x)-1)
}
func linearMoments(x, y []float64) (r, slope, intercept float64, ok bool) {
	mx, my := sampleMean(x), sampleMean(y)
	xx, yy, xy := 0., 0., 0.
	for i, v := range x {
		dx, dy := v-mx, y[i]-my
		xx += dx * dx
		yy += dy * dy
		xy += dx * dy
	}
	if xx == 0 || yy == 0 {
		return 0, 0, 0, false
	}
	r = math.Max(-1, math.Min(1, xy/(math.Sqrt(xx)*math.Sqrt(yy))))
	slope = xy / xx
	intercept = my - slope*mx
	return r, slope, intercept, !math.IsNaN(r) && !math.IsInf(slope, 0) && !math.IsInf(intercept, 0)
}
func percentile(sorted []float64, p float64) float64 {
	at := p * float64(len(sorted)-1)
	i := int(at)
	if i == len(sorted)-1 {
		return sorted[i]
	}
	return sorted[i] + (at-float64(i))*(sorted[i+1]-sorted[i])
}

// Fixed-seed percentile bootstrap resamples pairs together; independent groups
// are resampled separately. It is approximate, not an exact coverage guarantee.
func executeExtendedStatistic(ctx context.Context, data models.ResearchDataset, call models.VerificationCall) models.VerificationResult {
	out := models.VerificationResult{Call: call, Status: "completed", Verdict: "inconclusive", Seed: 1, Metrics: map[string]float64{}, Intervals: map[string][]float64{}, Assumptions: []string{"Source relevance, study design and measurement quality require review. No causal, equivalence or multiple-testing claims.", "95% percentile bootstrap intervals use 1999 resamples (seed 1), with linear interpolation of quantiles. Coverage can be poor with small or unrepresentative samples."}}
	finish := func(err error) models.VerificationResult {
		if err != nil {
			out.Status = "failed"
			out.Summary = err.Error()
			out.Metrics = nil
			out.Intervals = nil
			out.PValue = nil
		}
		raw, _ := json.Marshal(out)
		out.OutputDigest = digestBytes(raw)
		return out
	}
	if err := validateVerificationCall(call); err != nil {
		return finish(err)
	}
	var x, y []float64
	var err error
	if call.Tool == "stats-effects" {
		groups, values, e := verificationGroups(ctx, data, call)
		err = e
		if err == nil {
			if len(values) != 2 || len(values[0]) < 4 || len(values[1]) < 4 {
				return finish(fmt.Errorf("effect estimates need two independent groups with at least four observations each"))
			}
			out.Groups = groups
			x, y = values[0], values[1]
		}
	} else {
		x, y, err = numericColumns(data, call)
	}
	if err != nil {
		return finish(err)
	}
	statistic := func(a, b []float64) (float64, bool) {
		switch call.Tool {
		case "stats-paired", "stats-effects":
			return sampleMean(b) - sampleMean(a), true
		default:
			r, s, _, ok := linearMoments(a, b)
			if call.Tool == "stats-regression" {
				return s, ok
			}
			return r, ok
		}
	}
	estimate, ok := statistic(x, y)
	if !ok {
		return finish(fmt.Errorf("constant columns make correlation/regression inference undefined"))
	}
	label := "meanDifference"
	switch call.Tool {
	case "stats-correlation":
		label = "pearsonR"
	case "stats-regression":
		label = "slope"
	}
	out.Metrics[label] = estimate
	if call.Tool == "stats-regression" {
		r, s, b, _ := linearMoments(x, y)
		out.Metrics["slope"] = s
		out.Metrics["intercept"] = b
		out.Metrics["rSquared"] = r * r
		out.Assumptions = append(out.Assumptions, "Simple OLS with an intercept, one predictor X and outcome Y. Independent rows, linear conditional mean; permutation inference requires exchangeable Y under independence. No confounder adjustment or extrapolation.")
	}
	if call.Tool == "stats-effects" {
		pooled := math.Sqrt((float64(len(x)-1)*sampleVariance(x) + float64(len(y)-1)*sampleVariance(y)) / float64(len(x)+len(y)-2))
		if pooled == 0 {
			return finish(fmt.Errorf("pooled variance is zero; Cohen's d is undefined"))
		}
		out.Metrics["cohensD"] = estimate / pooled
		out.Assumptions = append(out.Assumptions, "Independent groups; sign is second alphabetical group minus first. Cohen's d uses pooled sample SD (no small-sample correction). Interval is for mean difference, not d.")
	}
	if call.Tool == "stats-paired" {
		out.Assumptions = append(out.Assumptions, "Each CSV row must be one matched pair (X before, Y after); pairs must be independent. Two-sided sign-flip test assumes symmetric differences under the null.")
	}
	if call.Tool == "stats-correlation" {
		out.Assumptions = append(out.Assumptions, "Pearson linear correlation of X and Y, independent observation pairs. Permutation assumes exchangeability under independence; correlation is not causation.")
	}
	// Descriptive estimates remain available when inferential assumptions are unknown.
	if call.Descriptive {
		out.Assumptions = []string{"Descriptive sample estimates only. No p-values, confidence intervals, population inference, causal conclusions or extrapolation. Pairing must still identify corresponding measurements for a paired difference."}
		out.Summary = fmt.Sprintf("Descriptive %s = %.6g; no inferential uncertainty computed.", label, estimate)
		return finish(nil)
	}
	rng := rand.New(rand.NewSource(1))
	boot := make([]float64, 0, 1999)
	a, b := make([]float64, len(x)), make([]float64, len(y))
	for k := 0; k < 1999; k++ {
		if err := ctx.Err(); err != nil {
			return finish(err)
		}
		for i := range a {
			j := rng.Intn(len(x))
			a[i] = x[j]
			if call.Tool != "stats-effects" {
				b[i] = y[j]
			}
		}
		if call.Tool == "stats-effects" {
			for i := range b {
				b[i] = y[rng.Intn(len(y))]
			}
		}
		if v, valid := statistic(a, b); valid && !math.IsNaN(v) && !math.IsInf(v, 0) {
			boot = append(boot, v)
		}
	}
	if len(boot) < 1800 {
		return finish(fmt.Errorf("too many degenerate bootstrap samples; more varied observations are required"))
	}
	sort.Float64s(boot)
	out.Intervals[label] = []float64{percentile(boot, .025), percentile(boot, .975)}
	out.Metrics["bootstrapSamples"] = float64(len(boot))
	if len(boot) < 1999 {
		out.Assumptions = append(out.Assumptions, fmt.Sprintf("%d degenerate resamples were omitted; interval is conditional on valid resamples.", 1999-len(boot)))
	}
	if call.Tool != "stats-effects" {
		rng = rand.New(rand.NewSource(1))
		extreme := 0
		for k := 0; k < 1999; k++ {
			if err := ctx.Err(); err != nil {
				return finish(err)
			}
			v := 0.
			if call.Tool == "stats-paired" {
				for i := range x {
					d := y[i] - x[i]
					if rng.Intn(2) == 0 {
						d = -d
					}
					v += d / float64(len(x))
				}
			} else {
				copy(b, y)
				rng.Shuffle(len(b), func(i, j int) { b[i], b[j] = b[j], b[i] })
				v, _ = statistic(x, b)
			}
			if math.Abs(v) >= math.Abs(estimate)*(1-1e-12) {
				extreme++
			}
		}
		p := float64(extreme+1) / 2000
		out.PValue = &p
		out.Permutations = 1999
		out.Assumptions = append(out.Assumptions, "Two-sided Monte Carlo test: 1999 transformations, absolute statistic, plus-one p-value correction. No correction across multiple tests.")
	}
	out.Summary = fmt.Sprintf("%s = %.6g; approximate 95%% bootstrap interval [%.6g, %.6g].", label, estimate, out.Intervals[label][0], out.Intervals[label][1])
	if out.PValue != nil {
		out.Summary += fmt.Sprintf(" Two-sided permutation p = %.6g.", *out.PValue)
	}
	if d, ok := out.Metrics["cohensD"]; ok {
		out.Summary += fmt.Sprintf(" Cohen's d = %.6g.", d)
	}
	return finish(nil)
}
