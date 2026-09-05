package research

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
)

// Service is the research engine: a persistent corpus store, the claim
// extractor backed by the brain's provider, a deterministic claim-relation
// graph + signal surfacing layer, and a candidate hypotheses + bounded review
// pipeline. Every phase emits a followable trace line so a run can be debugged.
type Service struct {
	store     *Store
	brain     *brain.Brain
	novelty   NoveltyChecker
	retriever EvidenceRetriever
}

func NewService(root string, br *brain.Brain) *Service {
	openAlex := NewOpenAlexNoveltyChecker()
	return &Service{
		store:     NewStore(root),
		brain:     br,
		novelty:   openAlex,
		retriever: openAlex,
	}
}

// SetNoveltyChecker overrides the novelty checker (used by tests).
func (s *Service) SetNoveltyChecker(checker NoveltyChecker) {
	s.novelty = checker
}

// SetEvidenceRetriever overrides the evidence retriever (used by tests).
func (s *Service) SetEvidenceRetriever(retriever EvidenceRetriever) {
	s.retriever = retriever
}

// ListPapers returns all ingested papers.
func (s *Service) ListPapers() ([]models.Paper, error) {
	return s.store.LoadPapers()
}

// ListClaims returns all extracted claims.
func (s *Service) ListClaims() ([]models.Claim, error) {
	return s.store.LoadClaims()
}

// ListRelations returns the current claim-relation graph.
func (s *Service) ListRelations() ([]models.ClaimRelation, error) {
	return s.store.LoadRelations()
}

// ListSignals returns the surfaced research signals.
func (s *Service) ListSignals() ([]models.ResearchSignal, error) {
	return s.store.LoadSignals()
}

// ListCandidates returns the current candidate hypotheses.
func (s *Service) ListCandidates() ([]models.CandidateHypothesis, error) {
	return s.store.LoadCandidates()
}

// ApproveCandidate moves a candidate to the `approved` state (operator
// agreement) and records who/when.
func (s *Service) ApproveCandidate(id, by string) (models.CandidateHypothesis, bool, error) {
	return s.transitionCandidate(id, func(c *models.CandidateHypothesis) {
		c.State = models.CandidateStateApproved
		c.ApprovedBy = by
		c.ApprovedAt = time.Now().UTC().Format(time.RFC3339)
	})
}

// RejectCandidate moves a candidate to the `rejected` state (operator decision).
func (s *Service) RejectCandidate(id, by string) (models.CandidateHypothesis, bool, error) {
	return s.transitionCandidate(id, func(c *models.CandidateHypothesis) {
		c.State = models.CandidateStateRejected
		c.ApprovedBy = by
		c.ApprovedAt = time.Now().UTC().Format(time.RFC3339)
	})
}

func (s *Service) transitionCandidate(id string, mutate func(*models.CandidateHypothesis)) (models.CandidateHypothesis, bool, error) {
	candidates, err := s.store.LoadCandidates()
	if err != nil {
		return models.CandidateHypothesis{}, false, err
	}
	for i := range candidates {
		if candidates[i].ID != id {
			continue
		}
		mutate(&candidates[i])
		if err := s.store.SaveCandidates(candidates); err != nil {
			return models.CandidateHypothesis{}, false, err
		}
		trace("candidate", fmt.Sprintf("candidate %s -> %s", id, candidates[i].State))
		return candidates[i], true, nil
	}
	return models.CandidateHypothesis{}, false, nil
}

// IngestPapers persists the given papers (deduplicated by ID), extracts claims
// for new papers via the brain, rebuilds the claim-relation graph + signals,
// and returns the newly extracted claims. It is idempotent: re-ingesting an
// existing paper ID updates the paper record and re-extracts only if the paper
// has no claims yet.
func (s *Service) IngestPapers(ctx context.Context, papers []models.Paper) ([]models.Claim, error) {
	startedAt := time.Now()
	existing, err := s.store.LoadPapers()
	if err != nil {
		return nil, err
	}

	byID := make(map[string]models.Paper, len(existing))
	for _, paper := range existing {
		byID[paper.ID] = paper
	}

	now := time.Now().UTC().Format(time.RFC3339)
	var newPapers []models.Paper
	for _, paper := range papers {
		paper.ID = strings.TrimSpace(paper.ID)
		if paper.ID == "" {
			return nil, fmt.Errorf("paper id must be non-empty")
		}
		if paper.IngestedAt == "" {
			paper.IngestedAt = now
		}
		byID[paper.ID] = paper
		newPapers = append(newPapers, paper)
	}
	trace("ingest", fmt.Sprintf("received %d paper(s); %d new", len(papers), len(newPapers)))

	nextPapers := make([]models.Paper, 0, len(byID))
	for _, paper := range byID {
		nextPapers = append(nextPapers, paper)
	}
	sort.SliceStable(nextPapers, func(i, j int) bool {
		return nextPapers[i].ID < nextPapers[j].ID
	})
	if err := s.store.SavePapers(nextPapers); err != nil {
		return nil, err
	}

	claims, err := s.store.LoadClaims()
	if err != nil {
		return nil, err
	}

	var extracted []models.Claim
	if s.brain != nil {
		claimPaperIDs := make(map[string]struct{}, len(claims))
		for _, claim := range claims {
			claimPaperIDs[claim.PaperID] = struct{}{}
		}
		for _, paper := range newPapers {
			if _, hasClaims := claimPaperIDs[paper.ID]; hasClaims {
				trace("extract", fmt.Sprintf("paper %s already has claims; skipping", paper.ID))
				continue
			}
			paperClaims, err := s.brain.ExtractClaims(ctx, paper)
			if err != nil {
				// Keep the paper even if extraction fails; provider hiccups
				// should not drop the record.
				trace("extract", fmt.Sprintf("paper %s extraction failed: %v", paper.ID, err))
				return nil, err
			}
			trace("extract", fmt.Sprintf("paper %s produced %d claim(s)", paper.ID, len(paperClaims)))
			extracted = append(extracted, paperClaims...)
		}
		if len(extracted) > 0 {
			claims = append(claims, extracted...)
			if err := s.store.SaveClaims(claims); err != nil {
				return nil, err
			}
		}
	}

	if _, err := s.rebuildGraph(); err != nil {
		return nil, err
	}
	if _, err := s.rebuildCandidates(ctx); err != nil {
		return nil, err
	}
	trace("ingest", fmt.Sprintf("completed in %s", time.Since(startedAt).Round(time.Millisecond)))
	return extracted, nil
}

// rebuildGraph recomputes the claim-relation graph and signals from the current
// claims and persists both. It is deterministic and idempotent.
func (s *Service) rebuildGraph() ([]models.ResearchSignal, error) {
	claims, err := s.store.LoadClaims()
	if err != nil {
		return nil, err
	}
	relations := buildClaimRelations(claims)
	if err := s.store.SaveRelations(relations); err != nil {
		return nil, err
	}
	signals := buildSignals(relations, claims)
	if err := s.store.SaveSignals(signals); err != nil {
		return nil, err
	}
	trace("graph", fmt.Sprintf("built %d relation(s) and surfaced %d signal(s) from %d claim(s)",
		len(relations), len(signals), len(claims)))
	return signals, nil
}

// rebuildCandidates promotes signals into candidate hypotheses, applies the
// bounded review checklist, runs the (best-effort) novelty gate, and persists
// the candidates. Deterministic and idempotent.
func (s *Service) rebuildCandidates(ctx context.Context) ([]models.CandidateHypothesis, error) {
	signals, err := s.store.LoadSignals()
	if err != nil {
		return nil, err
	}
	claims, err := s.store.LoadClaims()
	if err != nil {
		return nil, err
	}
	papers, err := s.store.LoadPapers()
	if err != nil {
		return nil, err
	}
	candidates := buildCandidates(signals, claims)
	existingCandidates, err := s.store.LoadCandidates()
	if err != nil {
		return nil, err
	}
	existingByID := make(map[string]models.CandidateHypothesis, len(existingCandidates))
	for _, candidate := range existingCandidates {
		existingByID[candidate.ID] = candidate
	}

	for i := range candidates {
		// Preserve terminal (approved/rejected) candidates so an operator's
		// decision survives a corpus re-ingest; refresh everything else.
		if preserved, ok := existingByID[candidates[i].ID]; ok &&
			(preserved.State == models.CandidateStateApproved || preserved.State == models.CandidateStateRejected) {
			candidates[i] = preserved
			continue
		}

		// Bounded review: use the LLM reviewer committee when a provider is
		// available, otherwise fall back to the deterministic heuristic.
		if s.brain != nil {
			reviews, rationale, rErr := s.brain.ReviewCandidateChecklist(ctx, candidates[i].Hypothesis,
				claimsForCandidate(claims, candidates[i]), papersForCandidate(candidates[i], papers))
			if rErr != nil {
				trace("review", fmt.Sprintf("candidate %s checklist review unavailable: %v", candidates[i].ID, rErr))
				evaluateChecklist(&candidates[i], claims)
			} else {
				applyChecklistReviews(&candidates[i], reviews, rationale)
			}
		} else {
			evaluateChecklist(&candidates[i], claims)
		}
		// A contradiction is a review-worthy disagreement, not a failed hypothesis.
		neutralizeContradictionCriticalItems(&candidates[i])

		if s.novelty != nil {
			score, nearest, nErr := s.novelty.CheckNovelty(ctx, candidates[i].Hypothesis, claimEntities(claims, candidates[i]))
			if nErr != nil {
				trace("novelty", fmt.Sprintf("candidate %s novelty check unavailable: %v", candidates[i].ID, nErr))
			} else {
				candidates[i].NoveltyScore = score
				candidates[i].NearestWork = nearest
				updateNoveltyAnswer(&candidates[i])
			}
		}

		// Bounded evidence-expansion round: fetch related papers to resolve any
		// still-unknown criteria, then re-review. Never forces a yes.
		s.expandCandidateEvidence(ctx, &candidates[i], claims, papers)
	}
	if err := s.store.SaveCandidates(candidates); err != nil {
		return nil, err
	}
	trace("candidates", fmt.Sprintf("reviewed %d candidate(s): %d refuted, %d disputed, %d agreed",
		len(candidates), countVerdict(candidates, models.CandidateVerdictRefuted),
		countVerdict(candidates, models.CandidateVerdictDisputed), countVerdict(candidates, models.CandidateVerdictAgreed)))
	return candidates, nil
}

func countVerdict(candidates []models.CandidateHypothesis, verdict string) int {
	count := 0
	for _, candidate := range candidates {
		if candidate.Verdict == verdict {
			count++
		}
	}
	return count
}

// trace emits a timestamped, followable debug line for this Service.
func trace(step, message string) {
	log.Printf("[Research %s] %s", step, message)
}

// Store persists the research corpus (papers + claims) as JSON files under a
// root directory, with atomic writes so readers never observe a partial file.
type Store struct {
	root string
}

func NewStore(root string) *Store {
	return &Store{root: root}
}

func (s *Store) LoadPapers() ([]models.Paper, error) {
	var papers []models.Paper
	if err := s.readJSON(models.ResearchPapersFile, &papers); err != nil {
		return nil, err
	}
	if papers == nil {
		papers = []models.Paper{}
	}
	return papers, nil
}

func (s *Store) SavePapers(papers []models.Paper) error {
	return s.saveSlice(models.ResearchPapersFile, papers)
}

func (s *Store) LoadClaims() ([]models.Claim, error) {
	var claims []models.Claim
	if err := s.readJSON(models.ResearchClaimsFile, &claims); err != nil {
		return nil, err
	}
	if claims == nil {
		claims = []models.Claim{}
	}
	return claims, nil
}

func (s *Store) SaveClaims(claims []models.Claim) error {
	return s.saveSlice(models.ResearchClaimsFile, claims)
}

func (s *Store) LoadRelations() ([]models.ClaimRelation, error) {
	var relations []models.ClaimRelation
	if err := s.readJSON(models.ResearchRelationsFile, &relations); err != nil {
		return nil, err
	}
	if relations == nil {
		relations = []models.ClaimRelation{}
	}
	return relations, nil
}

func (s *Store) SaveRelations(relations []models.ClaimRelation) error {
	return s.saveSlice(models.ResearchRelationsFile, relations)
}

func (s *Store) LoadSignals() ([]models.ResearchSignal, error) {
	var signals []models.ResearchSignal
	if err := s.readJSON(models.ResearchSignalsFile, &signals); err != nil {
		return nil, err
	}
	if signals == nil {
		signals = []models.ResearchSignal{}
	}
	return signals, nil
}

func (s *Store) SaveSignals(signals []models.ResearchSignal) error {
	return s.saveSlice(models.ResearchSignalsFile, signals)
}

func (s *Store) LoadCandidates() ([]models.CandidateHypothesis, error) {
	var candidates []models.CandidateHypothesis
	if err := s.readJSON(models.ResearchCandidatesFile, &candidates); err != nil {
		return nil, err
	}
	if candidates == nil {
		candidates = []models.CandidateHypothesis{}
	}
	return candidates, nil
}

func (s *Store) SaveCandidates(candidates []models.CandidateHypothesis) error {
	return s.saveSlice(models.ResearchCandidatesFile, candidates)
}

func (s *Store) readJSON(filename string, target interface{}) error {
	path := filepath.Join(s.root, filename)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if !json.Valid(data) {
		return fmt.Errorf("%s contains invalid json", filename)
	}
	return json.Unmarshal(data, target)
}

func (s *Store) saveSlice(filename string, value interface{}) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return s.writeAtomic(filename, data)
}

var researchWriteMu sync.Mutex

func (s *Store) writeAtomic(filename string, data []byte) error {
	if err := os.MkdirAll(s.root, 0755); err != nil {
		return err
	}
	path := filepath.Join(s.root, filename)
	researchWriteMu.Lock()
	defer researchWriteMu.Unlock()

	tmp, err := os.CreateTemp(s.root, filename+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return err
	}
	return nil
}
