package validate_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mertcikla/tld/v2/cmd"
)

func TestValidateCmd_ValidWorkspace(t *testing.T) {
	dir := t.TempDir()
	cmd.MustInitWorkspace(t, dir)
	if _, _, err := cmd.RunCmd(t, dir, "add", "System", "--ref", "sys", "--kind", "workspace"); err != nil {
		t.Fatalf("add: %v", err)
	}

	stdout, _, err := cmd.RunCmd(t, dir, "validate")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if !strings.Contains(stdout, "Workspace valid") {
		t.Errorf("stdout %q does not contain 'Workspace valid'", stdout)
	}
	if !strings.Contains(stdout, "1 elements") || !strings.Contains(stdout, "0 views") {
		t.Errorf("stdout %q does not contain count summary", stdout)
	}
}

func TestValidateCmd_InvalidWorkspace(t *testing.T) {
	dir := t.TempDir()
	cmd.MustInitWorkspace(t, dir)
	if err := os.WriteFile(filepath.Join(dir, "elements.yaml"), []byte("bad:\n  kind: service\n"), 0600); err != nil {
		t.Fatalf("write elements: %v", err)
	}

	_, stderr, err := cmd.RunCmd(t, dir, "validate")
	if err == nil {
		t.Fatal("expected error for invalid workspace")
	}
	if !strings.Contains(stderr, "Validation errors") {
		t.Errorf("stderr %q does not contain 'Validation errors'", stderr)
	}
}

func TestValidateCmd_RuleCodeWithViolations(t *testing.T) {
	dir := t.TempDir()
	cmd.MustInitWorkspace(t, dir)
	if _, _, err := cmd.RunCmd(t, dir, "add", "System", "--ref", "sys", "--kind", "workspace", "--technology", "Go"); err != nil {
		t.Fatalf("add: %v", err)
	}
	if _, _, err := cmd.RunCmd(t, dir, "add", "Service", "--ref", "svc", "--parent", "sys", "--kind", "service"); err != nil {
		t.Fatalf("add: %v", err)
	}

	stdout, _, err := cmd.RunCmd(t, dir, "validate", "ARC102")
	if err != nil {
		t.Fatalf("validate ARC102: %v", err)
	}
	if !strings.Contains(stdout, "[ARC102]") {
		t.Errorf("stdout %q does not contain [ARC102]", stdout)
	}
	if !strings.Contains(stdout, "Missing Tech") {
		t.Errorf("stdout %q does not contain 'Missing Tech'", stdout)
	}
	if !strings.Contains(stdout, "\"svc\"") {
		t.Errorf("stdout %q does not contain violating element 'svc'", stdout)
	}
	if !strings.Contains(stdout, "How to fix:") {
		t.Errorf("stdout %q does not contain 'How to fix:'", stdout)
	}
}

func TestValidateCmd_RuleCodeNoViolations(t *testing.T) {
	dir := t.TempDir()
	cmd.MustInitWorkspace(t, dir)
	if _, _, err := cmd.RunCmd(t, dir, "add", "System", "--ref", "sys", "--kind", "workspace", "--technology", "Go"); err != nil {
		t.Fatalf("add: %v", err)
	}

	stdout, _, err := cmd.RunCmd(t, dir, "validate", "ARC103")
	if err != nil {
		t.Fatalf("validate ARC103: %v", err)
	}
	if !strings.Contains(stdout, "No violations found for ARC103") {
		t.Errorf("stdout %q does not contain 'No violations found'", stdout)
	}
}

func TestValidateCmd_UnknownRuleCode(t *testing.T) {
	dir := t.TempDir()
	cmd.MustInitWorkspace(t, dir)

	_, _, err := cmd.RunCmd(t, dir, "validate", "INVALID")
	if err == nil {
		t.Fatal("expected error for unknown rule code")
	}
	if !strings.Contains(err.Error(), "unknown rule code") {
		t.Errorf("error %q does not contain 'unknown rule code'", err)
	}
}

func TestValidateCmd_VerboseFlag(t *testing.T) {
	dir := t.TempDir()
	cmd.MustInitWorkspace(t, dir)
	if _, _, err := cmd.RunCmd(t, dir, "add", "System", "--ref", "sys", "--kind", "workspace"); err != nil {
		t.Fatalf("add: %v", err)
	}

	stdout, _, err := cmd.RunCmd(t, dir, "validate", "-v")
	if err != nil {
		t.Fatalf("validate -v: %v", err)
	}
	if !strings.Contains(stdout, "Workspace valid") {
		t.Errorf("stdout %q does not contain 'Workspace valid'", stdout)
	}
}
