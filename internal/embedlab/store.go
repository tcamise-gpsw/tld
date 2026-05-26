package embedlab

import (
	"context"
	"database/sql"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/mertcikla/tld/v2/internal/watch"
)

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) Repositories(ctx context.Context) ([]Repository, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, repo_root, display_name, branch, head_commit, updated_at
		FROM watch_repositories
		ORDER BY updated_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	repos := []Repository{}
	for rows.Next() {
		repo, err := scanRepository(rows)
		if err != nil {
			return nil, err
		}
		repos = append(repos, repo)
	}
	return repos, rows.Err()
}

func (s *Store) Repository(ctx context.Context, selector string) (Repository, error) {
	repos, err := s.Repositories(ctx)
	if err != nil {
		return Repository{}, err
	}
	if len(repos) == 0 {
		return Repository{}, errors.New("no watch repositories found in database")
	}
	selector = strings.TrimSpace(selector)
	if selector == "" {
		return repos[0], nil
	}
	for _, repo := range repos {
		if fmt.Sprintf("%d", repo.ID) == selector || repo.DisplayName == selector || strings.HasSuffix(repo.RepoRoot, selector) {
			return repo, nil
		}
	}
	return Repository{}, fmt.Errorf("repository %q not found", selector)
}

func scanRepository(row interface{ Scan(dest ...any) error }) (Repository, error) {
	var repo Repository
	var branch, head sql.NullString
	if err := row.Scan(&repo.ID, &repo.RepoRoot, &repo.DisplayName, &branch, &head, &repo.UpdatedAt); err != nil {
		return Repository{}, err
	}
	if branch.Valid {
		repo.Branch = branch.String
	}
	if head.Valid {
		repo.HeadCommit = head.String
	}
	return repo, nil
}

func (s *Store) Models(ctx context.Context) ([]Model, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT wm.id, wm.provider, wm.model, wm.dimension, wm.config_hash, wm.created_at,
		       (SELECT COUNT(*) FROM watch_embeddings we WHERE we.model_id = wm.id)
		FROM watch_embedding_models wm
		ORDER BY wm.created_at DESC, wm.id DESC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	models := []Model{}
	for rows.Next() {
		model, err := scanModel(rows)
		if err != nil {
			return nil, err
		}
		models = append(models, model)
	}
	return models, rows.Err()
}

func (s *Store) Model(ctx context.Context, selector string) (Model, error) {
	models, err := s.Models(ctx)
	if err != nil {
		return Model{}, err
	}
	if len(models) == 0 {
		return Model{}, errors.New("no embedding models found in database")
	}
	selector = strings.TrimSpace(selector)
	if selector == "" {
		return models[0], nil
	}
	for _, model := range models {
		if fmt.Sprintf("%d", model.ID) == selector || model.Name == selector || model.Provider+"/"+model.Name == selector {
			return model, nil
		}
	}
	return Model{}, fmt.Errorf("embedding model %q not found", selector)
}

func scanModel(row interface{ Scan(dest ...any) error }) (Model, error) {
	var model Model
	if err := row.Scan(&model.ID, &model.Provider, &model.Name, &model.Dimension, &model.ConfigHash, &model.CreatedAt, &model.EmbeddingCount); err != nil {
		return Model{}, err
	}
	return model, nil
}

func (s *Store) SearchSymbols(ctx context.Context, repoID, modelID int64, query string, limit int) ([]Symbol, error) {
	if limit <= 0 {
		limit = 25
	}
	like := "%" + strings.TrimSpace(query) + "%"
	rows, err := s.db.QueryContext(ctx, `
		SELECT e.id, e.owner_key, s.id, s.repository_id, s.file_id, f.path, s.stable_key, s.name, s.qualified_name, s.kind, s.start_line, s.end_line,
		       fd.decision, fd.reason, fd.score, COALESCE(fd.tier, 0)
		FROM watch_symbols s
		JOIN watch_files f ON f.id = s.file_id
		LEFT JOIN watch_symbol_identities i ON i.repository_id = s.repository_id AND i.current_stable_key = s.stable_key
		LEFT JOIN watch_embeddings e ON e.model_id = ? AND e.owner_type = 'symbol' AND e.owner_key = COALESCE(i.identity_key, s.stable_key)
		LEFT JOIN watch_filter_decisions fd ON fd.id = (
			SELECT MAX(fd2.id)
			FROM watch_filter_decisions fd2
			WHERE fd2.owner_type = 'symbol' AND fd2.owner_key = COALESCE(i.identity_key, s.stable_key)
		)
		WHERE s.repository_id = ? AND (? = '%%' OR s.name LIKE ? OR s.qualified_name LIKE ? OR f.path LIKE ?)
		ORDER BY CASE WHEN e.id IS NULL THEN 1 ELSE 0 END, f.path, s.start_line, s.name
		LIMIT ?`, modelID, repoID, like, like, like, like, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanSymbols(rows)
}

type embeddedSymbol struct {
	Symbol
	Vector watch.Vector
}

func (s *Store) EmbeddedSymbols(ctx context.Context, repoID, modelID int64) ([]embeddedSymbol, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT e.id, e.owner_key, e.vector, s.id, s.repository_id, s.file_id, f.path, s.stable_key, s.name, s.qualified_name, s.kind, s.start_line, s.end_line,
		       fd.decision, fd.reason, fd.score, COALESCE(fd.tier, 0)
		FROM watch_symbols s
		JOIN watch_files f ON f.id = s.file_id
		LEFT JOIN watch_symbol_identities i ON i.repository_id = s.repository_id AND i.current_stable_key = s.stable_key
		CROSS JOIN watch_embeddings e ON e.model_id = ? AND e.owner_type = 'symbol' AND e.owner_key = COALESCE(i.identity_key, s.stable_key)
		LEFT JOIN watch_filter_decisions fd ON fd.id = (
			SELECT MAX(fd2.id)
			FROM watch_filter_decisions fd2
			WHERE fd2.owner_type = 'symbol' AND fd2.owner_key = e.owner_key
		)
		WHERE s.repository_id = ?
		ORDER BY f.path, s.start_line, s.name`, modelID, repoID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []embeddedSymbol{}
	for rows.Next() {
		item, err := scanEmbeddedSymbol(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) EmbeddingForSymbol(ctx context.Context, repoID, modelID, symbolID int64) (embeddedSymbol, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT e.id, e.owner_key, e.vector, s.id, s.repository_id, s.file_id, f.path, s.stable_key, s.name, s.qualified_name, s.kind, s.start_line, s.end_line,
		       fd.decision, fd.reason, fd.score, COALESCE(fd.tier, 0)
		FROM watch_symbols s
		JOIN watch_files f ON f.id = s.file_id
		LEFT JOIN watch_symbol_identities i ON i.repository_id = s.repository_id AND i.current_stable_key = s.stable_key
		JOIN watch_embeddings e ON e.model_id = ? AND e.owner_type = 'symbol' AND e.owner_key = COALESCE(i.identity_key, s.stable_key)
		LEFT JOIN watch_filter_decisions fd ON fd.id = (
			SELECT MAX(fd2.id)
			FROM watch_filter_decisions fd2
			WHERE fd2.owner_type = 'symbol' AND fd2.owner_key = e.owner_key
		)
		WHERE s.repository_id = ? AND s.id = ?`, modelID, repoID, symbolID)
	if err != nil {
		return embeddedSymbol{}, err
	}
	defer func() { _ = rows.Close() }()
	if !rows.Next() {
		return embeddedSymbol{}, fmt.Errorf("symbol %d has no embedding for model %d", symbolID, modelID)
	}
	item, err := scanEmbeddedSymbol(rows)
	if err != nil {
		return embeddedSymbol{}, err
	}
	return item, rows.Err()
}

func scanEmbeddedSymbol(row interface{ Scan(dest ...any) error }) (embeddedSymbol, error) {
	var item embeddedSymbol
	var endLine sql.NullInt64
	var decision, reason sql.NullString
	var score sql.NullFloat64
	var vector []byte
	if err := row.Scan(
		&item.EmbeddingID,
		&item.OwnerKey,
		&vector,
		&item.ID,
		&item.RepositoryID,
		&item.FileID,
		&item.FilePath,
		&item.StableKey,
		&item.Name,
		&item.QualifiedName,
		&item.Kind,
		&item.StartLine,
		&endLine,
		&decision,
		&reason,
		&score,
		&item.Tier,
	); err != nil {
		return embeddedSymbol{}, err
	}
	if endLine.Valid {
		end := int(endLine.Int64)
		item.EndLine = &end
	}
	if decision.Valid {
		item.Decision = decision.String
	}
	if reason.Valid {
		item.Reason = reason.String
	}
	if score.Valid {
		item.Score = &score.Float64
	}
	item.Vector = bytesToVector(vector)
	return item, nil
}

func scanSymbols(rows *sql.Rows) ([]Symbol, error) {
	out := []Symbol{}
	for rows.Next() {
		var item Symbol
		var embeddingID sql.NullInt64
		var ownerKey sql.NullString
		var endLine sql.NullInt64
		var decision, reason sql.NullString
		var score sql.NullFloat64
		if err := rows.Scan(
			&embeddingID,
			&ownerKey,
			&item.ID,
			&item.RepositoryID,
			&item.FileID,
			&item.FilePath,
			&item.StableKey,
			&item.Name,
			&item.QualifiedName,
			&item.Kind,
			&item.StartLine,
			&endLine,
			&decision,
			&reason,
			&score,
			&item.Tier,
		); err != nil {
			return nil, err
		}
		if embeddingID.Valid {
			item.EmbeddingID = embeddingID.Int64
		}
		if ownerKey.Valid {
			item.OwnerKey = ownerKey.String
		}
		if endLine.Valid {
			end := int(endLine.Int64)
			item.EndLine = &end
		}
		if decision.Valid {
			item.Decision = decision.String
		}
		if reason.Valid {
			item.Reason = reason.String
		}
		if score.Valid {
			item.Score = &score.Float64
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) ReferencesBetween(ctx context.Context, repoID int64, symbolIDs []int64) ([]GraphEdge, error) {
	if len(symbolIDs) == 0 {
		return []GraphEdge{}, nil
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(symbolIDs)), ",")
	args := []any{repoID}
	for _, id := range symbolIDs {
		args = append(args, id)
	}
	for _, id := range symbolIDs {
		args = append(args, id)
	}
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT id, source_symbol_id, target_symbol_id, kind
		FROM watch_references
		WHERE repository_id = ? AND source_symbol_id IN (%s) AND target_symbol_id IN (%s)
		ORDER BY id`, placeholders, placeholders), args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	edges := []GraphEdge{}
	for rows.Next() {
		var id, source, target int64
		var kind string
		if err := rows.Scan(&id, &source, &target, &kind); err != nil {
			return nil, err
		}
		edges = append(edges, GraphEdge{
			ID:     fmt.Sprintf("ref:%d", id),
			Source: nodeID("symbol", source),
			Target: nodeID("symbol", target),
			Type:   "reference",
			Label:  kind,
		})
	}
	return edges, rows.Err()
}

func (s *Store) TLDConnectorsBetween(ctx context.Context, repoID int64, symbolIDs []int64, fileIDs []int64, clusterIDs []int64) ([]GraphEdge, error) {
	elementIDToNodeID := make(map[int64]string)
	var elementIDs []int64

	// Helper to perform the mapping query
	queryMapping := func(queryTmpl string, ids []int64, prefix string) error {
		if len(ids) == 0 {
			return nil
		}
		placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
		query := fmt.Sprintf(queryTmpl, placeholders)
		args := make([]any, 0, len(ids)+1)
		args = append(args, repoID)
		for _, id := range ids {
			args = append(args, id)
		}
		rows, err := s.db.QueryContext(ctx, query, args...)
		if err != nil {
			return err
		}
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			var sourceID, elementID int64
			if err := rows.Scan(&sourceID, &elementID); err != nil {
				return err
			}
			nodeID := fmt.Sprintf("%s:%d", prefix, sourceID)
			elementIDToNodeID[elementID] = nodeID
			elementIDs = append(elementIDs, elementID)
		}
		return rows.Err()
	}

	// 1. Map symbols
	symbolTmpl := `
		SELECT s.id, wm.resource_id
		FROM watch_symbols s
		LEFT JOIN watch_symbol_identities i ON i.repository_id = s.repository_id AND i.current_stable_key = s.stable_key
		CROSS JOIN watch_materialization wm ON wm.repository_id = s.repository_id AND wm.owner_type = 'symbol' AND wm.resource_type = 'element' AND wm.owner_key = COALESCE(i.identity_key, s.stable_key)
		WHERE s.repository_id = ?
		  AND s.id IN (%s)`
	if err := queryMapping(symbolTmpl, symbolIDs, "symbol"); err != nil {
		return nil, err
	}

	// 2. Map files
	fileTmpl := `
		SELECT f.id, wm.resource_id
		FROM watch_files f
		JOIN watch_materialization wm ON wm.repository_id = f.repository_id AND wm.owner_type = 'file' AND wm.resource_type = 'element'
		WHERE f.repository_id = ?
		  AND wm.owner_key = 'file:' || f.path
		  AND f.id IN (%s)`
	if err := queryMapping(fileTmpl, fileIDs, "file"); err != nil {
		return nil, err
	}

	// 3. Map clusters
	clusterTmpl := `
		SELECT c.id, wm.resource_id
		FROM watch_clusters c
		JOIN watch_materialization wm ON wm.repository_id = c.repository_id AND wm.owner_type = 'cluster' AND wm.resource_type = 'element'
		WHERE c.repository_id = ?
		  AND wm.owner_key = c.stable_key
		  AND c.id IN (%s)`
	if err := queryMapping(clusterTmpl, clusterIDs, "cluster"); err != nil {
		return nil, err
	}

	if len(elementIDs) == 0 {
		return nil, nil
	}

	// Now fetch connectors between these elements
	placeholders := strings.TrimRight(strings.Repeat("?,", len(elementIDs)), ",")
	args := make([]any, 0, len(elementIDs)*2)
	for _, id := range elementIDs {
		args = append(args, id)
	}
	for _, id := range elementIDs {
		args = append(args, id)
	}

	query := fmt.Sprintf(`
		SELECT id, source_element_id, target_element_id, label, description, relationship, style
		FROM connectors
		WHERE source_element_id IN (%s) AND target_element_id IN (%s)
		ORDER BY id`, placeholders, placeholders)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var edges []GraphEdge
	seen := make(map[string]struct{}) // Deduplicate connectors between the same nodes with same details
	for rows.Next() {
		var id, sourceElementID, targetElementID int64
		var labelOpt, descOpt, relOpt, styleOpt sql.NullString
		if err := rows.Scan(&id, &sourceElementID, &targetElementID, &labelOpt, &descOpt, &relOpt, &styleOpt); err != nil {
			return nil, err
		}

		sourceNodeID := elementIDToNodeID[sourceElementID]
		targetNodeID := elementIDToNodeID[targetElementID]
		if sourceNodeID == "" || targetNodeID == "" {
			continue
		}

		label := ""
		if labelOpt.Valid {
			label = labelOpt.String
		}
		relationship := ""
		if relOpt.Valid {
			relationship = relOpt.String
		}
		description := ""
		if descOpt.Valid {
			description = descOpt.String
		}
		style := "bezier"
		if styleOpt.Valid {
			style = styleOpt.String
		}

		// Deduplicate based on source, target, relationship, and label
		key := fmt.Sprintf("%s->%s:%s:%s", sourceNodeID, targetNodeID, relationship, label)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}

		edges = append(edges, GraphEdge{
			ID:     fmt.Sprintf("tld:%d", id),
			Source: sourceNodeID,
			Target: targetNodeID,
			Type:   "tld-connector",
			Label:  label,
			Data: map[string]any{
				"relationship": relationship,
				"description":  description,
				"style":        style,
			},
		})
	}
	return edges, rows.Err()
}

func (s *Store) PersistedClusters(ctx context.Context, repoID int64, symbolIDs []int64) ([]GraphNode, []GraphEdge, error) {
	if len(symbolIDs) == 0 {
		return []GraphNode{}, []GraphEdge{}, nil
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(symbolIDs)), ",")
	args := []any{repoID}
	for _, id := range symbolIDs {
		args = append(args, id)
	}
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT c.id, c.name, c.kind, c.algorithm, cm.owner_id
		FROM watch_clusters c
		JOIN watch_cluster_members cm ON cm.cluster_id = c.id
		WHERE c.repository_id = ? AND cm.owner_type = 'symbol' AND cm.owner_id IN (%s)
		ORDER BY c.id, cm.owner_id`, placeholders), args...)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = rows.Close() }()
	nodeByID := map[int64]GraphNode{}
	edges := []GraphEdge{}
	for rows.Next() {
		var id, symbolID int64
		var name, kind, algorithm string
		if err := rows.Scan(&id, &name, &kind, &algorithm, &symbolID); err != nil {
			return nil, nil, err
		}
		nodeByID[id] = GraphNode{
			ID:       nodeID("cluster", id),
			Type:     "cluster",
			Label:    name,
			Subtitle: algorithm,
			Data: map[string]any{
				"kind": kind,
			},
		}
		edges = append(edges, GraphEdge{
			ID:     fmt.Sprintf("cluster:%d:%d", id, symbolID),
			Source: nodeID("cluster", id),
			Target: nodeID("symbol", symbolID),
			Type:   "cluster-member",
		})
	}
	nodes := make([]GraphNode, 0, len(nodeByID))
	for _, node := range nodeByID {
		nodes = append(nodes, node)
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	return nodes, edges, rows.Err()
}

func (s *Store) Stats(ctx context.Context, repoID, modelID int64) (Stats, error) {
	stats := Stats{
		RepositoryID:      repoID,
		ModelID:           modelID,
		DecisionCounts:    map[string]int{},
		ScoreDistribution: map[string]int{},
	}
	counts := []struct {
		query string
		dest  *int
	}{
		{`SELECT COUNT(*) FROM watch_files WHERE repository_id = ?`, &stats.FileCount},
		{`SELECT COUNT(*) FROM watch_symbols WHERE repository_id = ?`, &stats.SymbolCount},
		{`SELECT COUNT(*) FROM watch_references WHERE repository_id = ?`, &stats.ReferenceCount},
	}
	for _, item := range counts {
		if err := s.db.QueryRowContext(ctx, item.query, repoID).Scan(item.dest); err != nil {
			return Stats{}, err
		}
	}
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM watch_symbols s
		LEFT JOIN watch_symbol_identities i ON i.repository_id = s.repository_id AND i.current_stable_key = s.stable_key
		CROSS JOIN watch_embeddings e ON e.model_id = ? AND e.owner_type = 'symbol' AND e.owner_key = COALESCE(i.identity_key, s.stable_key)
		WHERE s.repository_id = ?`, modelID, repoID).Scan(&stats.EmbeddedCount); err != nil {
		return Stats{}, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT decision, COUNT(*)
		FROM watch_filter_decisions
		WHERE owner_type = 'symbol'
		GROUP BY decision`)
	if err != nil {
		return Stats{}, err
	}
	for rows.Next() {
		var decision string
		var count int
		if err := rows.Scan(&decision, &count); err != nil {
			_ = rows.Close()
			return Stats{}, err
		}
		stats.DecisionCounts[decision] = count
		if decision == "visible" {
			stats.VisibleCount = count
		}
		if decision == "hidden" {
			stats.HiddenCount = count
		}
	}
	if err := rows.Close(); err != nil {
		return Stats{}, err
	}
	stats.TopFiles, err = s.statItems(ctx, `
		SELECT f.path, COUNT(s.id)
		FROM watch_symbols s
		JOIN watch_files f ON f.id = s.file_id
		WHERE s.repository_id = ?
		GROUP BY f.path
		ORDER BY COUNT(s.id) DESC, f.path
		LIMIT 10`, repoID)
	if err != nil {
		return Stats{}, err
	}
	stats.TopKinds, err = s.statItems(ctx, `
		SELECT kind, COUNT(*)
		FROM watch_symbols
		WHERE repository_id = ?
		GROUP BY kind
		ORDER BY COUNT(*) DESC, kind
		LIMIT 10`, repoID)
	if err != nil {
		return Stats{}, err
	}
	stats.ClusterSizes, err = s.statItems(ctx, `
		SELECT name, member_count
		FROM watch_clusters
		WHERE repository_id = ?
		ORDER BY member_count DESC, name
		LIMIT 10`, repoID)
	return stats, err
}

func (s *Store) statItems(ctx context.Context, query string, args ...any) ([]StatItem, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := []StatItem{}
	for rows.Next() {
		var item StatItem
		if err := rows.Scan(&item.Label, &item.Count); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func bytesToVector(data []byte) watch.Vector {
	if len(data)%4 != 0 {
		return nil
	}
	vector := make(watch.Vector, len(data)/4)
	for i := range vector {
		vector[i] = math.Float32frombits(binary.LittleEndian.Uint32(data[i*4:]))
	}
	return vector
}

func nodeID(kind string, id int64) string {
	return fmt.Sprintf("%s:%d", kind, id)
}
