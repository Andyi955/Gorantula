package research

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/Andyi955/Gorantula/models"
)

func TestPMCSupplementFallback(t *testing.T) {
	for _, mode := range []string{"valid", "checksum", "identity", "retracted", "external", "ambiguous"} {
		t.Run(mode, func(t *testing.T) {
			data := docxFixture(t, simpleDOCXTable)
			hash := md5.Sum(data)
			checksum := hex.EncodeToString(hash[:])
			if mode == "checksum" {
				checksum = strings.Repeat("0", 32)
			}
			original := "https://pmc.ncbi.nlm.nih.gov/articles/instance/7591485/bin/supp.docx"
			s := NewService(t.TempDir(), nil)
			s.datasetFetch = func(_ context.Context, u string) ([]byte, string, error) {
				if u == original {
					return []byte("<html>Preparing to download</html>"), u, nil
				}
				if strings.Contains(u, "?list-type=2") {
					prefixes := "<CommonPrefixes><Prefix>PMC7591485.1/</Prefix></CommonPrefixes>"
					if mode == "ambiguous" {
						prefixes += "<CommonPrefixes><Prefix>PMC7591485.2/</Prefix></CommonPrefixes>"
					}
					return []byte("<ListBucketResult>" + prefixes + "</ListBucketResult>"), u, nil
				}
				if strings.HasSuffix(u, ".json") {
					id := "PMC7591485"
					if mode == "identity" {
						id = "PMC999"
					}
					version := "1"
					if strings.Contains(u, ".2/") {
						version = "2"
					}
					media := "s3://pmc-oa-opendata/PMC7591485." + version + "/supp.docx?md5=" + checksum
					if mode == "external" {
						media = "s3://attacker/PMC7591485.1/supp.docx?md5=" + checksum
					}
					b, _ := json.Marshal(map[string]interface{}{"pmcid": id, "is_pmc_openaccess": true, "is_retracted": mode == "retracted", "media_urls": []string{media}})
					return b, u, nil
				}
				if u == pmcPublicBucket+"/PMC7591485.1/supp.docx" {
					return data, u, nil
				}
				return nil, "", fmt.Errorf("unexpected request %s", u)
			}
			run := models.VerificationRun{PaperSources: []string{original}}
			out := s.executeDatasetCall(context.Background(), &run, models.DatasetCall{Tool: "paper-docx", URL: original})
			if mode != "valid" {
				if out.Error == "" || len(run.Documents) != 0 {
					t.Fatal("unverified fallback accepted")
				}
				return
			}
			if out.Error != "" || len(out.Tables) != 1 || len(run.Documents) != 1 || !strings.HasPrefix(run.Documents[0].ResolvedURL, pmcPublicBucket) {
				t.Fatalf("%+v", out)
			}
			s.datasetFetch = func(context.Context, string) ([]byte, string, error) {
				t.Fatal("cached document refetched")
				return nil, "", nil
			}
			if cached := s.executeDatasetCall(context.Background(), &run, models.DatasetCall{Tool: "paper-docx", URL: original}); cached.Error != "" {
				t.Fatal(cached.Error)
			}
		})
	}
}

func TestPMCFallbackRejectsOtherHosts(t *testing.T) {
	_, _, err := fetchPMCSupplement(context.Background(), "https://pmc.ncbi.nlm.nih.gov.attacker/articles/PMC7591485/bin/supp.docx", func(context.Context, string) ([]byte, string, error) {
		t.Fatal("unexpected network request")
		return nil, "", nil
	})
	if err == nil {
		t.Fatal("accepted unrelated host")
	}
}
