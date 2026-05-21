package kinds
package kinds

import (
	"fmt"
	"sort"

	"github.com/mertcikla/tld/v2/internal/completion"
	"github.com/spf13/cobra"
)

func NewKindsCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "kinds",
		Short: "List canonical element kinds",
		RunE: func(cmd *cobra.Command, _ []string) error {
			kinds := append([]string{}, completion.ElementKinds()...)
			sort.Strings(kinds)
			for _, kind := range kinds {
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), kind)
			}
			return nil
		},
	}
	return c
}
