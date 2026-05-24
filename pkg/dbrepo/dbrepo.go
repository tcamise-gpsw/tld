// Package dbrepo contains shared database opening primitives for tld stores.
package dbrepo

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
	sqlitevec "github.com/viant/sqlite-vec/vec"
	_ "modernc.org/sqlite"
)

type Dialect string

const (
	DialectSQLite   Dialect = "sqlite"
	DialectPostgres Dialect = "postgres"
)

type SchemaProfile string

const (
	SchemaLocal SchemaProfile = "local"
	SchemaCloud SchemaProfile = "cloud"
)

type DBOptions struct {
	Dialect       Dialect
	SQLitePath    string
	DatabaseURL   string
	SchemaProfile SchemaProfile
	Migrations    embed.FS
}

type Handle struct {
	DB            *sql.DB
	Bun           *bun.DB
	Dialect       Dialect
	SchemaProfile SchemaProfile
}

func (h *Handle) Close() error {
	if h == nil || h.DB == nil {
		return nil
	}
	return h.DB.Close()
}

func Open(ctx context.Context, opts DBOptions) (*Handle, error) {
	if opts.Dialect == "" {
		opts.Dialect = DialectSQLite
	}
	if opts.SchemaProfile == "" {
		opts.SchemaProfile = SchemaLocal
	}
	switch opts.Dialect {
	case DialectSQLite:
		return OpenSQLite(ctx, opts)
	case DialectPostgres:
		return OpenPostgres(ctx, opts)
	default:
		return nil, fmt.Errorf("unsupported db dialect %q", opts.Dialect)
	}
}

func OpenSQLite(ctx context.Context, opts DBOptions) (*Handle, error) {
	if opts.SQLitePath == "" {
		return nil, fmt.Errorf("sqlite path is required")
	}
	db, err := sql.Open("sqlite", opts.SQLitePath)
	if err != nil {
		return nil, err
	}
	if err := sqlitevec.Register(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("register sqlite-vec: %w", err)
	}
	configureSQLitePool(db)
	if err := configureSQLite(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := ApplyEmbeddedMigrations(ctx, db, opts.Migrations, "migrations"); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Handle{DB: db, Bun: bun.NewDB(db, sqlitedialect.New()), Dialect: DialectSQLite, SchemaProfile: opts.SchemaProfile}, nil
}

func OpenPostgres(ctx context.Context, opts DBOptions) (*Handle, error) {
	if opts.DatabaseURL == "" {
		return nil, fmt.Errorf("postgres database url is required")
	}
	db := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(opts.DatabaseURL)))
	configurePostgresPool(db)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	if err := ApplyEmbeddedMigrations(ctx, db, opts.Migrations, "migrations/postgres"); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Handle{DB: db, Bun: bun.NewDB(db, pgdialect.New()), Dialect: DialectPostgres, SchemaProfile: opts.SchemaProfile}, nil
}

func ApplyEmbeddedMigrations(ctx context.Context, db *sql.DB, migrations embed.FS, dir string) error {
	entries, err := fs.ReadDir(migrations, dir)
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		path := dir + "/" + entry.Name()
		sqlBytes, err := migrations.ReadFile(path)
		if err != nil {
			return err
		}
		if _, err := db.ExecContext(ctx, string(sqlBytes)); err != nil {
			if strings.Contains(err.Error(), "duplicate column name") {
				continue
			}
			return fmt.Errorf("apply migration %s: %w", entry.Name(), err)
		}
	}
	return nil
}

func configureSQLitePool(db *sql.DB) {
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
}

func configureSQLite(ctx context.Context, db *sql.DB) error {
	pragmas := []string{
		`PRAGMA busy_timeout = 5000;`,
		`PRAGMA journal_mode = WAL;`,
		`PRAGMA synchronous = NORMAL;`,
		`PRAGMA foreign_keys = ON;`,
	}
	for _, pragma := range pragmas {
		if _, err := db.ExecContext(ctx, pragma); err != nil {
			return fmt.Errorf("configure sqlite %s: %w", pragma, err)
		}
	}
	return nil
}

func configurePostgresPool(db *sql.DB) {
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetConnMaxIdleTime(5 * time.Minute)
}
