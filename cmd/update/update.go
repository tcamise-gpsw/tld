package update

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"github.com/mertcikla/tld/v2/cmd/crudsync"
	"github.com/mertcikla/tld/v2/cmd/version"
	"github.com/mertcikla/tld/v2/internal/cmdutil"
	"github.com/mertcikla/tld/v2/internal/completion"
	"github.com/mertcikla/tld/v2/internal/selfupdate"
	"github.com/mertcikla/tld/v2/internal/term"
	"github.com/mertcikla/tld/v2/internal/workspace"
	"github.com/spf13/cobra"
)

func NewUpdateCmd(wdir, format *string, compact *bool) *cobra.Command {
	c := &cobra.Command{
		Use:   "update",
		Short: "Update a resource field with a value",
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return cmd.Help()
			}
			return cobra.NoArgs(cmd, args)
		},
	}

	c.AddCommand(newElementCmd(wdir, format, compact))
	c.AddCommand(newConnectorCmd(wdir, format, compact))
	c.AddCommand(newSelfCmd())

	return c
}

func newSelfCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "self",
		Short: "Update the tld CLI binary from GitHub releases",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := workspace.LoadGlobalConfig()
			if err != nil {
				return err
			}
			interval, err := time.ParseDuration(cfg.Updates.CheckInterval)
			if err != nil || interval <= 0 {
				interval = selfupdate.DefaultCheckInterval
			}
			statePath := ""
			if dir, err := workspace.ConfigDir(); err == nil {
				statePath = filepath.Join(dir, "update-check.json")
			}
			ctx, cancel := context.WithTimeout(cmd.Context(), 2*time.Minute)
			defer cancel()
			status, err := selfupdate.Install(ctx, selfupdate.Options{
				Current:       version.Version,
				CheckInterval: interval,
				StatePath:     statePath,
				Force:         true,
			})
			if err != nil {
				return fmt.Errorf("update tld: %w", err)
			}
			if !status.UpdateAvailable {
				term.Successf(cmd.OutOrStdout(), "tld %s is already up to date.", version.Version)
				return nil
			}
			term.Successf(cmd.OutOrStdout(), "Updated tld from %s to %s.", version.Version, status.Latest)
			term.Hint(cmd.OutOrStdout(), "Restart any running tld server to use the new version.")
			return nil
		},
	}
}

func newElementCmd(wdir, format *string, compact *bool) *cobra.Command {
	return &cobra.Command{
		Use:   "element <ref> <field> <value>",
		Short: "Update an element field",
		Args:  cobra.ExactArgs(3),
		ValidArgsFunction: func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
			switch len(args) {
			case 0:
				return completion.ElementRefs(wdir)
			case 1:
				return completion.ElementFields(), cobra.ShellCompDirectiveNoFileComp
			default:
				return nil, cobra.ShellCompDirectiveNoFileComp
			}
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			ref, field, value := args[0], args[1], args[2]
			if err := workspace.UpdateElementField(*wdir, ref, field, value); err != nil {
				if cmdutil.WantsJSON(*format) {
					return cmdutil.WriteCommandError(cmd.OutOrStdout(), *compact, "update element", err)
				}
				return fmt.Errorf("update element: %w", err)
			}
			if err := crudsync.ApplyAfterMutation(cmd, *wdir, ""); err != nil {
				if cmdutil.WantsJSON(*format) {
					return cmdutil.WriteCommandError(cmd.OutOrStdout(), *compact, "update element", err)
				}
				return err
			}
			if cmdutil.WantsJSON(*format) {
				return cmdutil.WriteMutation(cmd.OutOrStdout(), *compact, "update element", "update", ref)
			}
			term.Successf(cmd.OutOrStdout(), "updated %q: %s=%q", ref, field, value)
			return nil
		},
	}
}

func newConnectorCmd(wdir, format *string, compact *bool) *cobra.Command {
	return &cobra.Command{
		Use:   "connector <ref> <field> <value>",
		Short: "Update a connector field",
		Args:  cobra.ExactArgs(3),
		ValidArgsFunction: func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
			switch len(args) {
			case 0:
				return completion.ConnectorKeys(wdir)
			case 1:
				return completion.ConnectorFields(), cobra.ShellCompDirectiveNoFileComp
			case 2:
				if args[1] == "direction" {
					return completion.ConnectorDirections(), cobra.ShellCompDirectiveNoFileComp
				}
				return nil, cobra.ShellCompDirectiveNoFileComp
			default:
				return nil, cobra.ShellCompDirectiveNoFileComp
			}
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			ref, field, value := args[0], args[1], args[2]
			if err := workspace.UpdateConnectorField(*wdir, ref, field, value); err != nil {
				if cmdutil.WantsJSON(*format) {
					return cmdutil.WriteCommandError(cmd.OutOrStdout(), *compact, "update connector", err)
				}
				return fmt.Errorf("update connector: %w", err)
			}
			if err := crudsync.ApplyAfterMutation(cmd, *wdir, ""); err != nil {
				if cmdutil.WantsJSON(*format) {
					return cmdutil.WriteCommandError(cmd.OutOrStdout(), *compact, "update connector", err)
				}
				return err
			}
			if cmdutil.WantsJSON(*format) {
				return cmdutil.WriteMutation(cmd.OutOrStdout(), *compact, "update connector", "update", ref)
			}
			term.Successf(cmd.OutOrStdout(), "updated %q: %s=%q", ref, field, value)
			return nil
		},
	}
}
