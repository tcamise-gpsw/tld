package add

import (
	"fmt"
	"strings"

	"github.com/mertcikla/tld/v2/internal/cmdutil"
	"github.com/mertcikla/tld/v2/internal/completion"
	"github.com/mertcikla/tld/v2/internal/term"

	"github.com/mertcikla/tld/v2/internal/workspace"
	"github.com/spf13/cobra"
)

func NewCreateElementCmd(wdir *string) *cobra.Command {
	var (
		description     string
		technology      string
		dryRun          bool
		url             string
		positionX       float64
		positionY       float64
		ref             string
		kind            string
		parent          string
		diagramLabel    string
		legacyViewLabel string
		legacyWithView  bool
	)

	c := &cobra.Command{
		Use:   "element <name>",
		Short: "Create or update an element in elements.yaml",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			if !isValidKind(kind) {
				return fmt.Errorf("invalid --kind %q. valid kinds: %s", kind, strings.Join(completion.ElementKinds(), ", "))
			}
			r := ref
			if r == "" {
				r = workspace.Slugify(name)
				if r == "" {
					return fmt.Errorf("could not generate a valid reference from name %q. please provide an explicit reference with --ref (e.g. --ref my-element)", name)
				}
			}
			if err := workspace.ValidateElementRef(r); err != nil {
				return err
			}
			placementParent := parent
			if placementParent == "" {
				placementParent = "root"
			}
			if err := workspace.ValidateParentRef(placementParent); err != nil {
				return err
			}
			if placementParent != workspace.RootRef {
				ws, err := workspace.Load(*wdir)
				if err != nil {
					return fmt.Errorf("load workspace: %w", err)
				}
				if _, ok := ws.Elements[placementParent]; !ok {
					return fmt.Errorf("parent ref %q not found", placementParent)
				}
			}
			if diagramLabel == "" {
				diagramLabel = legacyViewLabel
			}
			_ = legacyWithView
			normalizedTechnology, wasNormalized := normalizeTechnology(technology)
			spec := &workspace.Element{
				Name:        name,
				Kind:        kind,
				Description: description,
				Technology:  normalizedTechnology,
				URL:         url,
				HasView:     true,
				ViewLabel:   diagramLabel,
				Placements: []workspace.ViewPlacement{{
					ParentRef: placementParent,
					PositionX: positionX,
					PositionY: positionY,
				}},
			}
			validateAndWarnTechnology(cmd, technology)
			if dryRun {
				if err := cmdutil.WithWorkspaceDryRun(*wdir, func(cloneDir string) error {
					return workspace.UpsertElement(cloneDir, r, spec)
				}); err != nil {
					if cmdutil.WantsJSON(cmd.Root().PersistentFlags().Lookup("format").Value.String()) {
						return cmdutil.WriteCommandError(cmd.OutOrStdout(), cmd.Root().PersistentFlags().Lookup("compact").Value.String() == "true", "add", err)
					}
					return fmt.Errorf("dry-run add element: %w", err)
				}
				if cmdutil.WantsJSON(cmd.Root().PersistentFlags().Lookup("format").Value.String()) {
					return cmdutil.WriteMutation(cmd.OutOrStdout(), cmd.Root().PersistentFlags().Lookup("compact").Value.String() == "true", "add", "dry-run", r)
				}
				term.Successf(cmd.OutOrStdout(), "dry-run: add: %s", r)
				term.Infof(cmd.OutOrStdout(), "kind=%s parent=%s", kind, placementParent)
				if wasNormalized {
					term.Infof(cmd.OutOrStdout(), "technology normalized: %q -> %q", technology, normalizedTechnology)
				}
				return nil
			}
			if err := workspace.UpsertElement(*wdir, r, spec); err != nil {
				if cmdutil.WantsJSON(cmd.Root().PersistentFlags().Lookup("format").Value.String()) {
					return cmdutil.WriteCommandError(cmd.OutOrStdout(), cmd.Root().PersistentFlags().Lookup("compact").Value.String() == "true", "add", err)
				}
				return fmt.Errorf("upsert element: %w", err)
			}
			if cmdutil.WantsJSON(cmd.Root().PersistentFlags().Lookup("format").Value.String()) {
				return cmdutil.WriteMutation(cmd.OutOrStdout(), cmd.Root().PersistentFlags().Lookup("compact").Value.String() == "true", "add", "add", r)
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Updated elements.yaml (upserted %s)\n", r)
			if wasNormalized {
				term.Infof(cmd.OutOrStdout(), "technology normalized: %q -> %q", technology, normalizedTechnology)
			}
			return nil
		},
	}

	c.Flags().StringVar(&kind, "kind", "service", "element kind")
	c.Flags().StringVar(&description, "description", "", "description")
	c.Flags().StringVar(&technology, "technology", "", "primary technology")
	c.Flags().StringVar(&url, "url", "", "external URL")
	c.Flags().Float64Var(&positionX, "position-x", 0, "horizontal canvas position")
	c.Flags().Float64Var(&positionY, "position-y", 0, "vertical canvas position")
	c.Flags().StringVar(&ref, "ref", "", "override generated ref (default: slugified name)")
	c.Flags().StringVar(&parent, "parent", "root", "parent element ref or root")
	c.Flags().BoolVar(&dryRun, "dry-run", false, "preview the change without writing files")
	c.Flags().StringVar(&diagramLabel, "diagram-label", "", "optional label for the element's canonical diagram")
	c.Flags().BoolVar(&legacyWithView, "with-view", false, "deprecated")
	c.Flags().StringVar(&legacyViewLabel, "view-label", "", "deprecated")
	_ = c.Flags().MarkHidden("with-view")
	_ = c.Flags().MarkHidden("view-label")
	return c
}
