package models

// Publication approval is separate from evidential support and candidate review.
type PublicationAudit struct {
	Action   string `json:"action"`
	Operator string `json:"operator"`
	Reason   string `json:"reason"`
	Revision string `json:"revision"`
	At       string `json:"at"`
}
type PublicationFigure struct {
	ID           string              `json:"id"`
	Title        string              `json:"title"`
	Kind         string              `json:"kind"`
	Objective    string              `json:"objective"`
	Data         []VerificationGroup `json:"data,omitempty"`
	Metrics      map[string]float64  `json:"metrics,omitempty"`
	Caption      string              `json:"caption"`
	Alt          string              `json:"alt"`
	Style        string              `json:"style"`
	ResultDigest string              `json:"resultDigest"`
	PNG          []byte              `json:"png,omitempty"`
	ImageDigest  string              `json:"imageDigest,omitempty"`
}
type PublicationDraft struct {
	ID               string              `json:"id"`
	CandidateID      string              `json:"candidateId"`
	RunID            string              `json:"runId"`
	SourceRevision   string              `json:"sourceRevision"`
	Revision         string              `json:"revision"`
	Status           string              `json:"status"`
	EvidenceStatus   string              `json:"evidenceStatus"`
	Markdown         string              `json:"markdown"`
	Figures          []PublicationFigure `json:"figures"`
	Audit            []PublicationAudit  `json:"audit"`
	ApprovedRevision string              `json:"approvedRevision,omitempty"`
	ExportPath       string              `json:"exportPath,omitempty"`
	Stale            bool                `json:"stale"`
	ReviewIssues     []string            `json:"reviewIssues,omitempty"`
	CreatedAt        string              `json:"createdAt"`
	Candidate        CandidateHypothesis `json:"candidate"`
	Claims           []Claim             `json:"claims"`
	Papers           []Paper             `json:"papers"`
	Relations        []ClaimRelation     `json:"relations"`
	Run              VerificationRun     `json:"run"`
}
