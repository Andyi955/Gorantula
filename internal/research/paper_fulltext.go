package research

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/Andyi955/Gorantula/models"
	"github.com/PuerkitoBio/goquery"
)

// fullTextFetchLimit bounds any full-text retrieval. Full texts are large but a
// single paper's body is comfortably under this; the claim extractor truncates
// defensively anyway.
const fullTextFetchLimit = 4 << 20

// paperFullTextFetch fetches a full-text body. It is a variable so tests can
// stub it without network; production uses the bounded, public-URL-and-IP safe
// fetcher.
var paperFullTextFetch = fetchResearchURL

var pmcIDRe = regexp.MustCompile(`(?i)\bPMC\d+\b`)
var xmlBodyRe = regexp.MustCompile(`(?is)<body[^>]*>(.*?)</body>`)
var xmlTagRe = regexp.MustCompile(`<[^>]+>`)

// paperFullTextEndpoint returns the open/public full-text URL for a paper where
// an accessible rendering exists: Europe PMC open-access article XML (from its
// PMCID) or an arXiv HTML article. OK is false when the paper has no known
// open full-text source, so the caller keeps the abstract and reports honestly.
func paperFullTextEndpoint(paper models.Paper) (endpoint string, ok bool) {
	if pmcid := extractPMCID(paper); pmcid != "" {
		return "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/" + pmcid + "/fullTextXML", true
	}
	if u, err := url.Parse(paper.SourceURL); err == nil && u.Hostname() == "arxiv.org" && strings.HasPrefix(u.Path, "/abs/") {
		return "https://arxiv.org/html/" + strings.TrimPrefix(u.Path, "/abs/"), true
	}
	return "", false
}

// extractPMCID pulls the PubMed Central ID from a paper's access points. It
// never invents one; empty means no PMCID is recorded and no PMC full text is
// fetched.
func extractPMCID(paper models.Paper) string {
	for _, candidate := range []string{paper.SourceURL, paper.ID, paper.DOI} {
		if m := pmcIDRe.FindString(candidate); m != "" {
			return strings.ToUpper(m)
		}
	}
	return ""
}

// fetchPaperFullText retrieves an open full text for the paper. A paper with no
// open full-text source returns an error rather than a fabricated body; the
// caller keeps the abstract and records the limitation.
func fetchPaperFullText(ctx context.Context, paper models.Paper) (string, error) {
	endpoint, ok := paperFullTextEndpoint(paper)
	if !ok {
		return "", fmt.Errorf("no open full-text endpoint for %s", paper.ID)
	}
	data, _, err := paperFullTextFetch(ctx, endpoint, fullTextFetchLimit)
	if err != nil {
		return "", err
	}
	text := fullTextFromBody(endpoint, data)
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("empty full text from %s", endpoint)
	}
	return text, nil
}

// fullTextFromBody converts an XML (Europe PMC) or HTML (arXiv) full-text body
// into plain prose, stripping markup so the claim extractor and source screener
// see readable text. Markup is removed; nothing is added or rewritten.
func fullTextFromBody(endpoint string, data []byte) string {
	if strings.Contains(endpoint, "/fullTextXML") {
		return extractXMLBodyText(data)
	}
	return extractHTMLText(data)
}

// extractHTMLText removes script/style/navigation and collapses whitespace.
// It prefers the article element, falling back to the body.
func extractHTMLText(data []byte) string {
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(data))
	if err != nil {
		return ""
	}
	doc.Find("script,style,nav,footer,header,aside,form").Remove()
	body := doc.Find("article").First()
	if body.Length() == 0 {
		body = doc.Find("body").First()
	}
	if body.Length() == 0 {
		return ""
	}
	return strings.Join(strings.Fields(body.Text()), " ")
}

// extractXMLBodyText returns the text of the <body> element of a Europe PMC
// full-text XML document, unescaping entities and collapsing whitespace.
func extractXMLBodyText(data []byte) string {
	s := string(data)
	if m := xmlBodyRe.FindStringSubmatch(s); len(m) == 2 {
		s = m[1]
	}
	s = xmlTagRe.ReplaceAllString(s, " ")
	s = strings.NewReplacer("&lt;", "<", "&gt;", ">", "&amp;", "&", "&quot;", `"`, "&apos;", "'", "&#x2013;", "-", "&#x2014;", "-").Replace(s)
	return strings.Join(strings.Fields(s), " ")
}
