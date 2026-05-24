package dbrepo_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	assets "github.com/mertcikla/tld/v2"
	"github.com/mertcikla/tld/v2/pkg/dbrepo"
)

func TestOpenSQLiteAppliesLocalMigrations(t *testing.T) {
	ctx := context.Background()
	handle, err := dbrepo.OpenSQLite(ctx, dbrepo.DBOptions{
		SQLitePath: filepath.Join(t.TempDir(), "tld.db"),
		Migrations: assets.FS,
	})
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer func() { _ = handle.Close() }()

	if handle.Dialect != dbrepo.DialectSQLite {
		t.Fatalf("Dialect = %q, want %q", handle.Dialect, dbrepo.DialectSQLite)
	}
	var count int
	if err := handle.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM tags`).Scan(&count); err != nil {
		t.Fatalf("query migrated table: %v", err)
	}
}

func TestOpenPostgresAppliesLocalMigrationsWhenConfigured(t *testing.T) {
	dsn := os.Getenv("TLD_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("TLD_TEST_POSTGRES_URL not set")
	}
	ctx := context.Background()
	handle, err := dbrepo.OpenPostgres(ctx, dbrepo.DBOptions{
		DatabaseURL: dsn,
		Migrations:  assets.FS,
	})
	if err != nil {
		t.Fatalf("OpenPostgres: %v", err)
	}
	defer func() { _ = handle.Close() }()

	if handle.Dialect != dbrepo.DialectPostgres {
		t.Fatalf("Dialect = %q, want %q", handle.Dialect, dbrepo.DialectPostgres)
	}
	var count int
	if err := handle.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM watch_embedding_models`).Scan(&count); err != nil {
		t.Fatalf("query migrated table: %v", err)
	}
}
