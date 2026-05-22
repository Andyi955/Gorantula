package pipeline

import (
	"context"
	"testing"
)

func TestPipelineCancellationRegistryCancelsActiveRun(t *testing.T) {
	ResetCancellationRegistryForTest()

	ctx, cancel := context.WithCancel(context.Background())
	meta := RunMetadata{RunID: "run-cancel-1", VaultID: "inv-cancel-1", Mode: "web"}
	RegisterCancellation(meta, cancel)

	if !CancelRun("run-cancel-1", "inv-cancel-1") {
		t.Fatal("expected active run to be cancelled")
	}

	select {
	case <-ctx.Done():
	default:
		t.Fatal("expected registered context to be cancelled")
	}

	if CancelRun("run-cancel-1", "inv-cancel-1") {
		t.Fatal("expected cancelled run to be removed from registry")
	}
}

func TestPipelineCancellationRegistryRejectsWrongVault(t *testing.T) {
	ResetCancellationRegistryForTest()

	ctx, cancel := context.WithCancel(context.Background())
	meta := RunMetadata{RunID: "run-cancel-2", VaultID: "inv-cancel-2", Mode: "web"}
	RegisterCancellation(meta, cancel)

	if CancelRun("run-cancel-2", "inv-other") {
		t.Fatal("expected wrong vault id not to cancel the run")
	}

	select {
	case <-ctx.Done():
		t.Fatal("context was cancelled for the wrong vault")
	default:
	}

	if !CancelRun("run-cancel-2", "") {
		t.Fatal("expected run id alone to cancel when vault id is omitted")
	}
}

func TestPipelineCancellationErrorDoesNotTreatTimeoutAsOperatorStop(t *testing.T) {
	if !IsCancellationError(context.Canceled) {
		t.Fatal("expected context cancellation to be treated as operator cancellation")
	}

	if IsCancellationError(context.DeadlineExceeded) {
		t.Fatal("expected deadline exceeded to remain a timeout, not operator cancellation")
	}
}
