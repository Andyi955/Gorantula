package models

// Research corpus persistence filenames (kept in the research store root).
const (
	ResearchPapersFile = "papers.json"
	ResearchClaimsFile = "claims.json"
)

// Paper is an ingested scientific paper (metadata + available text).
type Paper struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Authors    []string `json:"authors,omitempty"`
	Venue      string   `json:"venue,omitempty"`
	Year       int      `json:"year,omitempty"`
	Abstract   string   `json:"abstract,omitempty"`
	FullText   string   `json:"fullText,omitempty"`
	SourceURL  string   `json:"sourceURL,omitempty"`
	License    string   `json:"license,omitempty"`
	IngestedAt string   `json:"ingestedAt,omitempty"`
}

// Claim is a grounded, entity-tagged evidence claim extracted from a Paper.
type Claim struct {
	ID            string   `json:"id"`
	PaperID       string   `json:"paperId"`
	Text          string   `json:"text"`
	Kind          string   `json:"kind,omitempty"`
	Entities      []string `json:"entities,omitempty"`
	Confidence    float32  `json:"confidence,omitempty"`
	Provenance    string   `json:"provenance,omitempty"` // human label, e.g. "abstract" | "fullText §2"
	SourceOffset  int      `json:"sourceOffset,omitempty"`
	SourceSnippet string   `json:"sourceSnippet,omitempty"` // exact matched snippet (grounding)
}

// ClaimExtractionResponse is the JSON shape the claim-extractor persona returns.
type ClaimExtractionResponse struct {
	Claims []Claim `json:"claims"`
}
