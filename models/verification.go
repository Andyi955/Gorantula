package models

// ResearchDataset is an immutable, imported CSV snapshot. IDs include
// metadata so importing the same bytes with different provenance keeps both.
type ResearchDataset struct {
	ID                string       `json:"id"`
	Name              string       `json:"name"`
	Source            string       `json:"source"`
	CSV               string       `json:"csv,omitempty"`
	Digest            string       `json:"digest"`
	Columns           []string     `json:"columns"`
	Rows              int          `json:"rows"`
	ParentID          string       `json:"parentId,omitempty"`
	ParentDigest      string       `json:"parentDigest,omitempty"`
	Join              *DatasetCall `json:"join,omitempty"`
	OtherParentID     string       `json:"otherParentId,omitempty"`
	OtherParentDigest string       `json:"otherParentDigest,omitempty"`
	Filter            *DatasetCall `json:"filter,omitempty"`
}

// VerificationCall is the entire executable vocabulary; it contains no code,
// paths, shell arguments, or database statements.
// StudyDesign records a model assessment anchored to an actually retrieved quote.
// It is not independent certification of the study's assumptions.
type DesignFact struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	PaperID string `json:"paperId"`
	Quote   string `json:"quote"`
}

type StudyDesign struct {
	Facts         []DesignFact `json:"facts"`
	IDColumn      string       `json:"idColumn"`
	ClusterColumn string       `json:"clusterColumn,omitempty"`
	PaperID       string       `json:"paperId"`
	Quote         string       `json:"quote"`
	Unit          string       `json:"unit"`
	Structure     string       `json:"structure"`
	Independence  string       `json:"independence"`
	Basis         string       `json:"basis"`
	Limitations   string       `json:"limitations"`
}

type VerificationCall struct {
	Descriptive bool         `json:"descriptive,omitempty"`
	Design      *StudyDesign `json:"design,omitempty"`
	Tool        string       `json:"tool"`
	GroupColumn string       `json:"groupColumn"`
	ValueColumn string       `json:"valueColumn"`
	Statement   string       `json:"statement"`
	Rationale   string       `json:"rationale"`
}

type VerificationRequest struct {
	Topic       string             `json:"topic,omitempty"`
	AutoPrepare bool               `json:"autoPrepare,omitempty"`
	CandidateID string             `json:"candidateId"`
	DatasetID   string             `json:"datasetId"`
	Mode        string             `json:"mode"` // manual|agent|replay
	Calls       []VerificationCall `json:"calls,omitempty"`
	ReplayOf    string             `json:"replayOf,omitempty"`
}

type VerificationGroup struct {
	Name  string  `json:"name"`
	Count int     `json:"count"`
	Mean  float64 `json:"mean"`
}

type VerificationResult struct {
	InputDigest    string               `json:"inputDigest,omitempty"`
	Call           VerificationCall     `json:"call"`
	Status         string               `json:"status"`
	Verdict        string               `json:"verdict"` // inconclusive: computation does not adjudicate a hypothesis
	Summary        string               `json:"summary"`
	Assumptions    []string             `json:"assumptions"`
	Groups         []VerificationGroup  `json:"groups,omitempty"`
	MeanDifference *float64             `json:"meanDifference,omitempty"`
	PValue         *float64             `json:"pValue,omitempty"`
	Permutations   int                  `json:"permutations,omitempty"`
	Seed           int64                `json:"seed,omitempty"`
	SVG            string               `json:"svg,omitempty"`
	Metrics        map[string]float64   `json:"metrics,omitempty"`
	Intervals      map[string][]float64 `json:"intervals,omitempty"`
	OutputDigest   string               `json:"outputDigest"`
}

// A run owns a frozen evidence snapshot. Execution never mutates the candidate's
// review or publication state, including when that candidate is already approved.
type StudyReview struct {
	InputDigest    string           `json:"inputDigest"`
	Call           VerificationCall `json:"call"`
	Supported      bool             `json:"supported"`
	Reason         string           `json:"reason"`
	Contradictions []string         `json:"contradictions"`
	CheckedFacts   []string         `json:"checkedFacts"`
}

type ReportReview struct {
	Role     string   `json:"role"`
	Summary  string   `json:"summary"`
	Concerns []string `json:"concerns"`
}

type VerificationRun struct {
	SourceAssessments    []SourceAssessment          `json:"sourceAssessments,omitempty"`
	CompletedStages      []string                    `json:"completedStages,omitempty"`
	StageMessage         string                      `json:"stageMessage,omitempty"`
	ReportReviews        []ReportReview              `json:"reportReviews,omitempty"`
	PipelineStage        string                      `json:"pipelineStage,omitempty"`
	PublicationID        string                      `json:"publicationId,omitempty"`
	ReportError          string                      `json:"reportError,omitempty"`
	StudyReviews         []StudyReview               `json:"studyReviews,omitempty"`
	ID                   string                      `json:"id"`
	Request              VerificationRequest         `json:"request"`
	Candidate            CandidateHypothesis         `json:"candidate"`
	Claims               []Claim                     `json:"claims"`
	Dataset              ResearchDataset             `json:"dataset"`
	DatasetParents       []ResearchDataset           `json:"datasetParents,omitempty"`
	DatasetActions       []DatasetResult             `json:"datasetActions,omitempty"`
	Papers               []Paper                     `json:"papers,omitempty"`
	Documents            []ResearchDocument          `json:"documents,omitempty"`
	PaperSources         []string                    `json:"paperSources,omitempty"`
	Status               string                      `json:"status"` // queued|running|completed|failed|cancelled|interrupted
	Results              []VerificationResult        `json:"results"`
	Error                string                      `json:"error,omitempty"`
	Interpretation       string                      `json:"interpretation,omitempty"` // model interpretation, not a tool result
	ToolVersion          string                      `json:"toolVersion"`
	ImplementationDigest string                      `json:"implementationDigest"`
	Runtime              string                      `json:"runtime"`
	CreatedAt            string                      `json:"createdAt"`
	CompletedAt          string                      `json:"completedAt,omitempty"`
	ReplayMatches        *bool                       `json:"replayMatches,omitempty"`
	TokenUsage           []PipelineProfileTokenUsage `json:"tokenUsage,omitempty"`
}

type VerificationAgentAction struct {
	Action         string            `json:"action"` // call|finish
	Call           *VerificationCall `json:"call,omitempty"`
	DatasetCall    *DatasetCall      `json:"datasetCall,omitempty"`
	Interpretation string            `json:"interpretation,omitempty"`
}

// Dataset calls accept data selectors, never executable expressions or code.
type DatasetCall struct {
	Tool            string            `json:"tool"`
	URL             string            `json:"url,omitempty"`
	Column          string            `json:"column,omitempty"`
	Operator        string            `json:"operator,omitempty"`
	Value           string            `json:"value,omitempty"`
	Rationale       string            `json:"rationale,omitempty"`
	PaperID         string            `json:"paperId,omitempty"`
	Query           string            `json:"query,omitempty"`
	Page            int               `json:"page,omitempty"`
	EndPage         int               `json:"endPage,omitempty"`
	Rotation        int               `json:"rotation,omitempty"`
	HeaderRows      int               `json:"headerRows,omitempty"`
	ColumnCuts      []float64         `json:"columnCuts,omitempty"`
	Region          []float64         `json:"region,omitempty"`
	JoinWrappedRows bool              `json:"joinWrappedRows,omitempty"`
	ExtractionID    string            `json:"extractionId,omitempty"`
	TableIndex      int               `json:"tableIndex,omitempty"`
	DatasetID       string            `json:"datasetId,omitempty"`
	RightKey        string            `json:"rightKey,omitempty"`
	IDColumn        string            `json:"idColumn,omitempty"`
	Units           map[string]string `json:"units,omitempty"`
	RightUnits      map[string]string `json:"rightUnits,omitempty"`
}
type DatasetColumn struct {
	Name    string   `json:"name"`
	Numeric int      `json:"numeric"`
	Missing int      `json:"missing"`
	Text    int      `json:"text"`
	Min     *float64 `json:"min,omitempty"`
	Max     *float64 `json:"max,omitempty"`
}
type DatasetResult struct {
	Call          DatasetCall       `json:"call"`
	DatasetID     string            `json:"datasetId,omitempty"`
	Summary       string            `json:"summary"`
	Error         string            `json:"error,omitempty"`
	Links         []string          `json:"links,omitempty"`
	Columns       []DatasetColumn   `json:"columns,omitempty"`
	Warnings      []string          `json:"warnings,omitempty"`
	Counts        map[string]int    `json:"counts,omitempty"`
	Passages      []EvidencePassage `json:"passages,omitempty"`
	Tables        []ExtractedTable  `json:"tables,omitempty"`
	ExtractionID  string            `json:"extractionId,omitempty"`
	OCRPages      []OCRPage         `json:"ocrPages,omitempty"`
	Engine        string            `json:"engine,omitempty"`
	EngineVersion string            `json:"engineVersion,omitempty"`
	Sample        [][]string        `json:"sample,omitempty"`
}

// Extracted tables are positional candidates, never authenticated measurements.
type ExtractedTable struct {
	Index       int                 `json:"index"`
	Page        int                 `json:"page"`
	Rows        [][]string          `json:"rows"`
	EndPage     int                 `json:"endPage,omitempty"`
	CellSources [][]TableCellSource `json:"cellSources,omitempty"`
	Warnings    []string            `json:"warnings,omitempty"`
}
type EvidencePassage struct {
	PaperID string `json:"paperId,omitempty"`
	Source  string `json:"source"`
	Digest  string `json:"digest"`
	Page    int    `json:"page,omitempty"`
	Offset  int    `json:"offset"`
	Text    string `json:"text"`
}
type ResearchDocument struct {
	Name   string `json:"name,omitempty"`
	URL    string `json:"url"`
	Digest string `json:"digest"`
	Bytes  []byte `json:"bytes,omitempty"`
}

// OCR boxes use percentages of the rendered page after the requested rotation.
// Windows OCR does not expose word confidence: never fabricate a score.
type OCRWord struct {
	Text   string  `json:"text"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}
type OCRPage struct {
	Page     int       `json:"page"`
	Words    []OCRWord `json:"words"`
	Language string    `json:"language"`
	Rotation int       `json:"rotation"`
}
type TableCellSource struct {
	Page       int       `json:"page"`
	Words      []OCRWord `json:"words,omitempty"`
	ColumnSpan int       `json:"columnSpan,omitempty"`
}

// SourceAssessment records the screening model's judgment and a server-checked source excerpt.
type SourceAssessment struct {
	ExcerptIndex *int   `json:"excerptIndex,omitempty"`
	PaperID      string `json:"paperId"`
	Relevance    string `json:"relevance"`
	DataKind     string `json:"dataKind"`
	Quote        string `json:"quote"`
	Limitations  string `json:"limitations"`
}
