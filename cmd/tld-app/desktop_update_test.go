package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDesktopAssetName(t *testing.T) {
	tests := []struct {
		name  string
		goos  string
		arch  string
		asset string
		ok    bool
	}{
		{name: "mac arm64", goos: "darwin", arch: "arm64", asset: "tld-macos-arm64.zip", ok: true},
		{name: "mac amd64", goos: "darwin", arch: "amd64", asset: "tld-macos-amd64.zip", ok: true},
		{name: "windows amd64", goos: "windows", arch: "amd64", asset: "tld-windows-amd64-installer.exe", ok: true},
		{name: "linux unsupported", goos: "linux", arch: "amd64", asset: "", ok: false},
		{name: "windows arm64 unsupported", goos: "windows", arch: "arm64", asset: "", ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			asset, ok := desktopAssetName(tt.goos, tt.arch)
			if asset != tt.asset || ok != tt.ok {
				t.Fatalf("desktopAssetName(%q, %q) = %q, %v; want %q, %v", tt.goos, tt.arch, asset, ok, tt.asset, tt.ok)
			}
		})
	}
}

func TestCurrentAppBundleFromExecutable(t *testing.T) {
	root := filepath.Join(t.TempDir(), "tld.app")
	exe := filepath.Join(root, "Contents", "MacOS", "tld")

	got, err := currentAppBundleFromExecutable(exe)
	if err != nil {
		t.Fatalf("currentAppBundleFromExecutable returned error: %v", err)
	}
	if got != root {
		t.Fatalf("bundle = %q, want %q", got, root)
	}
}

func TestCurrentAppBundleFromExecutableRejectsNonBundle(t *testing.T) {
	if _, err := currentAppBundleFromExecutable(filepath.Join(t.TempDir(), "tld")); err == nil {
		t.Fatal("currentAppBundleFromExecutable returned nil error outside app bundle")
	}
}

func TestFindExtractedAppBundlePrefersTLDApp(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "Other.app"), 0o755); err != nil {
		t.Fatalf("mkdir Other.app: %v", err)
	}
	tldApp := filepath.Join(dir, "tld.app")
	if err := os.Mkdir(tldApp, 0o755); err != nil {
		t.Fatalf("mkdir tld.app: %v", err)
	}

	got, err := findExtractedAppBundle(dir)
	if err != nil {
		t.Fatalf("findExtractedAppBundle returned error: %v", err)
	}
	if got != tldApp {
		t.Fatalf("bundle = %q, want %q", got, tldApp)
	}
}

func TestFindExtractedAppBundleRequiresApp(t *testing.T) {
	if _, err := findExtractedAppBundle(t.TempDir()); err == nil {
		t.Fatal("findExtractedAppBundle returned nil error without app bundle")
	}
}
