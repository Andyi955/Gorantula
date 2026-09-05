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
	s.webSearch = nil
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
	s.webSearch = nil
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
	s.webSearch = nil
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
func TestTopicBraveFallbackRecordsAndFetchesObservedLead(t *testing.T) {
	s := NewService(t.TempDir(), nil)
	searches := 0
	visited := []string{}
	s.webSearch = func(_ context.Context, q string, n int) ([]string, error) {
		searches++
		if !strings.HasPrefix(q, "moths (") || !strings.Contains(q, "site:github.com") || n != 5 {
			t.Fatal(q, n)
		}
		return []string{"https://repository.org/moths", "https://github.com/example/moths"}, nil
	}
	s.datasetFetch = func(_ context.Context, u string) ([]byte, string, error) {
		visited = append(visited, u)
		if strings.Contains(u, "publisher") {
			return nil, "", fmt.Errorf("HTTP 403")
		}
		return []byte(`<a href="/measurements.csv">Dataset</a>`), u, nil
	}
	r := models.VerificationRun{ID: strings.Repeat("d", 32), Request: models.VerificationRequest{Topic: "moths"}, PaperSources: []string{"https://publisher.org/1", "https://publisher.org/2", "https://publisher.org/3"}}
	if e := s.discoverTopicData(context.Background(), &r); e != nil {
		t.Fatal(e)
	}
	if searches != 1 || len(r.DatasetActions) != 5 || len(visited) != 4 || visited[3] != "https://repository.org/moths" {
		t.Fatal(searches, r.DatasetActions, visited)
	}
	if r.DatasetActions[3].Call.Tool != "web-search" || len(r.DatasetActions[4].Links) != 1 || r.Dataset.ID != "" {
		t.Fatal("lost provenance or auto-imported")
	}
	if e := s.discoverTopicData(context.Background(), &r); e != nil {
		t.Fatal(e)
	}
	if searches != 1 {
		t.Fatal("repeated Brave charge")
	}
}
