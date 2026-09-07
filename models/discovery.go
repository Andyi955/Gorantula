package models

// DiscoveryQuestion is one candidate question the autonomous discovery engine
// proposed and ran. Worked means it produced at least one recorded computation
// (a figure/finding); rejected means no usable data was found and no result was
// fabricated.
type DiscoveryQuestion struct {
	ID          string `json:"id"`
	Question    string `json:"question"`
	Status      string `json:"status"`   // completed | rejected | failed
	HasResult   bool   `json:"hasResult"`
	ResultsCount int   `json:"resultsCount"`
	PublicationID string `json:"publicationId,omitempty"`
	Hypothesis  string `json:"hypothesis,omitempty"`
	Interpretation string `json:"interpretation,omitempty"`
	Error       string `json:"error,omitempty"`
	RunID       string `json:"runId,omitempty"`
}

// DiscoveryRun is a batch of autonomous discovery: a set of questions proposed
// and run, each scored as a worked discovery or a no-data rejection.
type DiscoveryRun struct {
	ID        string `json:"id"`
	Theme     string `json:"theme"`
	Status    string `json:"status"` // running | completed | failed
	CreatedAt string `json:"createdAt"`
	CompletedAt string `json:"completedAt,omitempty"`
	Questions []DiscoveryQuestion `json:"questions"`
	WorkedCount int  `json:"workedCount"`
	RejectedCount int `json:"rejectedCount"`
	Error     string `json:"error,omitempty"`
}
