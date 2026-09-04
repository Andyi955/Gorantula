package research

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Andyi955/Gorantula/brain"
	"github.com/Andyi955/Gorantula/models"
)

// Service is the Phase 0 research engine: a persistent corpus store plus the
// claim-extractor backed by the brain's provider. Later phases add the claim
// graph, signals, novelty gate, verification sandbox, and approval.
type Service struct {
	store *Store
	brain *brain.Brain
}

func NewService(root string, br *brain.Brain) *Service {
	return &Service{store: NewStore(root), brain: br}
}

// ListPapers returns all ingested papers.
func (s *Service) ListPapers() ([]models.Paper, error) {
	return s.store.LoadPapers()
}

// ListClaims returns all extracted claims.
func (s *Service) ListClaims() ([]models.Claim, error) {
	return s.store.LoadClaims()
}

// IngestPapers persists the given papers (deduplicated by ID), extracts claims
// for new papers via the brain, and returns the newly extracted claims. It is
// idempotent: re-ingesting an existing paper ID updates the paper record and
// re-extracts only if the paper has no claims yet.
func (s *Service) IngestPapers(ctx context.Context, papers []models.Paper) ([]models.Claim, error) {
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

	if s.brain != nil {
		claimPaperIDs := make(map[string]struct{}, len(claims))
		for _, claim := range claims {
			claimPaperIDs[claim.PaperID] = struct{}{}
		}
		var extracted []models.Claim
		for _, paper := range newPapers {
			if _, hasClaims := claimPaperIDs[paper.ID]; hasClaims {
				continue
			}
			paperClaims, err := s.brain.ExtractClaims(ctx, paper)
			if err != nil {
				// Keep the paper even if extraction fails; pipeline token
				// budgets and provider hiccups should not drop the record.
				return nil, err
			}
			extracted = append(extracted, paperClaims...)
		}
		if len(extracted) > 0 {
			claims = append(claims, extracted...)
			if err := s.store.SaveClaims(claims); err != nil {
				return nil, err
			}
			return extracted, nil
		}
	}

	return nil, nil
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
