package app

import (
	"testing"

	"spider-agent/internal/pipeline"
)

func TestConnectDotsRunClaimRejectsDuplicateUntilRelease(t *testing.T) {
	resetActiveConnectDotsClaimsForTest()

	meta := pipeline.RunMetadata{RunID: "run-duplicate", VaultID: "inv-duplicate", Mode: "analysis"}
	release, ok := claimConnectDotsRun(meta)
	if !ok {
		t.Fatal("first connect-dots claim should be accepted")
	}

	if duplicateRelease, ok := claimConnectDotsRun(meta); ok {
		duplicateRelease()
		t.Fatal("duplicate connect-dots claim for the same run should be rejected")
	}

	release()

	releaseAfterComplete, ok := claimConnectDotsRun(meta)
	if !ok {
		t.Fatal("connect-dots claim should be accepted again after release")
	}
	releaseAfterComplete()
}

func TestConnectDotsRunClaimSeparatesVaultsAndRuns(t *testing.T) {
	resetActiveConnectDotsClaimsForTest()

	release, ok := claimConnectDotsRun(pipeline.RunMetadata{RunID: "run-shared", VaultID: "inv-a", Mode: "analysis"})
	if !ok {
		t.Fatal("first connect-dots claim should be accepted")
	}
	defer release()

	if otherVaultRelease, ok := claimConnectDotsRun(pipeline.RunMetadata{RunID: "run-shared", VaultID: "inv-b", Mode: "analysis"}); !ok {
		t.Fatal("same run id should be accepted for a different vault")
	} else {
		otherVaultRelease()
	}

	if otherRunRelease, ok := claimConnectDotsRun(pipeline.RunMetadata{RunID: "run-other", VaultID: "inv-a", Mode: "analysis"}); !ok {
		t.Fatal("different run id should be accepted for the same vault")
	} else {
		otherRunRelease()
	}
}
