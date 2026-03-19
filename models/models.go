package models

import "sync"

// Represents the data digested by the spider
type Abdomen struct {
	MemoryContext []string // Extracted text and facts
	Mutex         sync.RWMutex
}

// Represents a command sent from Brain to Leg
type NerveSignal struct {
	TargetQuery string // Can be a URL, file path, or chunk index "Chunk 1/10"
	LegID       int
	IsLocal     bool // True if TargetQuery is a local file path
	IsChunk     bool // True if this signal contains a pre-parsed text chunk
	ChunkData   string
	IsMedia     bool // True if TargetQuery is a media URL (e.g. YouTube, podcast)
}

// Represents data sent from Leg back to Abdomen
type NutrientFlow struct {
	LegID     int
	SourceURL string
	Content   string
	Error     error
}

// Global state for the Bubble Tea UI
type SpiderUIModel struct {
	BrainState    string         // e.g., "Thinking", "Instructing"
	LegStates     map[int]string // e.g., 0: "Idle", 1: "Searching Brave", 2: "Scraping URL"
	TotalGathered int
}

// UI State update messages sent via bubbletea
type BrainStateMsg string
type LegStateMsg struct {
	LegID int
	State string
}
type NutrientGatheredMsg struct{}
type QuitMsg struct{}

// SynthesisCompleteMsg contains the final response and the file path where memory is stored.
type SynthesisCompleteMsg struct {
	Result    string
	VaultPath string
}

// WSMessage is the generic JSON payload for the frontend
type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// Broadcaster is a function that sends a message to all connected clients
type Broadcaster func(msg WSMessage)

// MemoryNode represents a single piece of evidence on the board
type MemoryNode struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Summary   string `json:"summary"` // 2-sentence summary
	FullText  string `json:"fullText"`
	SourceURL string `json:"sourceURL"`
}

// BoardConnection represents an edge between two nodes with its reasoning
type BoardConnection struct {
	Source             string   `json:"source"`
	Target             string   `json:"target"`
	Tag                string   `json:"tag"`       // Short relationship tag (e.g., "INTEGRATION")
	Reasoning          string   `json:"reasoning"` // Detailed explanation
	Confidence         float32  `json:"confidence,omitempty"`
	QualityScore       float32  `json:"qualityScore,omitempty"`
	SupportingPersonas []string `json:"supportingPersonas,omitempty"`
	EvidenceNodeIDs    []string `json:"evidenceNodeIDs,omitempty"`
	ValidationStatus   string   `json:"validationStatus,omitempty"`
	RejectionReason    string   `json:"rejectionReason,omitempty"`
	CandidateSources   []string `json:"candidateSources,omitempty"`
}

type RelationshipCandidate struct {
	Source             string   `json:"source"`
	Target             string   `json:"target"`
	Tag                string   `json:"tag"`
	Reasoning          string   `json:"reasoning"`
	Confidence         float32  `json:"confidence"`
	EvidenceNodeIDs    []string `json:"evidenceNodeIDs"`
	SupportingPersonas []string `json:"supportingPersonas,omitempty"`
	CandidateSource    string   `json:"candidateSource,omitempty"`
	AgreementScore     float32  `json:"agreementScore,omitempty"`
	EvidenceScore      float32  `json:"evidenceScore,omitempty"`
	SpecificityScore   float32  `json:"specificityScore,omitempty"`
	GroundingScore     float32  `json:"groundingScore,omitempty"`
	QualityScore       float32  `json:"qualityScore,omitempty"`
	ValidationStatus   string   `json:"validationStatus,omitempty"`
	RejectionReason    string   `json:"rejectionReason,omitempty"`
}

type RelationshipDebugNode struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Summary  string `json:"summary"`
	FullText string `json:"fullText,omitempty"`
}

type RelationshipDebugPersona struct {
	PersonaName         string                  `json:"personaName"`
	Confidence          float32                 `json:"confidence"`
	NodeIDs             []string                `json:"nodeIDs"`
	KeyFindings         []string                `json:"keyFindings"`
	Connections         []string                `json:"connections"`
	Questions           []string                `json:"questions"`
	ProposedConnections []RelationshipCandidate `json:"proposedConnections,omitempty"`
}

type RelationshipDebugRun struct {
	VaultID          string                   `json:"vaultId"`
	CreatedAt        string                   `json:"createdAt"`
	Stage            string                   `json:"stage"`
	InputNodes       []RelationshipDebugNode  `json:"inputNodes"`
	PersonaSummaries []RelationshipDebugPersona `json:"personaSummaries"`
	Candidates       []RelationshipCandidate  `json:"candidates"`
	FinalConnections []BoardConnection        `json:"finalConnections"`
	Notes            []string                 `json:"notes,omitempty"`
}

// Discovery represents a derived breakthrough identified from linked evidence.
type Discovery struct {
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Claim         string   `json:"claim"`
	Impact        string   `json:"impact"`
	Confidence    float32  `json:"confidence"`
	SourceNodeIDs []string `json:"sourceNodeIDs"`
	SourceVaultID string   `json:"sourceVaultID"`
	CreatedAt     string   `json:"createdAt"`
	NodeKind      string   `json:"nodeKind"`
	Status        string   `json:"status,omitempty"`
	Topic         string   `json:"topic,omitempty"`
}

// DiscoveryReview captures an internal temporary expert review for one candidate discovery.
type DiscoveryReview struct {
	Reviewer               string  `json:"reviewer"`
	Verdict                string  `json:"verdict"`
	Confidence             float32 `json:"confidence"`
	Rationale              string  `json:"rationale"`
	FlagsCriticalIssue     bool    `json:"flagsCriticalIssue"`
	FlagsUnsupportedClaims bool    `json:"flagsUnsupportedClaims"`
	FlagsOverclaim         bool    `json:"flagsOverclaim"`
	RevisedTitle           string  `json:"revisedTitle,omitempty"`
	RevisedClaim           string  `json:"revisedClaim,omitempty"`
	RevisedImpact          string  `json:"revisedImpact,omitempty"`
}

// Investigation represents a session folder
type Investigation struct {
	ID    string            `json:"id"`
	Topic string            `json:"topic"`
	Nodes []MemoryNode      `json:"nodes"`
	Edges []BoardConnection `json:"edges"`
}

type MergedNode struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	Summary          string `json:"summary"`
	FullText         string `json:"fullText"`
	SourceURL        string `json:"sourceURL"`
	SourceVaultID    string `json:"sourceVaultId"`
	SourceNodeID     string `json:"sourceNodeId"`
	DerivedFromMerge bool   `json:"derivedFromMerge"`
}

type MergedEdge struct {
	ID        string `json:"id"`
	Source    string `json:"source"`
	Target    string `json:"target"`
	Tag       string `json:"tag"`
	Reasoning string `json:"reasoning"`
}

type MergeInvestigationsPayload struct {
	ChildVaultID string       `json:"childVaultId"`
	ChildTopic   string       `json:"childTopic"`
	ParentIDs    []string     `json:"parentIds"`
	Nodes        []MergedNode `json:"nodes"`
	Edges        []MergedEdge `json:"edges"`
}
