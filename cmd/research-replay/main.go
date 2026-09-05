// research-replay re-executes a saved verification bundle without a server or LLM.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/Andyi955/Gorantula/internal/research"
	"github.com/Andyi955/Gorantula/models"
)

func main() {
	bundlePath := flag.String("bundle", "", "path to downloaded verification JSON")
	flag.Parse()
	if *bundlePath == "" {
		fmt.Fprintln(os.Stderr, "usage: research-replay --bundle verification.json")
		os.Exit(1)
	}
	if err := replay(*bundlePath); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func replay(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 8<<20+1))
	if err != nil {
		return err
	}
	if len(data) > 8<<20 {
		return fmt.Errorf("bundle exceeds 8 MiB")
	}
	var bundle models.VerificationRun
	if err := json.Unmarshal(data, &bundle); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	results, err := research.ReplayVerificationBundle(ctx, bundle)
	if err != nil {
		return err
	}
	matches := true
	for i, result := range results {
		if result.OutputDigest != bundle.Results[i].OutputDigest {
			matches = false
		}
	}
	if err := json.NewEncoder(os.Stdout).Encode(struct {
		Matches bool                        `json:"matches"`
		Results []models.VerificationResult `json:"results"`
	}{matches, results}); err != nil {
		return err
	}
	if !matches {
		return fmt.Errorf("replay output digests differ from the saved bundle")
	}
	return nil
}
