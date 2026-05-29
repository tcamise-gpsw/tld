package lsp

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mertcikla/tld/v2/internal/analyzer"
)

func TestResolveServerCommandWithLookPath(t *testing.T) {
	resolved, err := ResolveServerCommandWithLookPath(analyzer.LanguageGo, func(file string) (string, error) {
		if file == "gopls" {
			return filepath.Join("/tmp", "gopls"), nil
		}
		return "", errors.New("missing")
	})
	if err != nil {
		t.Fatalf("ResolveServerCommandWithLookPath: %v", err)
	}
	if resolved.Path != filepath.Join("/tmp", "gopls") {
		t.Fatalf("resolved path = %q", resolved.Path)
	}
	if len(resolved.Args) != 0 {
		t.Fatalf("expected no args, got %#v", resolved.Args)
	}
	if resolved.CommandSource != CommandSourceDefault {
		t.Fatalf("CommandSource = %q, want default", resolved.CommandSource)
	}
}

func TestResolveServerCommandWithOverrides(t *testing.T) {
	resolved, err := ResolveServerCommandWithOverrides(analyzer.LanguageTypeScript, map[analyzer.Language]string{
		analyzer.LanguageTypeScript: "custom-ts-lsp --stdio --log trace",
	}, func(file string) (string, error) {
		if file == "custom-ts-lsp" {
			return filepath.Join("/opt", "bin", file), nil
		}
		return "", errors.New("missing")
	})
	if err != nil {
		t.Fatalf("ResolveServerCommandWithOverrides: %v", err)
	}
	if resolved.Path != filepath.Join("/opt", "bin", "custom-ts-lsp") {
		t.Fatalf("Path = %q", resolved.Path)
	}
	wantArgs := []string{"--stdio", "--log", "trace"}
	if strings.Join(resolved.Args, ",") != strings.Join(wantArgs, ",") {
		t.Fatalf("Args = %#v, want %#v", resolved.Args, wantArgs)
	}
	if resolved.CommandSource != CommandSourceOverride {
		t.Fatalf("CommandSource = %q, want override", resolved.CommandSource)
	}
}

func TestResolveServerCommandWithOverrideQuotedPath(t *testing.T) {
	resolved, err := ResolveServerCommandWithOverrides(analyzer.LanguageGo, map[analyzer.Language]string{
		analyzer.LanguageGo: `"/opt/Language Servers/gopls" -remote=auto`,
	}, func(file string) (string, error) {
		if file == "/opt/Language Servers/gopls" {
			return file, nil
		}
		return "", errors.New("missing")
	})
	if err != nil {
		t.Fatalf("ResolveServerCommandWithOverrides: %v", err)
	}
	if resolved.Path != "/opt/Language Servers/gopls" {
		t.Fatalf("Path = %q", resolved.Path)
	}
	if len(resolved.Args) != 1 || resolved.Args[0] != "-remote=auto" {
		t.Fatalf("Args = %#v", resolved.Args)
	}
}

func TestResolveServerCommandWithOverrideInvalid(t *testing.T) {
	_, err := ResolveServerCommandWithOverrides(analyzer.LanguageGo, map[analyzer.Language]string{
		analyzer.LanguageGo: `"unterminated`,
	}, func(file string) (string, error) {
		return filepath.Join("/tmp", file), nil
	})
	var invalid ErrServerCommandInvalid
	if !errors.As(err, &invalid) {
		t.Fatalf("expected ErrServerCommandInvalid, got %T: %v", err, err)
	}
}

func TestResolveServerCommandWithOverrideMissing(t *testing.T) {
	_, err := ResolveServerCommandWithOverrides(analyzer.LanguageGo, map[analyzer.Language]string{
		analyzer.LanguageGo: "custom-gopls",
	}, func(file string) (string, error) {
		return "", errors.New("missing")
	})
	var notFound ErrServerNotFound
	if !errors.As(err, &notFound) {
		t.Fatalf("expected ErrServerNotFound, got %T: %v", err, err)
	}
	if got := err.Error(); !strings.Contains(got, "tried override: custom-gopls") {
		t.Fatalf("missing override detail in error message: %q", got)
	}
}

func TestResolveServerCommandWithLookPath_MissingServer(t *testing.T) {
	_, err := ResolveServerCommandWithLookPath(analyzer.LanguagePython, func(file string) (string, error) {
		return "", errors.New("missing")
	})
	var notFound ErrServerNotFound
	if !errors.As(err, &notFound) {
		t.Fatalf("expected ErrServerNotFound, got %T: %v", err, err)
	}
	if got := err.Error(); !strings.Contains(got, "pyright-langserver --stdio") {
		t.Fatalf("missing candidate in error message: %q", got)
	}
}

func TestResolveServerCommandWithLookPath_UnconfiguredLanguage(t *testing.T) {
	_, err := ResolveServerCommandWithLookPath(analyzer.Language("ruby"), func(file string) (string, error) {
		return filepath.Join("/tmp", file), nil
	})
	var notConfigured ErrServerNotConfigured
	if !errors.As(err, &notConfigured) {
		t.Fatalf("expected ErrServerNotConfigured, got %T: %v", err, err)
	}
}

func TestSnapshotLanguagesReportsAvailability(t *testing.T) {
	snapshot := SnapshotLanguages([]analyzer.Language{analyzer.LanguageGo, analyzer.Language("ruby")}, ResolverConfig{
		Enabled:          true,
		HealthInterval:   0,
		MemoryLimitBytes: 1,
	})
	if !snapshot.Enabled {
		t.Fatal("snapshot should be enabled")
	}
	if len(snapshot.Servers) != 2 {
		t.Fatalf("servers = %d, want 2", len(snapshot.Servers))
	}
	var ruby ServerStatus
	for _, server := range snapshot.Servers {
		if server.Language == "ruby" {
			ruby = server
			break
		}
	}
	if ruby.State != StateUnavailable {
		t.Fatalf("ruby state = %q, want unavailable", ruby.State)
	}
	if ruby.LastError == "" {
		t.Fatal("ruby LastError is empty")
	}
}

func TestSnapshotLanguagesReportsOverrideCommandSource(t *testing.T) {
	snapshot := SnapshotLanguages([]analyzer.Language{analyzer.LanguageGo}, ResolverConfig{
		Enabled:          true,
		HealthInterval:   0,
		MemoryLimitBytes: 1,
		Commands:         map[analyzer.Language]string{analyzer.LanguageGo: "definitely-missing-gopls"},
	})
	if len(snapshot.Servers) != 1 {
		t.Fatalf("servers = %d, want 1", len(snapshot.Servers))
	}
	server := snapshot.Servers[0]
	if server.CommandSource != CommandSourceOverride {
		t.Fatalf("CommandSource = %q, want override", server.CommandSource)
	}
	if server.State != StateUnavailable {
		t.Fatalf("State = %q, want unavailable", server.State)
	}
	if !strings.Contains(server.LastError, "tried override") {
		t.Fatalf("LastError = %q", server.LastError)
	}
}

func TestSnapshotLanguagesReportsDisabled(t *testing.T) {
	snapshot := SnapshotLanguages([]analyzer.Language{analyzer.LanguageGo}, ResolverConfig{
		Enabled:          false,
		HealthInterval:   0,
		MemoryLimitBytes: 1,
	})
	if snapshot.Enabled {
		t.Fatal("snapshot should be disabled")
	}
	if len(snapshot.Servers) != 1 {
		t.Fatalf("servers = %d, want 1", len(snapshot.Servers))
	}
	if snapshot.Servers[0].State != StateDisabled {
		t.Fatalf("state = %q, want disabled", snapshot.Servers[0].State)
	}
}
