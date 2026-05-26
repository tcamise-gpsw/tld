package initialize

import (
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"
)

func TestDetectWorkspaceInitDefaults_CurrentDirUsesRepoRoot(t *testing.T) {
	repoRoot := filepath.Join(t.TempDir(), "current-repo")
	if err := os.MkdirAll(repoRoot, 0750); err != nil {
		t.Fatal(err)
	}
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = repoRoot
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v\n%s", args, err, out)
		}
	}
	run("init")
	if err := os.WriteFile(filepath.Join(repoRoot, "main.cpp"), []byte("int main() { return 0; }\n"), 0600); err != nil {
		t.Fatal(err)
	}

	defaults, err := detectWorkspaceInitDefaults(repoRoot)
	if err != nil {
		t.Fatalf("detect defaults: %v", err)
	}
	if defaults.projectName != "current-repo" {
		t.Fatalf("projectName = %q, want current-repo", defaults.projectName)
	}
	wantRepoRoot, err := filepath.EvalSymlinks(repoRoot)
	if err != nil {
		t.Fatal(err)
	}
	gotRepoRoot, err := filepath.EvalSymlinks(defaults.repoRoot)
	if err != nil {
		t.Fatal(err)
	}
	if gotRepoRoot != wantRepoRoot {
		t.Fatalf("repoRoot = %q, want %q", defaults.repoRoot, repoRoot)
	}
	if !containsString(defaults.exclude, "CMakeFiles/") {
		t.Fatalf("expected C++ excludes, got %#v", defaults.exclude)
	}
}

func containsString(values []string, want string) bool {
	return slices.Contains(values, want)
}
