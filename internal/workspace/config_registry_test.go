package workspace_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mertcikla/tld/v2/internal/workspace"
)

func TestLoadGlobalConfigStateReportsEnvSourcesAndDoesNotRewriteExistingConfig(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("TLD_CONFIG_DIR", configDir)
	t.Setenv("TLD_API_KEY", "env-secret")

	configPath := filepath.Join(configDir, "tld.yaml")
	original := "server_url: http://file.example\nunknown_root: keep-me\n"
	writeFile(t, configPath, original)

	state, err := workspace.LoadGlobalConfigState()
	if err != nil {
		t.Fatalf("LoadGlobalConfigState: %v", err)
	}
	if state.Config.APIKey != "env-secret" {
		t.Fatalf("APIKey = %q, want env-secret", state.Config.APIKey)
	}

	var apiKey workspace.ConfigValue
	for _, value := range state.Values {
		if value.Key == "api_key" {
			apiKey = value
			break
		}
	}
	if apiKey.Source != workspace.ConfigSourceEnv || apiKey.Env != "TLD_API_KEY" {
		t.Fatalf("api_key source = %q env = %q, want env/TLD_API_KEY", apiKey.Source, apiKey.Env)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	content := string(data)
	if strings.Contains(content, "env-secret") {
		t.Fatalf("env override was persisted:\n%s", content)
	}
	if content != original {
		t.Fatalf("config was rewritten:\n%s", content)
	}
}

func TestSetGlobalConfigValuePreservesUnknownAndValidates(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("TLD_CONFIG_DIR", configDir)
	configPath := filepath.Join(configDir, "tld.yaml")
	writeFile(t, configPath, "server_url: https://tldiagram.com\nunknown_root: keep-me\nwatch:\n  unknown_watch: still-here\n")

	if err := workspace.SetGlobalConfigValue("serve.port", "9000"); err != nil {
		t.Fatalf("SetGlobalConfigValue: %v", err)
	}
	cfg, err := workspace.LoadGlobalConfig()
	if err != nil {
		t.Fatalf("LoadGlobalConfig: %v", err)
	}
	if cfg.Serve.Port != "9000" {
		t.Fatalf("Serve.Port = %q, want 9000", cfg.Serve.Port)
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	content := string(data)
	if !strings.Contains(content, "unknown_root: keep-me") || !strings.Contains(content, "unknown_watch: still-here") {
		t.Fatalf("unknown keys were not preserved:\n%s", content)
	}

	if err := workspace.SetGlobalConfigValue("watch.watcher", "bogus"); err == nil {
		t.Fatal("expected invalid watcher to fail")
	}
}

func TestEnsureGlobalConfigDoesNotRewriteExistingConfig(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("TLD_CONFIG_DIR", configDir)
	configPath := filepath.Join(configDir, "tld.yaml")
	original := "server_url: https://example.invalid\napi_key: existing-secret\norg_id: existing-org\nunknown_root: keep-me\n"
	writeFile(t, configPath, original)

	if err := workspace.EnsureGlobalConfig(); err != nil {
		t.Fatalf("EnsureGlobalConfig: %v", err)
	}

	cfg, err := workspace.LoadGlobalConfig()
	if err != nil {
		t.Fatalf("LoadGlobalConfig: %v", err)
	}
	if cfg.ServerURL != "https://example.invalid" {
		t.Fatalf("ServerURL = %q, want existing value", cfg.ServerURL)
	}
	if cfg.APIKey != "existing-secret" {
		t.Fatalf("APIKey = %q, want existing-secret", cfg.APIKey)
	}
	if cfg.WorkspaceID != "existing-org" {
		t.Fatalf("WorkspaceID = %q, want existing-org", cfg.WorkspaceID)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	content := string(data)
	if !strings.Contains(content, "unknown_root: keep-me") {
		t.Fatalf("unknown key was not preserved:\n%s", content)
	}
	if content != original {
		t.Fatalf("existing config was rewritten:\n%s", content)
	}
}

func TestResolveWatchLayoutConfigUsesEnvOverride(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("TLD_CONFIG_DIR", configDir)
	t.Setenv("LAYOUT_LINK_DISTANCE", "222")
	writeFile(t, filepath.Join(configDir, "tld.yaml"), "watch:\n  layout:\n    link_distance: 111\n")

	got := workspace.ResolveWatchLayoutConfig()
	if got.LinkDistance != 222 {
		t.Fatalf("LinkDistance = %v, want env override 222", got.LinkDistance)
	}
}
