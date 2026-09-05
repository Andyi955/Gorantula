package models

// Research corpus persistence filenames (kept in the research store root).
const (
	ResearchPapersFile     = "papers.json"
	ResearchClaimsFile     = "claims.json"
	ResearchRelationsFile  = "relations.json"
	ResearchSignalsFile    = "signals.json"
	ResearchCandidatesFile = "candidates.json"
)

// Claim relation kinds.
const (
	ClaimRelationSupports    = "SUPPORTS"
	ClaimRelationContradicts = "CONTRADICTS"
	ClaimRelationConverges   = "CONVERGES"
	ClaimRelationDiverges    = "DIVERGES"
)

// Research signal kinds.
const (
	ResearchSignalContradiction = "contradiction"
	ResearchSignalConvergence   = "convergence"
	ResearchSignalDivergence    = "divergence"
	ResearchSignalHypothesis    = "hypothesis"
	ResearchSignalGap           = "gap"
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

// ClaimRelation links two claims that share entities across papers.
type ClaimRelation struct {
	ID            string   `json:"id"`
	SourceClaimID string   `json:"sourceClaimID"`
	TargetClaimID string   `json:"targetClaimID"`
	RelationKind  string   `json:"relationKind"`
	Basis         []string `json:"basis,omitempty"`
	Strength      float32  `json:"strength,omitempty"`
	CreatedBy     string   `json:"createdBy,omitempty"`
}

// ResearchSignal is a surfaced cross-paper finding (contradiction, convergence,
// divergence, hypothesis, or gap).
type ResearchSignal struct {
	ID        string   `json:"id"`
	Kind      string   `json:"kind"`
	Title     string   `json:"title"`
	ClaimIDs  []string `json:"claimIDs"`
	PaperIDs  []string `json:"paperIDs"`
	Reasoning string   `json:"reasoning,omitempty"`
	Strength  float32  `json:"strength,omitempty"`
	CreatedAt string   `json:"createdAt,omitempty"`
}

// CandidateHypothesis states (claim state machine).
const (
	CandidateStateProposed  = "proposed"
	CandidateStateReviewed  = "reviewed"
	CandidateStateTested    = "tested"
	CandidateStateSupported = "supported"
	CandidateStateRefuted   = "refuted"
	CandidateStateApproved  = "approved"
	CandidateStateRejected  = "rejected"
)

// Candidate verdicts from the bounded review checklist.
const (
	CandidateVerdictAgreed   = "agreed"
	CandidateVerdictDisputed = "disputed"
	CandidateVerdictRefuted  = "refuted"
)

// ChecklistItem is a single criterion in the bounded claim review.
type ChecklistItem struct {
	ID         string  `json:"id"`
	Question   string  `json:"question"`
	Answer     string  `json:"answer"` // yes | no | unknown
	Grade      string  `json:"grade"`  // evidence grade for this item
	Reason     string  `json:"reason,omitempty"`
	Confidence float32 `json:"confidence,omitempty"`
}

// ChecklistReviewItem is a single criterion answer returned by a reviewer
// persona (the bounded-review debate roster).
type ChecklistReviewItem struct {
	ID         string  `json:"id"`
	Answer     string  `json:"answer"` // yes | no | unknown
	Reason     string  `json:"reason,omitempty"`
	Confidence float32 `json:"confidence,omitempty"`
}

// ChecklistReviewResponse is the JSON shape a reviewer persona returns.
type ChecklistReviewResponse struct {
	Items     []ChecklistReviewItem `json:"items"`
	Rationale string                `json:"rationale,omitempty"`
}

// CandidateExpansion records a bounded evidence-expansion round: the criteria
// attempted and the related papers fetched to try to resolve them.
type CandidateExpansion struct {
	Round     int      `json:"round"`
	Criteria  []string `json:"criteria,omitempty"`
	Retrieved []Paper  `json:"retrieved,omitempty"`
}

// CandidateHypothesis is a surfaced cross-paper finding promoted to a
// reviewable hypothesis with a novelty score, a checklist, and a state.
type CandidateHypothesis struct {
	ID            string              `json:"id"`
	SignalID      string              `json:"signalID"`
	Hypothesis    string              `json:"hypothesis"`
	Supporting    []string            `json:"supporting,omitempty"`
	Contradicting []string            `json:"contradicting,omitempty"`
	ClaimIDs      []string            `json:"claimIDs,omitempty"`
	PaperIDs      []string            `json:"paperIDs,omitempty"`
	NoveltyScore  float32             `json:"noveltyScore,omitempty"`
	NearestWork   string              `json:"nearestWork,omitempty"`
	Checklist     []ChecklistItem     `json:"checklist,omitempty"`
	Expansion     *CandidateExpansion `json:"expansion,omitempty"`
	Verdict       string              `json:"verdict,omitempty"`
	Rationale     string              `json:"rationale,omitempty"`
	EvidenceGrade string              `json:"evidenceGrade,omitempty"`
	State         string              `json:"state"`
	ApprovedBy    string              `json:"approvedBy,omitempty"`
	ApprovedAt    string              `json:"approvedAt,omitempty"`
	CreatedAt     string              `json:"createdAt,omitempty"`
}
