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
	Source    string `json:"source"`
	Target    string `json:"target"`
	Tag       string `json:"tag"`       // Short relationship tag (e.g., "INTEGRATION")
	Reasoning string `json:"reasoning"` // Detailed explanation
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
