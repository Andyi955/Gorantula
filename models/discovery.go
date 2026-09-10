package models

// DiscoveryQuestion is one candidate question the autonomous discovery engine
// proposed and ran. Worked means it produced at least one recorded computation
// (a figure/finding); rejected means no usable data was found and no result was
// fabricated.
//
// Running is published while the question is in flight so a caller can follow
// along; stopped and skipped record an operator stop or a round that ended
// before every proposed question was reached.
type DiscoveryQuestion struct {
	ID          string `json:"id"`
	Question    string `json:"question"`
	Status      string `json:"status"` // running | completed | rejected | failed | stopped | skipped
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
	Status    string `json:"status"` // running | completed | failed | stopped
	CreatedAt string `json:"createdAt"`
	CompletedAt string `json:"completedAt,omitempty"`
	Questions []DiscoveryQuestion `json:"questions"`
	// Planned is how many questions the round proposed, so a caller can show
	// progress and account for questions that were never reached.
	Planned int `json:"planned,omitempty"`
	WorkedCount int  `json:"workedCount"`
	RejectedCount int `json:"rejectedCount"`
	// StopOnResult ends the round as soon as one question produces a result.
	StopOnResult bool `json:"stopOnResult,omitempty"`
	// StopReason explains an early ending in plain language.
	StopReason string `json:"stopReason,omitempty"`
	Error     string `json:"error,omitempty"`
	Dismissed   bool   `json:"dismissed"`
	DismissedAt string `json:"dismissedAt,omitempty"`
}
