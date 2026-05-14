package apply_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	assets "github.com/mertcikla/tld/v2"
	"github.com/mertcikla/tld/v2/cmd"
	"github.com/mertcikla/tld/v2/internal/localserver"
	"github.com/mertcikla/tld/v2/internal/store"
	"github.com/mertcikla/tld/v2/internal/workspace"
)

func TestCRUDManualApplyCreatesSQLiteAndPrunes(t *testing.T) {
	dir := t.TempDir()
	dataDir := t.TempDir()
	t.Setenv("TLD_DATA_DIR", dataDir)
	cmd.MustInitWorkspace(t, dir)

	cmd.MustRunCmd(t, dir, "add", "Platform", "--ref", "platform", "--kind", "workspace")
	cmd.MustRunCmd(t, dir, "add", "API", "--ref", "api", "--parent", "platform", "--kind", "service")
	cmd.MustRunCmd(t, dir, "add", "DB", "--ref", "db", "--parent", "platform", "--kind", "database")
	cmd.MustRunCmd(t, dir, "connect", "--from", "api", "--to", "db", "--label", "reads")
	cmd.MustRunCmd(t, dir, "apply", "--force", "--target", "local", "--data-dir", dataDir)

	db := openLocalDB(t, dataDir)
	assertCount(t, db, "elements", 3)
	assertCount(t, db, "views", 2)
	assertCount(t, db, "placements", 3)
	assertCount(t, db, "connectors", 1)

	ws, err := workspace.Load(dir)
	if err != nil {
		t.Fatalf("load workspace: %v", err)
	}
	if ws.Meta == nil || len(ws.Meta.Elements) != 3 || len(ws.Meta.Views) != 1 || len(ws.Meta.Connectors) != 1 {
		t.Fatalf("metadata not updated: %+v", ws.Meta)
	}
	lockFile, err := workspace.LoadLockFile(dir)
	if err != nil {
		t.Fatalf("load lock file: %v", err)
	}
	if lockFile == nil || lockFile.Metadata == nil || len(lockFile.Metadata.Elements) != 3 {
		t.Fatalf("lockfile metadata not updated: %+v", lockFile)
	}

	cmd.MustRunCmd(t, dir, "remove", "connector", "--view", "platform", "--from", "api", "--to", "db")
	cmd.MustRunCmd(t, dir, "apply", "--force", "--target", "local", "--data-dir", dataDir)
	assertCount(t, db, "connectors", 0)

	cmd.MustRunCmd(t, dir, "remove", "element", "db")
	cmd.MustRunCmd(t, dir, "apply", "--force", "--target", "local", "--data-dir", dataDir)
	assertCount(t, db, "elements", 2)
	assertCount(t, db, "views", 2)
}

func TestAddDoesNotAutoApplyLocalOrRemote(t *testing.T) {
	dir := t.TempDir()
	dataDir := t.TempDir()
	t.Setenv("TLD_DATA_DIR", dataDir)
	t.Setenv("TLD_APPLY_TARGET", "local")
	cmd.MustInitWorkspace(t, dir)

	cmd.MustRunCmd(t, dir, "add", "API", "--ref", "api", "--kind", "service")

	if _, err := os.Stat(localserver.DatabasePath(dataDir)); !os.IsNotExist(err) {
		t.Fatalf("add should not create local DB before apply, stat error: %v", err)
	}

	svc := &cmd.MockDiagramService{}
	serverURL := cmd.NewMockServer(t, svc)
	remoteDir := t.TempDir()
	cmd.MustInitWorkspace(t, remoteDir)
	cmd.WriteConfig(t, remoteDir, serverURL, "remote-key")

	cmd.MustRunCmd(t, remoteDir, "add", "API", "--ref", "api", "--kind", "service")

	svc.Mu.Lock()
	defer svc.Mu.Unlock()
	if svc.LastRequest != nil {
		t.Fatal("add should only update YAML; expected no remote apply request")
	}
}

func openLocalDB(t *testing.T, dataDir string) *sql.DB {
	t.Helper()
	sqliteStore, err := store.Open(localserver.DatabasePath(dataDir), assets.FS)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = sqliteStore.Legacy().Close() })
	return sqliteStore.DB()
}

func assertCount(t *testing.T, db *sql.DB, table string, want int) {
	t.Helper()
	queryByTable := map[string]string{
		"elements":   "SELECT COUNT(*) FROM elements",
		"views":      "SELECT COUNT(*) FROM views",
		"placements": "SELECT COUNT(*) FROM placements",
		"connectors": "SELECT COUNT(*) FROM connectors",
	}
	query, ok := queryByTable[table]
	if !ok {
		t.Fatalf("unknown table %q", table)
	}
	var got int
	if err := db.QueryRowContext(context.Background(), query).Scan(&got); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	if got != want {
		t.Fatalf("%s count = %d, want %d", table, got, want)
	}
}

func TestApplyLocalTargetUsesDataDirFlag(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TLD_DATA_DIR", t.TempDir())
	dataDir := t.TempDir()
	cmd.MustInitWorkspace(t, dir)
	cmd.MustRunCmd(t, dir, "add", "API", "--ref", "api", "--kind", "service")

	cmd.MustRunCmd(t, dir, "apply", "--force", "--target", "local", "--data-dir", dataDir)

	sqliteStore, err := store.Open(filepath.Join(dataDir, "tld.db"), assets.FS)
	if err != nil {
		t.Fatalf("expected local db in data dir: %v", err)
	}
	defer func() { _ = sqliteStore.Legacy().Close() }()
	assertCount(t, sqliteStore.DB(), "elements", 1)
}

func TestApplyLocalTargetPrintsServeCommandWhenServerIsStopped(t *testing.T) {
	dir := t.TempDir()
	dataDir := t.TempDir()
	cmd.MustInitWorkspace(t, dir)
	cmd.MustRunCmd(t, dir, "add", "API", "--ref", "api", "--kind", "service")

	stdout, _, err := cmd.RunCmd(t, dir, "apply", "--force", "--target", "local", "--data-dir", dataDir)
	if err != nil {
		t.Fatalf("apply local: %v", err)
	}
	if !strings.Contains(stdout, "Target:") || !strings.Contains(stdout, "local") {
		t.Fatalf("stdout %q does not contain local target", stdout)
	}
	if !strings.Contains(stdout, "Start app:") || !strings.Contains(stdout, "tld serve --data-dir "+dataDir) {
		t.Fatalf("stdout %q does not contain serve command", stdout)
	}
}

func TestApplyLocalTargetPrintsRunningServerURL(t *testing.T) {
	dir := t.TempDir()
	dataDir := t.TempDir()
	cmd.MustInitWorkspace(t, dir)
	cmd.MustRunCmd(t, dir, "add", "API", "--ref", "api", "--kind", "service")
	if err := localserver.SaveProcessRegistry(localserver.ProcessRegistry{Processes: []localserver.ProcessRecord{
		{Kind: localserver.ProcessKindServer, PID: os.Getpid(), DataDir: dataDir, Addr: "127.0.0.1:9999"},
	}}); err != nil {
		t.Fatalf("save process registry: %v", err)
	}

	stdout, _, err := cmd.RunCmd(t, dir, "apply", "--force", "--target", "local", "--data-dir", dataDir)
	if err != nil {
		t.Fatalf("apply local: %v", err)
	}
	if !strings.Contains(stdout, "Open app:") || !strings.Contains(stdout, "http://127.0.0.1:9999") {
		t.Fatalf("stdout %q does not contain running server URL", stdout)
	}
}
