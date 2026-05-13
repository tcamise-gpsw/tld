package serve

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"time"

	"github.com/mertcikla/tld/v2/cmd/version"
	"github.com/mertcikla/tld/v2/internal/selfupdate"
	"github.com/mertcikla/tld/v2/internal/term"
	"github.com/mertcikla/tld/v2/internal/workspace"
)

func PrintLogo(w io.Writer) {
	PrintLogoWithUpdate(w, nil)
}

func PrintLogoWithUpdate(w io.Writer, status *selfupdate.Status) {
	versionText := version.Version
	if status != nil && status.UpdateAvailable {
		versionText = fmt.Sprintf("%s (update available: %s)", version.Version, status.Latest)
	}
	term.PrintLogo(w, versionText)
}

func StartupUpdateStatus(ctx context.Context, cfg *workspace.Config) (*selfupdate.Status, string) {
	if cfg == nil {
		cfg = workspace.DefaultConfig()
	}
	interval, err := time.ParseDuration(cfg.Updates.CheckInterval)
	if err != nil || interval <= 0 {
		interval = selfupdate.DefaultCheckInterval
	}
	statePath := updateStatePath()
	opts := selfupdate.Options{
		Current:       version.Version,
		CheckInterval: interval,
		StatePath:     statePath,
	}
	if cfg.Updates.Auto {
		status, err := selfupdate.Install(ctx, opts)
		if err != nil {
			return nil, ""
		}
		if status.UpdateAvailable {
			return &status, fmt.Sprintf("Auto-updated tld to %s. Restart to use the new version.", status.Latest)
		}
		return &status, ""
	}
	status, err := selfupdate.Check(ctx, opts)
	if err != nil {
		return nil, ""
	}
	return &status, ""
}

func updateStatePath() string {
	dir, err := workspace.ConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "update-check.json")
}
