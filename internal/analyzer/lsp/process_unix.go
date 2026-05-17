//go:build !windows

package lsp

import (
	"bytes"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = proc.Signal(syscall.Signal(0))
	return err == nil || err == syscall.EPERM
}

func processMemorySupported() bool {
	return true
}

func processMemoryBytes(pid int) (int64, bool, error) {
	if pid <= 0 {
		return 0, false, nil
	}
	out, err := exec.Command("ps", "-o", "rss=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return 0, false, err
	}
	value := strings.TrimSpace(string(bytes.TrimSpace(out)))
	if value == "" {
		return 0, false, nil
	}
	kb, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, false, err
	}
	return kb * 1024, true, nil
}
