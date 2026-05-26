package embedlab

import (
	"context"
	"database/sql"
	"encoding/binary"
	"math"
	"testing"

	_ "modernc.org/sqlite"
)

func TestGraphJoinsEmbeddedSymbolsWithScoresAndReferences(t *testing.T) {
	db := newTestDB(t)
	seedEmbedLabDB(t, db)

	service := NewService(NewStore(db))
	graph, err := service.Graph(context.Background(), GraphOptions{
		RepositorySelector: "tld",
		ModelSelector:      "local-deterministic-test/vec",
		SymbolID:           1,
		Limit:              3,
		IncludeFiles:       true,
		IncludeReferences:  true,
	})
	if err != nil {
		t.Fatalf("Graph: %v", err)
	}
	if graph.Center == nil || graph.Center.ID != 1 {
		t.Fatalf("center = %+v, want symbol 1", graph.Center)
	}
	if len(graph.Neighbors) != 3 {
		t.Fatalf("neighbors = %d, want 3", len(graph.Neighbors))
	}
	if graph.Neighbors[1].ID != 3 {
		t.Fatalf("second neighbor = %d, want similar symbol 3", graph.Neighbors[1].ID)
	}
	if graph.Neighbors[1].Similarity == nil || *graph.Neighbors[1].Similarity < 0.9 {
		t.Fatalf("similarity = %+v, want high score", graph.Neighbors[1].Similarity)
	}
	if graph.Neighbors[0].Score == nil || *graph.Neighbors[0].Score != 2.5 {
		t.Fatalf("score metadata missing: %+v", graph.Neighbors[0])
	}
	if !hasEdge(graph.Edges, "reference") {
		t.Fatalf("expected reference edge, got %+v", graph.Edges)
	}
	if !hasEdge(graph.Edges, "contains") {
		t.Fatalf("expected file containment edge, got %+v", graph.Edges)
	}
}

func TestClustersSupportKMeans(t *testing.T) {
	db := newTestDB(t)
	seedEmbedLabDB(t, db)

	service := NewService(NewStore(db))
	clusters, err := service.Clusters(context.Background(), "tld", "vec", "kmeans", 2)
	if err != nil {
		t.Fatalf("Clusters: %v", err)
	}
	if clusters.Algorithm != "kmeans" {
		t.Fatalf("algorithm = %q", clusters.Algorithm)
	}
	if len(clusters.Clusters) != 2 {
		t.Fatalf("clusters = %d, want 2", len(clusters.Clusters))
	}
	for _, cluster := range clusters.Clusters {
		if cluster.Size == 0 {
			t.Fatalf("empty cluster: %+v", cluster)
		}
	}
}

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	schema := []string{
		`CREATE TABLE watch_repositories(id INTEGER PRIMARY KEY, repo_root TEXT, display_name TEXT, branch TEXT NULL, head_commit TEXT NULL, identity_status TEXT, settings_hash TEXT, created_at TEXT, updated_at TEXT)`,
		`CREATE TABLE watch_embedding_models(id INTEGER PRIMARY KEY, provider TEXT, model TEXT, dimension INTEGER, config_hash TEXT, created_at TEXT)`,
		`CREATE TABLE watch_embeddings(id INTEGER PRIMARY KEY, model_id INTEGER, owner_type TEXT, owner_key TEXT, input_hash TEXT, vector BLOB, created_at TEXT)`,
		`CREATE TABLE watch_files(id INTEGER PRIMARY KEY, repository_id INTEGER, path TEXT, language TEXT, git_blob_hash TEXT NULL, worktree_hash TEXT, size_bytes INTEGER, mtime_unix INTEGER, scan_status TEXT, scan_error TEXT NULL, created_at TEXT, updated_at TEXT)`,
		`CREATE TABLE watch_symbols(id INTEGER PRIMARY KEY, repository_id INTEGER, file_id INTEGER, stable_key TEXT, name TEXT, qualified_name TEXT, kind TEXT, start_line INTEGER, end_line INTEGER NULL, signature_hash TEXT, content_hash TEXT, raw_json TEXT, created_at TEXT, updated_at TEXT)`,
		`CREATE TABLE watch_symbol_identities(id INTEGER PRIMARY KEY, repository_id INTEGER, identity_key TEXT, current_stable_key TEXT, file_path TEXT, kind TEXT, name TEXT, qualified_name TEXT, start_line INTEGER, content_hash TEXT, created_at TEXT, updated_at TEXT)`,
		`CREATE TABLE watch_filter_decisions(id INTEGER PRIMARY KEY, filter_run_id INTEGER, owner_type TEXT, owner_id INTEGER, owner_key TEXT, decision TEXT, reason TEXT, score REAL NULL, tier INTEGER, signals_json TEXT)`,
		`CREATE TABLE watch_references(id INTEGER PRIMARY KEY, repository_id INTEGER, source_symbol_id INTEGER, target_symbol_id INTEGER, source_file_id INTEGER, kind TEXT, line INTEGER, column INTEGER, evidence_hash TEXT, raw_json TEXT, created_at TEXT, updated_at TEXT)`,
		`CREATE TABLE watch_clusters(id INTEGER PRIMARY KEY, repository_id INTEGER, stable_key TEXT, parent_cluster_id INTEGER NULL, name TEXT, kind TEXT, algorithm TEXT, settings_hash TEXT, member_count INTEGER, created_at TEXT, updated_at TEXT)`,
		`CREATE TABLE watch_cluster_members(cluster_id INTEGER, owner_type TEXT, owner_id INTEGER)`,
		`CREATE TABLE watch_materialization(id INTEGER PRIMARY KEY, repository_id INTEGER, owner_type TEXT, owner_key TEXT, resource_type TEXT, resource_id INTEGER, created_at TEXT, updated_at TEXT)`,
		`CREATE TABLE connectors(id INTEGER PRIMARY KEY, view_id INTEGER, source_element_id INTEGER, target_element_id INTEGER, label TEXT, description TEXT, relationship TEXT, style TEXT, created_at TEXT, updated_at TEXT)`,
	}
	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("schema: %v", err)
		}
	}
	return db
}

func seedEmbedLabDB(t *testing.T, db *sql.DB) {
	t.Helper()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatalf("exec %q: %v", query, err)
		}
	}
	exec(`INSERT INTO watch_repositories(id, repo_root, display_name, identity_status, settings_hash, created_at, updated_at) VALUES (1, '/repo/tld', 'tld', 'matched', '', 'now', 'now')`)
	exec(`INSERT INTO watch_embedding_models(id, provider, model, dimension, config_hash, created_at) VALUES (1, 'local-deterministic-test', 'vec', 3, 'hash', 'now')`)
	exec(`INSERT INTO watch_files(id, repository_id, path, language, worktree_hash, size_bytes, mtime_unix, scan_status, created_at, updated_at) VALUES (1, 1, 'cmd/analyze/analyze.go', 'go', 'a', 1, 1, 'parsed', 'now', 'now')`)
	exec(`INSERT INTO watch_files(id, repository_id, path, language, worktree_hash, size_bytes, mtime_unix, scan_status, created_at, updated_at) VALUES (2, 1, 'internal/watch/represent.go', 'go', 'b', 1, 1, 'parsed', 'now', 'now')`)
	exec(`INSERT INTO watch_symbols(id, repository_id, file_id, stable_key, name, qualified_name, kind, start_line, signature_hash, content_hash, raw_json, created_at, updated_at) VALUES (1, 1, 1, 'sym:analyze', 'NewAnalyzeCmd', 'cmd/analyze.NewAnalyzeCmd', 'function', 10, 'a', 'a', '{}', 'now', 'now')`)
	exec(`INSERT INTO watch_symbols(id, repository_id, file_id, stable_key, name, qualified_name, kind, start_line, signature_hash, content_hash, raw_json, created_at, updated_at) VALUES (2, 1, 2, 'sym:represent', 'Represent', 'internal/watch.Represent', 'method', 20, 'b', 'b', '{}', 'now', 'now')`)
	exec(`INSERT INTO watch_symbols(id, repository_id, file_id, stable_key, name, qualified_name, kind, start_line, signature_hash, content_hash, raw_json, created_at, updated_at) VALUES (3, 1, 2, 'sym:save-embedding', 'SaveEmbedding', 'internal/watch.SaveEmbedding', 'method', 30, 'c', 'c', '{}', 'now', 'now')`)
	exec(`INSERT INTO watch_embeddings(id, model_id, owner_type, owner_key, input_hash, vector, created_at) VALUES (1, 1, 'symbol', 'sym:analyze', 'a', ?, 'now')`, vectorBytes([]float32{1, 0, 0}))
	exec(`INSERT INTO watch_embeddings(id, model_id, owner_type, owner_key, input_hash, vector, created_at) VALUES (2, 1, 'symbol', 'sym:represent', 'b', ?, 'now')`, vectorBytes([]float32{0, 1, 0}))
	exec(`INSERT INTO watch_embeddings(id, model_id, owner_type, owner_key, input_hash, vector, created_at) VALUES (3, 1, 'symbol', 'sym:save-embedding', 'c', ?, 'now')`, vectorBytes([]float32{0.95, 0.05, 0}))
	exec(`INSERT INTO watch_filter_decisions(id, filter_run_id, owner_type, owner_id, owner_key, decision, reason, score, tier, signals_json) VALUES (1, 1, 'symbol', 1, 'sym:analyze', 'visible', 'entrypoint', 2.5, 0, '[]')`)
	exec(`INSERT INTO watch_references(id, repository_id, source_symbol_id, target_symbol_id, source_file_id, kind, line, column, evidence_hash, raw_json, created_at, updated_at) VALUES (1, 1, 1, 3, 1, 'calls', 12, 4, 'r', '{}', 'now', 'now')`)
}

func vectorBytes(values []float32) []byte {
	out := make([]byte, len(values)*4)
	for i, value := range values {
		binary.LittleEndian.PutUint32(out[i*4:(i+1)*4], math.Float32bits(value))
	}
	return out
}

func hasEdge(edges []GraphEdge, kind string) bool {
	for _, edge := range edges {
		if edge.Type == kind {
			return true
		}
	}
	return false
}

func TestGraphJoinsTLDConnectors(t *testing.T) {
	db := newTestDB(t)
	seedEmbedLabDB(t, db)

	// Insert watch_materialization for symbol 1 (sym:analyze) -> element 101
	// and symbol 3 (sym:save-embedding) -> element 103
	_, err := db.Exec(`
		INSERT INTO watch_materialization(repository_id, owner_type, owner_key, resource_type, resource_id, created_at, updated_at)
		VALUES (1, 'symbol', 'sym:analyze', 'element', 101, 'now', 'now')`)
	if err != nil {
		t.Fatalf("insert symbol 1 mapping: %v", err)
	}
	_, err = db.Exec(`
		INSERT INTO watch_materialization(repository_id, owner_type, owner_key, resource_type, resource_id, created_at, updated_at)
		VALUES (1, 'symbol', 'sym:save-embedding', 'element', 103, 'now', 'now')`)
	if err != nil {
		t.Fatalf("insert symbol 3 mapping: %v", err)
	}

	// Insert a connector between element 101 and element 103
	_, err = db.Exec(`
		INSERT INTO connectors(id, view_id, source_element_id, target_element_id, label, description, relationship, style, created_at, updated_at)
		VALUES (42, 1, 101, 103, 'calls-db', 'desc', 'calls', 'bezier', 'now', 'now')`)
	if err != nil {
		t.Fatalf("insert connector: %v", err)
	}

	service := NewService(NewStore(db))
	graph, err := service.Graph(context.Background(), GraphOptions{
		RepositorySelector: "tld",
		ModelSelector:      "local-deterministic-test/vec",
		SymbolID:           1,
		Limit:              3,
		IncludeFiles:       true,
		IncludeReferences:  false,
	})
	if err != nil {
		t.Fatalf("Graph: %v", err)
	}

	// Verify the edge is found
	found := false
	for _, edge := range graph.Edges {
		if edge.Type == "tld-connector" {
			if edge.ID != "tld:42" {
				t.Errorf("edge ID = %q, want tld:42", edge.ID)
			}
			if edge.Source != "symbol:1" {
				t.Errorf("edge Source = %q, want symbol:1", edge.Source)
			}
			if edge.Target != "symbol:3" {
				t.Errorf("edge Target = %q, want symbol:3", edge.Target)
			}
			if edge.Label != "calls-db" {
				t.Errorf("edge Label = %q, want calls-db", edge.Label)
			}
			found = true
		}
	}
	if !found {
		t.Fatalf("expected tld-connector edge in %v", graph.Edges)
	}
}
