package localserver

import (
	"path/filepath"
)

func LogPath(dataDir string) string {
	return filepath.Join(dataDir, "tld.log")
}

// IsRunning returns true if a process with the given PID exists and is alive.
func IsRunning(pid int) bool {
	if pid <= 0 {
		return false
	}
	return processExists(pid)
}
