package research

import (
	"context"
	"fmt"
	"github.com/Andyi955/Gorantula/models"
	"reflect"
	"strings"
	"testing"
)

func TestTopicDiscoveryFollowsObservedLinksAndReservesBudget(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	visited := []string{}
	s.datasetFetch = func(_ context.Context, u string) ([]byte, string, error) {
		visited = append(visited, u)
		return []byte(`<html><a href="/supplement">Supplement</a><a href="/data.csv">Dataset CSV</a><a href="/other">Unrelated</a></html>`), u, nil
	}
	r := models.VerificationRun{ID: strings.Repeat("a", 32), PaperSources: []string{"https://example.org/p1", "https://example.org/p2", "https://example.org/p3", "https://example.org/p4"}}
	if e := s.discoverTopicData(context.Background(), &r); e != nil {
		t.Fatal(e)
	}
	want := []string{"https://example.org/p1", "https://example.org/p2", "https://example.org/p3", "https://example.org/supplement", "https://example.org/data.csv"}
	if !reflect.DeepEqual(visited, want) {
		t.Fatal(visited)
	}
	if len(r.DatasetActions) != 5 || r.Dataset.ID != "" {
		t.Fatal("budget exhausted or automatic import")
	}
	if e := s.discoverTopicData(context.Background(), &r); e != nil {
		t.Fatal(e)
	}
	if len(visited) != 5 {
		t.Fatal("repeated retrieval")
	}
}
func TestTopicDiscoveryRetainsAccessFailure(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	s.datasetFetch = func(_ context.Context, u string) ([]byte, string, error) {
		return nil, "", fmt.Errorf("dataset source returned HTTP 403")
	}
	r := models.VerificationRun{ID: strings.Repeat("b", 32), PaperSources: []string{"https://example.org/p"}}
	if e := s.discoverTopicData(context.Background(), &r); e != nil {
		t.Fatal(e)
	}
	if len(r.DatasetActions) != 1 || !strings.Contains(r.DatasetActions[0].Error, "403") {
		t.Fatal("failure hidden")
	}
}
func TestTopicDiscoveryHonorsCancellation(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	s.datasetFetch = func(_ context.Context, u string) ([]byte, string, error) {
		t.Fatal("request after cancellation")
		return nil, "", nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r := models.VerificationRun{ID: strings.Repeat("c", 32), PaperSources: []string{"https://example.org/p"}}
	if e := s.discoverTopicData(ctx, &r); e != context.Canceled {
		t.Fatal(e)
	}
}
