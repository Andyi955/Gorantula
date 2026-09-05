package research

import (
	"context"
	"fmt"
	"runtime"

	"github.com/Andyi955/Gorantula/models"
)

// ReplayVerificationBundle needs only the downloaded bundle and this binary.
// It never loads a provider, reads the corpus, or contacts a service.
func ReplayVerificationBundle(ctx context.Context, bundle models.VerificationRun) ([]models.VerificationResult, error) {
	if bundle.ToolVersion != verificationToolVersion || bundle.ImplementationDigest != digestBytes(verificationImplementation) || bundle.Runtime != runtime.Version()+" "+runtime.GOOS+"/"+runtime.GOARCH {
		return nil, fmt.Errorf("bundle requires its original tool implementation and runtime")
	}
	if bundle.Dataset.Digest != digestBytes([]byte(bundle.Dataset.CSV)) {
		return nil, fmt.Errorf("bundle input digest mismatch")
	}
	if len(bundle.Results) < 1 || len(bundle.Results) > 3 {
		return nil, fmt.Errorf("bundle needs 1–3 recorded calls")
	}
	results := make([]models.VerificationResult, 0, len(bundle.Results))
	for _, saved := range bundle.Results {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := validateVerificationCall(saved.Call); err != nil {
			return nil, err
		}
		input := bundle.Dataset
		if saved.InputDigest != "" && saved.InputDigest != input.Digest {
			found := false
			for _, parent := range bundle.DatasetParents {
				if parent.Digest == saved.InputDigest {
					input = parent
					found = true
					break
				}
			}
			if !found {
				return nil, fmt.Errorf("recorded calculation input missing")
			}
		}
		if input.Digest != digestBytes([]byte(input.CSV)) {
			return nil, fmt.Errorf("recorded input digest mismatch")
		}
		results = append(results, executeVerificationTool(ctx, input, saved.Call))
	}
	return results, nil
}
