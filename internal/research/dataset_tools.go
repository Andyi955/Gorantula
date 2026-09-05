package research

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Andyi955/Gorantula/models"
	"github.com/PuerkitoBio/goquery"
)

// Resolve and dial the checked IP itself: redirects and DNS changes cannot turn
// a public dataset URL into a request to a local service. No ambient proxy/auth.
func publicDatasetIP(ip net.IP) bool {
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() &&
		!reservedDatasetIP(ip)
}

func reservedDatasetIP(ip net.IP) bool {
	for _, block := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001::/32", "2001:db8::/32", "2002::/16", "64:ff9b::/96", "64:ff9b:1::/48"} {
		_, subnet, _ := net.ParseCIDR(block)
		if subnet.Contains(ip) {
			return true
		}
	}
	return false
}

func fetchDatasetURL(ctx context.Context, raw string) ([]byte, string, error) {
	return fetchResearchURL(ctx, raw, maxDatasetBytes)
}

func fetchResearchURL(ctx context.Context, raw string, limit int64) ([]byte, string, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil || (u.Port() != "" && u.Port() != "443" && u.Port() != "80") {
		return nil, "", fmt.Errorf("a public HTTP(S) URL without credentials or custom ports is required")
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("host has no addresses")
		}
		for _, ip := range ips {
			if !publicDatasetIP(ip.IP) {
				return nil, fmt.Errorf("dataset host must resolve only to public addresses")
			}
		}
		return (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 20 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 4 || req.URL.User != nil || (req.URL.Scheme != "https" && req.URL.Scheme != "http") || (req.URL.Port() != "" && req.URL.Port() != "443" && req.URL.Port() != "80") {
			return fmt.Errorf("unsupported dataset redirect")
		}
		return nil
	}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("dataset source returned HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > limit {
		return nil, "", fmt.Errorf("source exceeds %d MiB", limit>>20)
	}
	return data, resp.Request.URL.String(), nil
}

func inspectDataset(d models.ResearchDataset) (models.DatasetResult, error) {
	headers, rows, err := parseVerificationCSV(d.CSV)
	if err != nil {
		return models.DatasetResult{}, err
	}
	out := models.DatasetResult{DatasetID: d.ID, Summary: fmt.Sprintf("%d rows. Blank, NA, N/A and null are reported as missing; no values are filled. Units are not inferred: consult the source and column headers. Data origin (measured, extracted or synthetic) must be checked against provenance.", len(rows))}
	for i, h := range headers {
		col := models.DatasetColumn{Name: h}
		for _, row := range rows {
			cell := strings.TrimSpace(row[i])
			if missingDatasetCell(cell) {
				col.Missing++
				continue
			}
			n, e := strconv.ParseFloat(cell, 64)
			if e != nil || math.IsNaN(n) || math.IsInf(n, 0) {
				col.Text++
				continue
			}
			col.Numeric++
			if col.Min == nil || n < *col.Min {
				v := n
				col.Min = &v
			}
			if col.Max == nil || n > *col.Max {
				v := n
				col.Max = &v
			}
		}
		out.Columns = append(out.Columns, col)
	}
	out.Sample = rows[:min(5, len(rows))]
	return out, nil
}
func missingDatasetCell(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "na", "n/a", "null":
		return true
	}
	return false
}

func (s *Service) filterDataset(d models.ResearchDataset, call models.DatasetCall) (models.ResearchDataset, error) {
	if strings.TrimSpace(call.Rationale) == "" || len(call.Rationale) > 2000 || len(call.Value) > 4096 {
		return d, fmt.Errorf("provide a bounded filter and rationale")
	}
	headers, rows, err := parseVerificationCSV(d.CSV)
	if err != nil {
		return d, err
	}
	index := -1
	for i, h := range headers {
		if h == call.Column {
			index = i
		}
	}
	if index < 0 {
		return d, fmt.Errorf("unknown filter column")
	}
	var target float64
	switch call.Operator {
	case "eq", "ne", "not-missing":
	case "gt", "gte", "lt", "lte":
		target, err = strconv.ParseFloat(call.Value, 64)
		if err != nil || math.IsNaN(target) || math.IsInf(target, 0) {
			return d, fmt.Errorf("filter value must be finite")
		}
	default:
		return d, fmt.Errorf("unsupported filter operator")
	}
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	_ = w.Write(headers)
	kept := 0
	for _, row := range rows {
		cell := row[index]
		keep := false
		switch call.Operator {
		case "eq":
			keep = cell == call.Value
		case "ne":
			keep = cell != call.Value
		case "not-missing":
			keep = !missingDatasetCell(cell)
		default:
			n, e := strconv.ParseFloat(strings.TrimSpace(cell), 64)
			if e == nil && !math.IsNaN(n) && !math.IsInf(n, 0) {
				switch call.Operator {
				case "gt":
					keep = n > target
				case "gte":
					keep = n >= target
				case "lt":
					keep = n < target
				case "lte":
					keep = n <= target
				}
			}
		}
		if keep {
			_ = w.Write(row)
			kept++
		}
	}
	w.Flush()
	if w.Error() != nil {
		return d, w.Error()
	}
	if kept < 2 {
		return d, fmt.Errorf("filter leaves fewer than two rows")
	}
	child := models.ResearchDataset{Name: d.Name, Source: d.Source, CSV: buf.String(), Digest: digestBytes(buf.Bytes()), Columns: headers, Rows: kept, ParentID: d.ID, ParentDigest: d.Digest, Filter: &call}
	encoded, _ := json.Marshal(child)
	child.ID = digestBytes(encoded)
	return child, s.verificationStore("datasets").saveSlice(child.ID+".json", child)
}

func datasetLinks(data []byte, base string) []string {
	u, err := url.Parse(base)
	if err != nil {
		return nil
	}
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(data))
	if err != nil {
		return nil
	}
	links := []string{}
	seen := map[string]bool{}
	doc.Find("a[href]").Each(func(_ int, sel *goquery.Selection) {
		if len(links) >= 20 {
			return
		}
		href, _ := sel.Attr("href")
		ref, err := url.Parse(href)
		if err != nil {
			return
		}
		resolved := u.ResolveReference(ref)
		resolved.Fragment = ""
		label := strings.ToLower(href + " " + sel.Text())
		if (resolved.Scheme == "http" || resolved.Scheme == "https") && resolved.User == nil && (strings.Contains(label, ".csv") || strings.Contains(label, "supplement") || strings.Contains(label, "dataset") || strings.Contains(label, "data availability")) && !seen[resolved.String()] {
			seen[resolved.String()] = true
			links = append(links, resolved.String())
		}
	})
	return links
}

// Only candidate paper URLs and links actually returned by discovery are usable
// by the model. Uploaded CSV values can never become network destinations.
func (s *Service) executeDatasetCall(ctx context.Context, run *models.VerificationRun, call models.DatasetCall) models.DatasetResult {
	fetch := fetchDatasetURL
	if s.datasetFetch != nil {
		fetch = s.datasetFetch
	}
	if call.Tool == "paper-scan" || call.Tool == "paper-complex-table" || (call.Tool == "paper-docx" && s.datasetFetch == nil) {
		fetch = func(ctx context.Context, u string) ([]byte, string, error) {
			return fetchResearchURL(ctx, u, maxPDFBytes)
		}
	}
	out := s.executeDatasetCallWithFetcher(ctx, run, call, fetch)
	// Every newly selected snapshot gets structural checks, even if the model forgets to ask.
	if out.Error == "" && out.DatasetID != "" && run.Dataset.ID == out.DatasetID && call.Tool != "dataset-validate" {
		checked, err := validateDataset(run.Dataset, models.DatasetCall{Tool: "dataset-validate"})
		if err != nil {
			out.Error = err.Error()
		} else {
			out.Counts, out.Columns = checked.Counts, checked.Columns
			out.Warnings = append(out.Warnings, checked.Warnings...)
			out.Warnings = append(out.Warnings, "Structural checks do not establish relevance, measured origin, or independent study units. Check the source before interpreting results.")
		}
	}
	return out
}

func (s *Service) executeDatasetCallWithFetcher(ctx context.Context, run *models.VerificationRun, call models.DatasetCall, fetch func(context.Context, string) ([]byte, string, error)) models.DatasetResult {
	switch call.Tool {
	case "dataset-validate", "dataset-join", "evidence-lookup", "paper-extract", "paper-table", "paper-scan", "paper-complex-table", "paper-docx":
		return s.executeResearchDataTool(ctx, run, call, fetch)
	}
	out := models.DatasetResult{Call: call}
	if call.Tool != "dataset-filter" && call.Tool != "dataset-use" && (call.Column != "" || call.Operator != "" || call.Value != "" || call.Rationale != "") {
		out.Error = "this dataset tool does not accept filter arguments"
		return out
	}
	if (call.Tool == "dataset-filter" || call.Tool == "dataset-inspect") && call.URL != "" {
		out.Error = "local dataset tools do not accept URLs"
		return out
	}
	var err error
	allowed := false
	for _, u := range run.PaperSources {
		if u == call.URL {
			allowed = true
		}
	}
	for _, r := range run.DatasetActions {
		for _, u := range r.Links {
			if u == call.URL {
				allowed = true
			}
		}
	}
	switch call.Tool {
	case "dataset-use":
		if hasSuccessfulCalculation(run.Results) {
			err = fmt.Errorf("dataset is frozen after the first successful calculation")
			break
		}
		if strings.TrimSpace(call.Rationale) == "" || call.URL != "" || call.Column != "" || call.Operator != "" || call.Value != "" {
			err = fmt.Errorf("dataset-use requires an existing datasetId and a relevance rationale, not a URL or filter")
			break
		}
		var d models.ResearchDataset
		d, err = s.loadDataset(call.DatasetID)
		if err == nil {
			// Keep earlier calculation inputs for replay if selection follows a failure.
			if run.Dataset.ID != "" {
				run.DatasetParents = append(run.DatasetParents, run.Dataset)
			}
			run.Dataset = d
			out, err = inspectDataset(d)
			out.Call, out.DatasetID = call, d.ID
			out.Summary = "Selected and inspected saved data. Relevance rationale: " + call.Rationale + ". " + out.Summary
		}
	case "dataset-discover", "dataset-import":
		if !allowed {
			err = fmt.Errorf("URL must be a candidate paper source or an observed dataset link")
			break
		}
		if call.Tool == "dataset-import" && hasSuccessfulCalculation(run.Results) {
			err = fmt.Errorf("dataset is frozen after the first successful calculation")
			break
		}
		var data []byte
		var source string
		data, source, err = fetch(ctx, call.URL)
		if err != nil {
			break
		}
		if call.Tool == "dataset-discover" {
			out.Links = datasetLinks(data, source)
			// Preserve destination-page context so a repository lead can be checked against its actual parent paper.
			if bytes.Contains(bytes.ToLower(data), []byte("<html")) {
				if doc, e := goquery.NewDocumentFromReader(bytes.NewReader(data)); e == nil {
					doc.Find("script,style,nav,header,footer").Remove()
					pageText := strings.Join(strings.Fields(doc.Find("title").Text()+" "+doc.Find("body").Text()), " ")
					if len([]rune(pageText)) > 12000 {
						pageText = string([]rune(pageText)[:12000])
					}
					out.Passages = []models.EvidencePassage{{Source: source, Digest: digestBytes(data), Text: pageText}}
				}
			}
			if _, _, e := parseVerificationCSV(string(data)); e == nil {
				out.Links = append(out.Links, call.URL)
			}
			out.Summary = fmt.Sprintf("Found %d observed CSV or supplementary links. No links means data was not found on this page; Use paper-docx for DOCX supplements or the PDF tools for PDFs; arbitrary ZIP datasets are unsupported.", len(out.Links))
		} else {
			var d models.ResearchDataset
			d, err = s.RegisterDataset("Imported CSV", source+" (retrieved "+time.Now().UTC().Format(time.RFC3339)+"; origin unverified)", string(data))
			if err == nil {
				run.Dataset = d
				out.DatasetID = d.ID
				out.Summary = fmt.Sprintf("Imported %d rows without changing the source bytes. Inspect before calculating.", d.Rows)
			}
		}
	case "dataset-inspect":
		if run.Dataset.ID == "" {
			err = fmt.Errorf("no dataset selected: use dataset-use with an availableDatasets id and relevance rationale, or dataset-discover followed by dataset-import; do not repeat dataset-inspect before selecting data")
			break
		}
		out, err = inspectDataset(run.Dataset)
		out.Call = call
	case "dataset-filter":
		if hasSuccessfulCalculation(run.Results) {
			err = fmt.Errorf("dataset is frozen after the first successful calculation")
			break
		}
		var d models.ResearchDataset
		d, err = s.filterDataset(run.Dataset, call)
		if err == nil {
			run.DatasetParents = append(run.DatasetParents, run.Dataset)
			out.Summary = fmt.Sprintf("Kept %d of %d rows. Original snapshot retained; filter and parent digest recorded.", d.Rows, run.Dataset.Rows)
			out.DatasetID = d.ID
			run.Dataset = d
		}
	default:
		err = fmt.Errorf("unknown dataset tool")
	}
	if err != nil {
		out.Error = err.Error()
	}
	return out
}
