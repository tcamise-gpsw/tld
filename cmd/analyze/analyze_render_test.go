package analyze

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/mertcikla/tld/v2/internal/watch/exportyaml"
)

func TestRenderAnalyzeCompleteOutputIsCompactAndOrdered(t *testing.T) {
	var out bytes.Buffer
	history := bytes.NewBufferString("    Finished Opening workspace database in 0s (1/1)\n    Finished Exporting workspace YAML in 1s (9/9)\n")

	renderAnalyzeComplete(&out, nil, analyzeCompleteView{
		Version:         "2.2.0",
		Path:            "/repo/app",
		DataDir:         "/tmp/tld",
		LSP:             "requested=1 available=1 active=1 degraded=0",
		DryRun:          true,
		Changed:         true,
		Duration:        65 * time.Second,
		ProgressHistory: history,
		Export: exportyaml.Result{
			ElementsWritten:   3,
			ConnectorsWritten: 2,
			ViewsWritten:      1,
		},
	})

	got := out.String()
	for _, want := range []string{
		"tld analyze 2.2.0",
		"Workspace\n",
		"Data directory",
		"Runtime\n",
		"Mode",
		"Results\n",
		"3 written to elements.yaml",
		"2 written to connectors.yaml",
		"1m05s",
		"No files written. Remove --dry-run to apply.",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("analyze output missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "░███████") || strings.Contains(got, "✓") {
		t.Fatalf("analyze output should not include logo or completion glyphs:\n%s", got)
	}
	for _, unwanted := range []string{"Pipeline\n", "Opening workspace database in 0s (1/1)", "Exporting workspace YAML in 1s (9/9)"} {
		if strings.Contains(got, unwanted) {
			t.Fatalf("analyze output should hide pipeline history without verbose, found %q:\n%s", unwanted, got)
		}
	}
	if strings.Index(got, "Results\n") < strings.Index(got, "Runtime\n") {
		t.Fatalf("results should render after runtime rows:\n%s", got)
	}
}

func TestRenderAnalyzeCompleteVerbosePrintsPipelineHistory(t *testing.T) {
	var out bytes.Buffer
	history := bytes.NewBufferString("    Finished Opening workspace database in 0s (1/1)\n    Finished Exporting workspace YAML in 1s (9/9)\n")

	renderAnalyzeComplete(&out, nil, analyzeCompleteView{
		Version:         "2.2.0",
		Path:            "/repo/app",
		DataDir:         "/tmp/tld",
		LSP:             "requested=1 available=1 active=1 degraded=0",
		Duration:        65 * time.Second,
		ProgressHistory: history,
		Verbose:         true,
		Export: exportyaml.Result{
			ElementsWritten:   3,
			ConnectorsWritten: 2,
			ViewsWritten:      1,
		},
	})

	got := out.String()
	for _, want := range []string{
		"Pipeline\n",
		"Opening workspace database in 0s (1/1)",
		"Exporting workspace YAML in 1s (9/9)",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("verbose analyze output missing %q:\n%s", want, got)
		}
	}
	if strings.Index(got, "Pipeline\n") < strings.Index(got, "Runtime\n") {
		t.Fatalf("pipeline history should render after runtime rows:\n%s", got)
	}
	if strings.Index(got, "Results\n") < strings.Index(got, "Pipeline\n") {
		t.Fatalf("results should render after pipeline history:\n%s", got)
	}
}
