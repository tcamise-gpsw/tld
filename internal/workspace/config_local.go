//go:build tldlocal

package workspace

import (
	"os"
	"path/filepath"
)

// ResolveDataDir is modified for a local-only binary to force use of ./.tld
// as the data directory, ignoring all other configuration sources.
func ResolveDataDir(cfg *Config, flagDir string) (string, error) {
	path, err := filepath.Abs(".tld")
	if err != nil {
		return "", err
	}

	// Ensure the directory exists
	if err := os.MkdirAll(path, 0o755); err != nil {
		return "", err
	}

	return path, nil
}
