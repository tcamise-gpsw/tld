package kinds
package kinds_test

import (
	"bytes"
	"strings"
	"testing"

	"github.com/mertcikla/tld/v2/cmd/kinds"
)

func TestKindsCmd_ListsCanonicalKinds(t *testing.T) {
	cmd := kinds.NewKindsCmd()
	buf := &bytes.Buffer{}
	cmd.SetOut(buf)
	cmd.SetErr(buf)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute kinds: %v", err)
	}
	output := buf.String()
	for _, kind := range []string{"service", "database", "workspace", "system", "container", "component", "person", "external"} {
		if !strings.Contains(output, kind+"\n") {
			t.Fatalf("missing kind %q in output:\n%s", kind, output)
		}
	}
}
