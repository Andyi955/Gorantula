//go:build !windows

package research

import "os/exec"

func hideOCRWindow(cmd *exec.Cmd) {}
