package research

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"github.com/Andyi955/Gorantula/models"
)

type preparationRequest struct {
	CandidateID string             `json:"candidateId"`
	DatasetID   string             `json:"datasetId"`
	SessionID   string             `json:"sessionId,omitempty"`
	Call        models.DatasetCall `json:"call"`
}

// Preparation sessions preserve source documents and previous extraction results
// server-side. Clients cannot submit their own alleged table extraction output.
func (s *Service) prepareResearchData(ctx context.Context, req preparationRequest) (map[string]interface{}, error) {
	run := models.VerificationRun{}
	if req.SessionID != "" {
		if !verificationID.MatchString(req.SessionID) {
			return nil, fmt.Errorf("invalid preparation ID")
		}
		if err := s.verificationStore("preparations").readJSON(req.SessionID+".json", &run); err != nil {
			return nil, err
		}
		if run.ID != req.SessionID || run.Candidate.ID != req.CandidateID {
			return nil, fmt.Errorf("preparation candidate mismatch")
		}
	}
	if run.ID == "" {
		candidates, err := s.ListCandidates()
		if err != nil {
			return nil, err
		}
		for _, c := range candidates {
			if c.ID == req.CandidateID {
				run.Candidate = c
			}
		}
		if run.Candidate.ID == "" {
			return nil, fmt.Errorf("select an existing candidate")
		}
		papers, err := s.ListPapers()
		if err != nil {
			return nil, err
		}
		for _, p := range papersForCandidate(run.Candidate, papers) {
			if len(run.Papers) >= 5 {
				break
			}
			if len(p.FullText) > 200000 {
				p.FullText = boundedPaperText(p.FullText)
			}
			run.Papers = append(run.Papers, p)
			if p.SourceURL != "" {
				run.PaperSources = append(run.PaperSources, p.SourceURL)
			}
		}
	}
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	run.ID = hex.EncodeToString(b)
	if len(run.DatasetActions) >= 20 {
		return nil, fmt.Errorf("preparation budget reached; start a new preparation")
	}
	run.Dataset = models.ResearchDataset{}
	if req.DatasetID != "" {
		d, err := s.loadDataset(req.DatasetID)
		if err != nil {
			return nil, err
		}
		run.Dataset = d
	}
	result := s.executeDatasetCall(ctx, &run, req.Call)
	run.DatasetActions = append(run.DatasetActions, result)
	if err := s.verificationStore("preparations").saveSlice(run.ID+".json", run); err != nil {
		return nil, err
	}
	run.Dataset.CSV = ""
	return map[string]interface{}{"sessionId": run.ID, "result": result, "dataset": run.Dataset}, nil
}
