package serve

import (
	"bytes"
	"strings"
	"testing"

	"github.com/mertcikla/tld/v2/cmd/version"
	"github.com/mertcikla/tld/v2/internal/selfupdate"
)

func TestPrintLogoWithUpdateShowsAvailableVersionInline(t *testing.T) {
	var out bytes.Buffer
	PrintLogoWithUpdate(&out, &selfupdate.Status{UpdateAvailable: true, Latest: "v2.0.3"})

	got := out.String()
	if !strings.Contains(got, "Version:") || !strings.Contains(got, version.Version+" (update available: v2.0.3)") {
		t.Fatalf("logo output = %q, want inline update version", got)
	}
}
