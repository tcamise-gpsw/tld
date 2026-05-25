package workspace_test

import (
	"os"
	"path/filepath"
	"reflect"
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

func TestSetGlobalConfigValueSupportsEmbeddingMaxTokens(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("TLD_CONFIG_DIR", configDir)

	if err := workspace.SetGlobalConfigValue("watch.embedding.max_tokens", "8192"); err != nil {
		t.Fatalf("SetGlobalConfigValue: %v", err)
	}
	cfg, err := workspace.LoadGlobalConfig()
	if err != nil {
		t.Fatalf("LoadGlobalConfig: %v", err)
	}
	if cfg.Watch.Embedding.MaxTokens != 8192 {
		t.Fatalf("max_tokens = %v, want 8192", cfg.Watch.Embedding.MaxTokens)
	}
	if err := workspace.SetGlobalConfigValue("watch.embedding.max_tokens", "-1"); err == nil {
		t.Fatal("expected negative max_tokens to fail validation")
	}
}

func TestWatchEmbeddingEndpointSupportsMultipleValues(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("TLD_CONFIG_DIR", configDir)
	configPath := filepath.Join(configDir, "tld.yaml")
	writeFile(t, configPath, `watch:
  embedding:
    provider: openai
    endpoint:
      - http://127.0.0.1:8000/v1/embeddings
      - http://127.0.0.1:8001/v1/embeddings
    model: embeddinggemma-300m-4bit
    health_threshold: 0.7
`)

	cfg, err := workspace.LoadGlobalConfig()
	if err != nil {
		t.Fatalf("LoadGlobalConfig: %v", err)
	}
	want := []string{"http://127.0.0.1:8000/v1/embeddings", "http://127.0.0.1:8001/v1/embeddings"}
	if got := cfg.Watch.Embedding.Endpoint.Values(); !reflect.DeepEqual(got, want) {
		t.Fatalf("endpoints = %#v, want %#v", got, want)
	}

	if err := workspace.SetGlobalConfigValue("watch.embedding.endpoint", strings.Join(want, ",")); err != nil {
		t.Fatalf("SetGlobalConfigValue: %v", err)
	}
	cfg, err = workspace.LoadGlobalConfig()
	if err != nil {
		t.Fatalf("LoadGlobalConfig after set: %v", err)
	}
	if got := cfg.Watch.Embedding.Endpoint.Values(); !reflect.DeepEqual(got, want) {
		t.Fatalf("endpoints after set = %#v, want %#v", got, want)
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

func TestGlobalConfigLSPDefaultsAndEnvOverrides(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("TLD_CONFIG_DIR", configDir)
	t.Setenv("TLD_WATCH_LSP_ENABLED", "false")
	t.Setenv("TLD_WATCH_LSP_HEALTH_INTERVAL", "2m")
	t.Setenv("TLD_WATCH_LSP_MEMORY_LIMIT_BYTES", "2048")

	cfg, err := workspace.LoadGlobalConfig()
	if err != nil {
		t.Fatalf("LoadGlobalConfig: %v", err)
	}
	if cfg.Watch.LSP.Enabled {
		t.Fatal("Watch.LSP.Enabled = true, want env override false")
	}
	if cfg.Watch.LSP.HealthInterval != "2m" {
		t.Fatalf("Watch.LSP.HealthInterval = %q, want 2m", cfg.Watch.LSP.HealthInterval)
	}
	if cfg.Watch.LSP.MemoryLimitBytes != 2048 {
		t.Fatalf("Watch.LSP.MemoryLimitBytes = %d, want 2048", cfg.Watch.LSP.MemoryLimitBytes)
	}
}

func TestGlobalConfigScaleRecentAndCallerEnvOverrides(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("TLD_CONFIG_DIR", configDir)
	t.Setenv("TLD_WATCH_SCALE_MAX_RECENT_FILES", "123")
	t.Setenv("TLD_WATCH_SCALE_MAX_CALLER_DEPTH", "7")

	cfg, err := workspace.LoadGlobalConfig()
	if err != nil {
		t.Fatalf("LoadGlobalConfig: %v", err)
	}
	if cfg.Watch.Scale.MaxRecentFiles != 123 {
		t.Fatalf("MaxRecentFiles = %d, want 123", cfg.Watch.Scale.MaxRecentFiles)
	}
	if cfg.Watch.Scale.MaxCallerDepth != 7 {
		t.Fatalf("MaxCallerDepth = %d, want 7", cfg.Watch.Scale.MaxCallerDepth)
	}
}

func TestSetGlobalConfigLSPValue(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("TLD_CONFIG_DIR", configDir)

	if err := workspace.SetGlobalConfigValue("watch.lsp.memory_limit_bytes", "4096"); err != nil {
		t.Fatalf("SetGlobalConfigValue memory: %v", err)
	}
	if err := workspace.SetGlobalConfigValue("watch.lsp.health_interval", "30s"); err != nil {
		t.Fatalf("SetGlobalConfigValue interval: %v", err)
	}
	cfg, err := workspace.LoadGlobalConfig()
	if err != nil {
		t.Fatalf("LoadGlobalConfig: %v", err)
	}
	if cfg.Watch.LSP.MemoryLimitBytes != 4096 {
		t.Fatalf("Watch.LSP.MemoryLimitBytes = %d, want 4096", cfg.Watch.LSP.MemoryLimitBytes)
	}
	if cfg.Watch.LSP.HealthInterval != "30s" {
		t.Fatalf("Watch.LSP.HealthInterval = %q, want 30s", cfg.Watch.LSP.HealthInterval)
	}

	if err := workspace.SetGlobalConfigValue("watch.lsp.memory_limit_bytes", "0"); err == nil {
		t.Fatal("expected invalid memory limit to fail")
	}
}
