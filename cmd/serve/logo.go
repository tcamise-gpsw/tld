package serve

import (
	"io"

	"github.com/mertcikla/tld/v2/cmd/version"
	"github.com/mertcikla/tld/v2/internal/term"
)

func PrintLogo(w io.Writer) {
	term.PrintLogo(w, version.Version)
}
