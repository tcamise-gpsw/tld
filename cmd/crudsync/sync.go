package crudsync

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/mertcikla/tld/v2/cmd/apply"
	"github.com/spf13/cobra"
)

func ApplyAfterMutation(cmd *cobra.Command, wdir string, dataDir string) error {
	applyCmd := apply.NewApplyCmd(&wdir)
	applyCmd.SilenceUsage = true
	var out bytes.Buffer
	applyCmd.SetOut(&out)
	applyCmd.SetErr(&out)
	applyCmd.SetIn(bytes.NewReader(nil))
	args := []string{"--force"}
	if dataDir != "" {
		args = append(args, "--data-dir", dataDir)
	}
	applyCmd.SetArgs(args)
	if err := applyCmd.ExecuteContext(cmd.Context()); err != nil {
		detail := strings.TrimSpace(out.String())
		if detail != "" {
			return fmt.Errorf("workspace YAML was updated, but auto-apply failed: %w\n%s", err, detail)
		}
		return fmt.Errorf("workspace YAML was updated, but auto-apply failed: %w", err)
	}
	return nil
}
