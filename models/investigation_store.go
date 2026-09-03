package models

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	InvestigationMetadataFilename      = "metadata.json"
	InvestigationBoardFilename         = "board_state.json"
	InvestigationResultFilename        = "vault_result.json"
	InvestigationDiscoveryFilename     = "discoveries.json"
	InvestigationRelationshipsFilename = "relationships.json"
)

var investigationIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]*$`)

var ErrInvalidInvestigationID = errors.New("invalid investigation id")
var ErrInvestigationNotFound = errors.New("investigation not found")

type InvestigationRecord struct {
	ID              string   `json:"id"`
	Topic           string   `json:"topic"`
	Kind            string   `json:"kind"`
	ParentIDs       []string `json:"parentIds"`
	ChildIDs        []string `json:"childIds"`
	MergedFromIDs   []string `json:"mergedFromIds"`
	PrimaryParentID *string  `json:"primaryParentId"`
	DisplayTopic    string   `json:"displayTopic"`
}

type InvestigationStore struct {
	root string
}

func NewInvestigationStore(root string) *InvestigationStore {
	return &InvestigationStore{root: root}
}

func ValidInvestigationID(id string) bool {
	id = strings.TrimSpace(id)
	return id != "" && investigationIDPattern.MatchString(id)
}

func NormalizeInvestigationRecord(record InvestigationRecord) (InvestigationRecord, error) {
	record.ID = strings.TrimSpace(record.ID)
	record.Topic = strings.TrimSpace(record.Topic)
	record.DisplayTopic = strings.TrimSpace(record.DisplayTopic)
	record.Kind = strings.TrimSpace(record.Kind)

	if !ValidInvestigationID(record.ID) {
		return InvestigationRecord{}, ErrInvalidInvestigationID
	}
	if record.Topic == "" {
		record.Topic = record.ID
	}
	if record.DisplayTopic == "" {
		record.DisplayTopic = record.Topic
	}
	if record.Kind != "merged-child" {
		record.Kind = "root"
	}

	record.ParentIDs = cleanStringSlice(record.ParentIDs)
	record.ChildIDs = cleanStringSlice(record.ChildIDs)
	record.MergedFromIDs = cleanStringSlice(record.MergedFromIDs)
	if record.PrimaryParentID != nil {
		primary := strings.TrimSpace(*record.PrimaryParentID)
		if primary == "" {
			record.PrimaryParentID = nil
		} else {
			record.PrimaryParentID = &primary
		}
	}
	if record.PrimaryParentID == nil && len(record.ParentIDs) > 0 {
		primary := record.ParentIDs[0]
		record.PrimaryParentID = &primary
	}

	return record, nil
}

func (s *InvestigationStore) List() ([]InvestigationRecord, error) {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		if os.IsNotExist(err) {
			return []InvestigationRecord{}, nil
		}
		return nil, err
	}

	records := make([]InvestigationRecord, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || !ValidInvestigationID(entry.Name()) {
			continue
		}

		record, err := s.LoadMetadata(entry.Name())
		if err != nil {
			if errors.Is(err, ErrInvestigationNotFound) {
				continue
			}
			return nil, err
		}
		records = append(records, record)
	}

	sort.SliceStable(records, func(i, j int) bool {
		return records[i].ID > records[j].ID
	})

	return recomputeInvestigationChildLinks(records), nil
}

func (s *InvestigationStore) LoadMetadata(id string) (InvestigationRecord, error) {
	path, err := s.filePath(id, InvestigationMetadataFilename)
	if err != nil {
		return InvestigationRecord{}, err
	}

	data, err := readVaultFileWithRetry(path)
	if err != nil {
		if os.IsNotExist(err) {
			return InvestigationRecord{}, ErrInvestigationNotFound
		}
		return InvestigationRecord{}, err
	}

	var record InvestigationRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return InvestigationRecord{}, err
	}
	if record.ID == "" {
		record.ID = strings.TrimSpace(id)
	}
	return NormalizeInvestigationRecord(record)
}

func (s *InvestigationStore) SaveMetadata(record InvestigationRecord) error {
	normalized, err := NormalizeInvestigationRecord(record)
	if err != nil {
		return err
	}
	return s.writeJSON(normalized.ID, InvestigationMetadataFilename, normalized)
}

func (s *InvestigationStore) LoadJSON(id, filename string) (json.RawMessage, error) {
	path, err := s.filePath(id, filename)
	if err != nil {
		return nil, err
	}

	data, err := readVaultFileWithRetry(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrInvestigationNotFound
		}
		return nil, err
	}
	if !json.Valid(data) {
		return nil, fmt.Errorf("%s contains invalid json", filename)
	}
	return json.RawMessage(data), nil
}

func (s *InvestigationStore) SaveJSON(id, filename string, raw json.RawMessage) error {
	if !json.Valid(raw) {
		return errors.New("payload must be valid json")
	}
	return s.writeRaw(id, filename, raw)
}

func (s *InvestigationStore) Delete(id string) error {
	dir, err := s.investigationDir(id)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	return nil
}

func (s *InvestigationStore) writeJSON(id, filename string, value interface{}) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return s.writeRaw(id, filename, data)
}

// readVaultFileWithRetry reads a vault file, retrying briefly on sharing
// violations: on Windows a reader opening the file while an atomic rename
// swaps it can transiently hit "being used by another process". A missing
// file is definitive and returns immediately.
func readVaultFileWithRetry(path string) ([]byte, error) {
	var data []byte
	var err error
	for attempt := 0; attempt < 6; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 2 * time.Millisecond)
		}
		data, err = os.ReadFile(path)
		if err == nil || os.IsNotExist(err) {
			return data, err
		}
	}
	return data, err
}

// vaultWriteMu serializes vault file writes: concurrent renames over the
// same target can transiently deny each other on Windows even with retries.
var vaultWriteMu sync.Mutex

func (s *InvestigationStore) writeRaw(id, filename string, data []byte) error {
	path, err := s.filePath(id, filename)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	// Atomic write: concurrent readers (brain evidence recompute, UI polls)
	// must never observe a partially written vault file - that is what
	// produced transient "board_state.json contains invalid json" warnings.
	// Write to a unique temp file in the same directory, then rename over
	// the target; rename is atomic on the same volume.
	vaultWriteMu.Lock()
	defer vaultWriteMu.Unlock()
	tmpFile, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmpFile.Name()
	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmpFile.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	// A reader holding the target open can transiently deny the rename;
	// a short retry converges without losing either write.
	var renameErr error
	for attempt := 0; attempt < 10; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 3 * time.Millisecond)
		}
		if renameErr = os.Rename(tmpName, path); renameErr == nil {
			break
		}
	}
	if renameErr != nil {
		os.Remove(tmpName)
		return renameErr
	}
	return nil
}

func (s *InvestigationStore) filePath(id, filename string) (string, error) {
	if !allowedInvestigationFilename(filename) {
		return "", errors.New("invalid investigation file")
	}
	dir, err := s.investigationDir(id)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, filename), nil
}

func (s *InvestigationStore) investigationDir(id string) (string, error) {
	id = strings.TrimSpace(id)
	if !ValidInvestigationID(id) {
		return "", ErrInvalidInvestigationID
	}

	rootAbs, err := filepath.Abs(filepath.Clean(s.root))
	if err != nil {
		return "", err
	}
	dirAbs, err := filepath.Abs(filepath.Join(rootAbs, id))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(rootAbs, dirAbs)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(rel, "..") || rel == "." || filepath.IsAbs(rel) {
		return "", ErrInvalidInvestigationID
	}
	return dirAbs, nil
}

func allowedInvestigationFilename(filename string) bool {
	switch filename {
	case InvestigationMetadataFilename, InvestigationBoardFilename, InvestigationResultFilename, InvestigationDiscoveryFilename, InvestigationRelationshipsFilename:
		return true
	default:
		return false
	}
}

func cleanStringSlice(values []string) []string {
	next := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		next = append(next, value)
	}
	return next
}

func recomputeInvestigationChildLinks(records []InvestigationRecord) []InvestigationRecord {
	childMap := make(map[string][]string)
	for _, record := range records {
		if record.Kind != "merged-child" {
			continue
		}
		for _, parentID := range record.ParentIDs {
			childMap[parentID] = append(childMap[parentID], record.ID)
		}
	}

	next := make([]InvestigationRecord, len(records))
	for i, record := range records {
		record.ChildIDs = cleanStringSlice(childMap[record.ID])
		next[i] = record
	}
	return next
}
