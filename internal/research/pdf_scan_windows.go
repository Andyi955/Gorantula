//go:build windows

package research

import (
	"os/exec"
	"syscall"
)

func hideOCRWindow(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }
