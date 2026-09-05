package research

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/url"
	"path"
	"regexp"
	"strings"
)

const pmcPublicBucket = "https://pmc-oa-opendata.s3.amazonaws.com"

var pmcSupplementPath = regexp.MustCompile(`^/articles/(?:instance/([0-9]+)|PMC([0-9]+))/bin/([A-Za-z0-9_.-]+\.docx)$`)

// Resolve an exact supplement through PMC's public metadata, never guessed filenames or browser challenges.
func fetchPMCSupplement(ctx context.Context, original string, fetch func(context.Context, string) ([]byte, string, error)) ([]byte, string, error) {
	u, err := url.Parse(original)
	if err != nil || u.Host != "pmc.ncbi.nlm.nih.gov" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, "", fmt.Errorf("no official PMC fallback for this URL")
	}
	m := pmcSupplementPath.FindStringSubmatch(u.Path)
	if m == nil {
		return nil, "", fmt.Errorf("no official PMC fallback for this supplement path")
	}
	id := "PMC" + m[1] + m[2]
	listing, _, err := fetch(ctx, pmcPublicBucket+"/?list-type=2&prefix="+id+".&delimiter=%2F&max-keys=20")
	if err != nil {
		return nil, "", err
	}
	var list struct {
		Truncated bool `xml:"IsTruncated"`
		Prefixes  []struct {
			Prefix string `xml:"Prefix"`
		} `xml:"CommonPrefixes"`
	}
	if len(listing) > 65536 {
		return nil, "", fmt.Errorf("PMC version listing too large")
	}
	if err = xml.Unmarshal(listing, &list); err != nil {
		return nil, "", err
	}
	if list.Truncated || len(list.Prefixes) > 5 {
		return nil, "", fmt.Errorf("PMC version selection needs review")
	}
	var chosen, checksum string
	for _, item := range list.Prefixes {
		if !regexp.MustCompile(`^` + id + `\.[0-9]+/$`).MatchString(item.Prefix) {
			return nil, "", fmt.Errorf("invalid PMC article version prefix")
		}
		version := strings.TrimSuffix(item.Prefix, "/")
		data, _, e := fetch(ctx, pmcPublicBucket+"/"+item.Prefix+version+".json")
		if e != nil {
			return nil, "", e
		}
		var meta struct {
			PMCID     string   `json:"pmcid"`
			Open      bool     `json:"is_pmc_openaccess"`
			Retracted bool     `json:"is_retracted"`
			Media     []string `json:"media_urls"`
		}
		if len(data) > 1<<20 {
			return nil, "", fmt.Errorf("PMC metadata too large")
		}
		if e = json.Unmarshal(data, &meta); e != nil {
			return nil, "", e
		}
		if meta.PMCID != id || !meta.Open || meta.Retracted {
			continue
		}
		for _, media := range meta.Media {
			v, e := url.Parse(media)
			if e != nil || v.Scheme != "s3" || v.Host != "pmc-oa-opendata" || v.User != nil || v.Path != "/"+item.Prefix+m[3] || path.Base(v.Path) != m[3] {
				continue
			}
			hash := v.Query().Get("md5")
			decoded, e := hex.DecodeString(hash)
			if e != nil || len(decoded) != md5.Size {
				return nil, "", fmt.Errorf("PMC supplement checksum missing or invalid")
			}
			if chosen != "" {
				return nil, "", fmt.Errorf("multiple PMC versions contain this supplement; explicit version review required")
			}
			chosen, checksum = pmcPublicBucket+v.EscapedPath(), hash
		}
	}
	if chosen == "" {
		return nil, "", fmt.Errorf("supplement not listed in public, non-retracted PMC metadata")
	}
	data, final, err := fetch(ctx, chosen)
	if err != nil {
		return nil, "", err
	}
	hash := md5.Sum(data) // Integrity against repository metadata, not a scientific authenticity guarantee.
	if !strings.EqualFold(hex.EncodeToString(hash[:]), checksum) {
		return nil, "", fmt.Errorf("PMC supplement checksum mismatch")
	}
	return data, final, nil
}
