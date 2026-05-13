package localserver

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProcessRegistryUsesGlobalConfigDir(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("TLD_CONFIG_DIR", configDir)

	path, err := ProcessRegistryPath()
	if err != nil {
		t.Fatalf("ProcessRegistryPath: %v", err)
	}
	if path != filepath.Join(configDir, "processes.json") {
		t.Fatalf("path = %q, want global config registry", path)
	}
}

func TestRegisterProcessUpsertsAndPrunesDeadRecords(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("TLD_CONFIG_DIR", configDir)

	if err := SaveProcessRegistry(ProcessRegistry{Processes: []ProcessRecord{
		{Kind: ProcessKindServer, PID: 999999, DataDir: "/old"},
	}}); err != nil {
		t.Fatalf("seed registry: %v", err)
	}

	if err := RegisterProcess(ProcessRecord{Kind: ProcessKindServer, PID: os.Getpid(), DataDir: "/data", Addr: "127.0.0.1:8060"}); err != nil {
		t.Fatalf("RegisterProcess: %v", err)
	}
	if err := RegisterProcess(ProcessRecord{Kind: ProcessKindServer, PID: os.Getpid(), DataDir: "/data", Addr: "127.0.0.1:9000"}); err != nil {
		t.Fatalf("RegisterProcess update: %v", err)
	}

	reg, err := LoadProcessRegistry()
	if err != nil {
		t.Fatalf("LoadProcessRegistry: %v", err)
	}
	if len(reg.Processes) != 1 {
		t.Fatalf("registry has %d processes, want 1: %+v", len(reg.Processes), reg.Processes)
	}
	got := reg.Processes[0]
	if got.PID != os.Getpid() || got.Addr != "127.0.0.1:9000" {
		t.Fatalf("process = %+v, want current pid with updated addr", got)
	}
	if got.StartedAt == "" || got.UpdatedAt == "" {
		t.Fatalf("timestamps should be populated: %+v", got)
	}
}
