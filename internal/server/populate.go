package server

import (
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/mertcikla/tld/v2/internal/store"
	"github.com/mertcikla/tld/v2/internal/watch"
	"github.com/mertcikla/tld/v2/internal/workspace"
)

type populateElementResult struct {
	ID                   int64           `json:"id"`
	Name                 string          `json:"name"`
	Kind                 *string         `json:"kind"`
	Description          *string         `json:"description"`
	Technology           *string         `json:"technology"`
	URL                  *string         `json:"url"`
	LogoURL              *string         `json:"logo_url"`
	TechnologyConnectors json.RawMessage `json:"technology_connectors"`
	Tags                 json.RawMessage `json:"tags"`
	Repo                 *string         `json:"repo,omitempty"`
	Branch               *string         `json:"branch,omitempty"`
	FilePath             *string         `json:"file_path,omitempty"`
	Language             *string         `json:"language,omitempty"`
	CreatedAt            string          `json:"created_at"`
	UpdatedAt            string          `json:"updated_at"`
	SimilarityScore      float64         `json:"similarity_score"`
	MatchKind            string          `json:"match_kind,omitempty"`
	MatchReason          string          `json:"match_reason,omitempty"`
}

func registerPopulateHandlers(mux *http.ServeMux, sqliteStore *store.SQLiteStore) {
	mux.HandleFunc("GET /api/views/{id}/populate-query", func(w http.ResponseWriter, r *http.Request) {
		viewID, ok := parseViewID(w, r)
		if !ok {
			return
		}
		query, err := buildPopulateQuery(r.Context(), sqliteStore.DB(), viewID, "")
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSONError(w, http.StatusNotFound, "view not found")
			} else {
				writeJSONError(w, http.StatusBadRequest, err.Error())
			}
			return
		}
		writeJSON(w, map[string]string{"query": query.Base, "enriched_query": query.Enriched})
	})

	mux.HandleFunc("GET /api/views/{id}/populate", func(w http.ResponseWriter, r *http.Request) {
		viewID, ok := parseViewID(w, r)
		if !ok {
			return
		}

		q := r.URL.Query().Get("q")
		if strings.TrimSpace(q) == "" {
			writeJSON(w, map[string]any{"results": []any{}})
			return
		}

		limitVal := r.URL.Query().Get("limit")
		limit := 5
		if limitVal != "" {
			if parsed, err := strconv.Atoi(limitVal); err == nil && parsed > 0 {
				limit = parsed
			}
		}
		if limit > 50 {
			limit = 50
		}

		popQuery, err := buildPopulateQuery(r.Context(), sqliteStore.DB(), viewID, q)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}

		// 1. Get default repository. Populate should still produce lexical
		// candidates if no embedding model has been registered yet.
		var repoID int64
		err = sqliteStore.DB().QueryRowContext(r.Context(), "SELECT id FROM watch_repositories ORDER BY updated_at DESC, id DESC LIMIT 1").Scan(&repoID)
		if err != nil {
			writeJSON(w, map[string]any{"results": []any{}})
			return
		}

		var modelID int64
		var modelProvider, modelName, modelConfigHash string
		var modelDimension int
		hasModel := true
		err = sqliteStore.DB().QueryRowContext(r.Context(), "SELECT id, provider, model, dimension, config_hash FROM watch_embedding_models WHERE provider <> 'none' ORDER BY created_at DESC, id DESC LIMIT 1").Scan(
			&modelID, &modelProvider, &modelName, &modelDimension, &modelConfigHash,
		)
		if errors.Is(err, sql.ErrNoRows) {
			hasModel = false
		} else if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "failed to load embedding model: "+err.Error())
			return
		}

		// Load placed elements in target view
		var placedIDs []int64
		rowsP, err := sqliteStore.DB().QueryContext(r.Context(), `SELECT element_id FROM placements WHERE view_id = ?`, viewID)
		if err == nil {
			defer func() { _ = rowsP.Close() }()
			for rowsP.Next() {
				var pid int64
				if err := rowsP.Scan(&pid); err == nil {
					placedIDs = append(placedIDs, pid)
				}
			}
		}

		connectedIDs := make(map[int64]bool)
		if len(placedIDs) > 0 {
			idsStr := formatIDs(placedIDs)
			// Query connectors
			rowsConn, err := sqliteStore.DB().QueryContext(r.Context(), fmt.Sprintf(`
				SELECT DISTINCT target_element_id FROM connectors WHERE source_element_id IN (%s)
				UNION
				SELECT DISTINCT source_element_id FROM connectors WHERE target_element_id IN (%s)`, idsStr, idsStr))
			if err == nil {
				defer func() { _ = rowsConn.Close() }()
				for rowsConn.Next() {
					var id int64
					if err := rowsConn.Scan(&id); err == nil {
						connectedIDs[id] = true
					}
				}
			}

			// Query watch_references
			rowsRefs, err := sqliteStore.DB().QueryContext(r.Context(), fmt.Sprintf(`
				SELECT DISTINCT c_mat.resource_id
				FROM watch_references r
				JOIN watch_symbols c_sym ON (c_sym.id = r.source_symbol_id OR c_sym.id = r.target_symbol_id)
				JOIN watch_materialization c_mat ON c_mat.owner_type = 'symbol' AND c_mat.owner_key = c_sym.stable_key
				JOIN watch_symbols p_sym ON (p_sym.id = r.source_symbol_id OR p_sym.id = r.target_symbol_id)
				JOIN watch_materialization p_mat ON p_mat.owner_type = 'symbol' AND p_mat.owner_key = p_sym.stable_key
				WHERE c_mat.resource_type = 'element'
				  AND p_mat.resource_type = 'element'
				  AND p_mat.resource_id IN (%s)
				  AND r.repository_id = ?`, idsStr), repoID)
			if err == nil {
				defer func() { _ = rowsRefs.Close() }()
				for rowsRefs.Next() {
					var id int64
					if err := rowsRefs.Scan(&id); err == nil {
						connectedIDs[id] = true
					}
				}
			}
		}

		queryVector := watch.Vector(nil)
		enrichedVector := watch.Vector(nil)
		if hasModel {
			cfg, err := workspace.LoadGlobalConfig()
			if err != nil {
				cfg = workspace.DefaultConfig()
			}
			embCfg := watch.EmbeddingConfig{
				Provider:        modelProvider,
				Endpoint:        cfg.Watch.Embedding.Endpoint.String(),
				Model:           modelName,
				Dimension:       modelDimension,
				RuntimePath:     cfg.Watch.Embedding.RuntimePath,
				HealthThreshold: cfg.Watch.Embedding.HealthThreshold,
			}
			provider, err := watch.NewEmbeddingProvider(embCfg)
			if err != nil {
				writeJSONError(w, http.StatusInternalServerError, "failed to initialize embedding provider: "+err.Error())
				return
			}
			if closer, ok := provider.(watch.ClosableProvider); ok {
				defer func() { _ = closer.Close() }()
			}
			embedInputs := []watch.EmbeddingInput{
				{OwnerType: "query", Text: popQuery.Compact},
			}
			if popQuery.Compact != popQuery.Enriched {
				embedInputs = append(embedInputs, watch.EmbeddingInput{OwnerType: "query", Text: popQuery.Enriched})
			}
			vectors, err := provider.Embed(r.Context(), embedInputs)
			if err != nil {
				writeJSONError(w, http.StatusInternalServerError, "failed to embed query: "+err.Error())
				return
			}
			if len(vectors) >= 1 {
				queryVector = vectors[0]
			}
			if len(vectors) >= 2 {
				enrichedVector = vectors[1]
			} else {
				enrichedVector = queryVector
			}
		}

		candidates, err := loadPopulateCandidates(r.Context(), sqliteStore.DB(), repoID, viewID, modelID, queryVector, false)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "failed to load populate candidates: "+err.Error())
			return
		}
		scoredCandidates := scorePopulateCandidates(popQuery, candidates, connectedIDs)
		scoredCandidates = filterPopulateCandidates(scoredCandidates, false)
		if len(scoredCandidates) == 0 {
			fallback, err := loadPopulateCandidates(r.Context(), sqliteStore.DB(), repoID, viewID, modelID, queryVector, true)
			if err != nil {
				writeJSONError(w, http.StatusInternalServerError, "failed to load fallback populate candidates: "+err.Error())
				return
			}
			scoredCandidates = filterPopulateCandidates(scorePopulateCandidates(popQuery, fallback, connectedIDs), true)
		}

		sort.Slice(scoredCandidates, func(i, j int) bool {
			if scoredCandidates[i].finalScore == scoredCandidates[j].finalScore {
				return scoredCandidates[i].element.ID < scoredCandidates[j].element.ID
			}
			return scoredCandidates[i].finalScore > scoredCandidates[j].finalScore
		})

		reRankSize := limit * 3
		if reRankSize > len(scoredCandidates) {
			reRankSize = len(scoredCandidates)
		}
		if reRankSize > 0 && len(enrichedVector) > 0 && !vectorsEqual(queryVector, enrichedVector) {
			for i := 0; i < reRankSize; i++ {
				cand := &scoredCandidates[i]
				if cand.hasEmbedding {
					cand.embeddingScore = math.Max(0, watch.CosineSimilarity(enrichedVector, bytesToVector(cand.vectorBytes)))
				}
				rescorePopulateChildEmbeddings(cand, enrichedVector)
			}
			for i := 0; i < reRankSize; i++ {
				cand := &scoredCandidates[i]
				kind := ""
				if cand.element.Kind != nil {
					kind = *cand.element.Kind
				}
				connectivityScore := 0.0
				if connectedIDs[cand.element.ID] {
					connectivityScore = 1.0
				}
				scorePopulateChildSupport(cand, popQuery)
				cand.finalScore = calculatePopulateFinalScore(*cand, kind, connectivityScore)
				cand.element.SimilarityScore = cand.finalScore
				cand.element.MatchReason = populateMatchReason(*cand)
			}
			sort.Slice(scoredCandidates[:reRankSize], func(i, j int) bool {
				return scoredCandidates[i].finalScore > scoredCandidates[j].finalScore
			})
		}

		sort.Slice(scoredCandidates, func(i, j int) bool {
			if scoredCandidates[i].finalScore == scoredCandidates[j].finalScore {
				return scoredCandidates[i].element.ID < scoredCandidates[j].element.ID
			}
			return scoredCandidates[i].finalScore > scoredCandidates[j].finalScore
		})

		if len(scoredCandidates) > limit {
			scoredCandidates = scoredCandidates[:limit]
		}

		results := make([]populateElementResult, 0, len(scoredCandidates))
		for _, cand := range scoredCandidates {
			results = append(results, cand.element)
		}

		writeJSON(w, map[string]any{"results": results})
	})
}

func passesPopulateScoreGate(finalScore, lexicalPathScore float64) bool {
	if finalScore >= 0.35 {
		return true
	}
	if finalScore >= 0.25 && lexicalPathScore >= 0.30 {
		return true
	}
	return lexicalPathScore >= 0.50 && finalScore >= 0.15
}

type populateQuery struct {
	Base     string
	Compact  string
	Enriched string
	Tokens   map[string]bool
	Hints    []string
	ViewName string
}

type populateCandidate struct {
	element          populateElementResult
	ownerType        string
	ownerKey         string
	children         []populateChildCandidate
	embeddingScore   float64
	hasEmbedding     bool
	archConfidence   float64
	childCount       int
	childMatchCount  int
	childCoverage    float64
	childSupport     float64
	lexicalPathScore float64
	finalScore       float64
	vectorBytes      []byte
}

type populateChildCandidate struct {
	name           string
	kind           string
	filePath       string
	tags           string
	hasEmbedding   bool
	embeddingScore float64
	vectorBytes    []byte
}

func buildPopulateQuery(ctx context.Context, db *sql.DB, viewID int64, userQuery string) (populateQuery, error) {
	var viewName string
	var ownerElementID sql.NullInt64
	var viewDescription sql.NullString
	if err := db.QueryRowContext(ctx, `SELECT name, owner_element_id, description FROM views WHERE id = ?`, viewID).Scan(&viewName, &ownerElementID, &viewDescription); err != nil {
		return populateQuery{}, err
	}
	base := strings.TrimSpace(userQuery)
	if base == "" {
		base = strings.TrimSpace(viewName)
	}
	parts := []string{base, viewName}
	if viewDescription.Valid {
		parts = append(parts, viewDescription.String)
	}
	if ownerElementID.Valid {
		var name string
		var kind, description, filePath sql.NullString
		if err := db.QueryRowContext(ctx, `SELECT name, kind, description, file_path FROM elements WHERE id = ?`, ownerElementID.Int64).Scan(&name, &kind, &description, &filePath); err == nil {
			parts = append(parts, name)
			if kind.Valid {
				parts = append(parts, kind.String)
			}
			if description.Valid {
				parts = append(parts, description.String)
			}
			if filePath.Valid {
				parts = append(parts, filePath.String)
			}
		}
	}
	rows, err := db.QueryContext(ctx, `
		SELECT e.name, COALESCE(e.kind, ''), COALESCE(e.file_path, '')
		FROM placements p
		JOIN elements e ON e.id = p.element_id
		WHERE p.view_id = ?
		ORDER BY p.id
		LIMIT 12`, viewID)
	if err == nil {
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			var name, kind, filePath string
			if rows.Scan(&name, &kind, &filePath) == nil {
				parts = append(parts, name, kind, filePath)
			}
		}
	}
	hints := populateRoleHints(parts...)
	if len(hints) == 0 {
		hints = []string{"service", "module", "subsystem", "application"}
	}
	compact := fmt.Sprintf("Architecture: %s. Roles: %s.", base, strings.Join(hints, ", "))
	enriched := fmt.Sprintf("Architecture: %s. Roles: %s. Context: %s. Scope: subsystems and services.", base, strings.Join(hints, ", "), viewName)
	tokens := getTokens(strings.Join(append([]string{base, viewName}, hints...), " "))
	return populateQuery{Base: base, Compact: compact, Enriched: enriched, Tokens: tokens, Hints: hints, ViewName: viewName}, nil
}

func populateRoleHints(values ...string) []string {
	source := strings.ToLower(strings.Join(values, " "))
	hints := []string{}
	add := func(items ...string) {
		for _, item := range items {
			item = strings.TrimSpace(item)
			if item != "" && !containsString(hints, item) {
				hints = append(hints, item)
			}
		}
	}
	if strings.Contains(source, "frontend") || strings.Contains(source, "front-end") || strings.Contains(source, "ui") || strings.Contains(source, "web") || strings.Contains(source, "react") || strings.Contains(source, "panel") || strings.Contains(source, "component") || strings.Contains(source, "canvas") || strings.Contains(source, "render") {
		add("web app", "frontend", "ui", "client", "react", "panel")
	}
	if strings.Contains(source, "backend") || strings.Contains(source, "server") || strings.Contains(source, "api") || strings.Contains(source, "rpc") || strings.Contains(source, "endpoint") || strings.Contains(source, "handler") || strings.Contains(source, "grpc") {
		add("backend service", "api service", "server", "rpc", "handler")
	}
	if strings.Contains(source, "cli") || strings.Contains(source, "command") || strings.Contains(source, "cobra") || strings.Contains(source, "terminal") {
		add("cli", "command", "terminal", "cobra")
	}
	if strings.Contains(source, "websocket") || strings.Contains(source, "real time") || strings.Contains(source, "realtime") || strings.Contains(source, "ws") || strings.Contains(source, "event") {
		add("real time service", "websocket", "event stream", "live updates")
	}
	if strings.Contains(source, "watch") || strings.Contains(source, "scanner") || strings.Contains(source, "scan") || strings.Contains(source, "analysis") {
		add("watch service", "scanner", "repository analysis", "file watcher")
	}
	if strings.Contains(source, "job") || strings.Contains(source, "worker") || strings.Contains(source, "scheduler") || strings.Contains(source, "queue") {
		add("scheduler", "worker", "background job")
	}
	if strings.Contains(source, "database") || strings.Contains(source, "db") || strings.Contains(source, "sqlite") || strings.Contains(source, "storage") || strings.Contains(source, "sql") || strings.Contains(source, "persistence") {
		add("database", "storage", "persistence", "sql")
	}
	if strings.Contains(source, "auth") || strings.Contains(source, "login") || strings.Contains(source, "session") || strings.Contains(source, "token") || strings.Contains(source, "permission") || strings.Contains(source, "security") {
		add("authentication", "authorization", "security", "session")
	}
	if strings.Contains(source, "embedding") || strings.Contains(source, "vector") || strings.Contains(source, "semantic") || strings.Contains(source, "ai") || strings.Contains(source, "ml") || strings.Contains(source, "model") {
		add("embedding", "vector", "semantic", "ai")
	}
	if strings.Contains(source, "config") || strings.Contains(source, "setting") || strings.Contains(source, "env") || strings.Contains(source, "environment") {
		add("configuration", "settings", "environment")
	}
	if strings.Contains(source, "test") || strings.Contains(source, "mock") || strings.Contains(source, "fixture") {
		add("testing", "test", "validation")
	}
	for _, value := range values {
		for token := range getTokens(value) {
			if len(token) >= 3 {
				add(token)
			}
		}
	}
	if len(hints) > 12 {
		hints = hints[:12]
	}
	return hints
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func loadPopulateCandidates(ctx context.Context, db *sql.DB, repoID, viewID, modelID int64, queryVector watch.Vector, includeFiles bool) ([]populateCandidate, error) {
	kinds := []string{
		"'architecture-component'", "'repository-section'", "'folder'", "'cluster'", "'dependency-group'", "'fact-summary'", "'repository'",
		"'file'", "'function'", "'method'", "'interface'", "'struct'", "'type'", "'class'", "'constructor'", "'route'", "'service'",
	}
	_ = includeFiles
	rows, err := db.QueryContext(ctx, fmt.Sprintf(`
		SELECT el.id, el.name, el.kind, el.description, el.technology, el.url, el.logo_url, el.technology_connectors, el.tags, el.repo, el.branch, el.file_path, el.language, el.created_at, el.updated_at,
		       m.owner_type, m.owner_key,
		       COALESCE((SELECT MAX(confidence) FROM watch_architecture_links al WHERE al.target_resource_type = 'element' AND al.target_resource_id = el.id), 0),
		       COALESCE((SELECT COUNT(*) FROM placements cp JOIN views cv ON cv.id = cp.view_id WHERE cv.owner_element_id = el.id), 0),
		       pe.vector
		FROM watch_materialization m
		JOIN elements el ON el.id = m.resource_id
		LEFT JOIN watch_embeddings pe ON pe.model_id = ? AND pe.owner_type = 'populate_resource' AND pe.owner_key = m.owner_type || ':' || m.owner_key
		WHERE m.repository_id = ?
		  AND m.resource_type = 'element'
		  AND COALESCE(el.kind, '') IN (%s)
		  AND el.id NOT IN (SELECT element_id FROM placements WHERE view_id = ?)
		ORDER BY el.kind, el.name`, strings.Join(kinds, ",")), modelID, repoID, viewID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []populateCandidate{}
	for rows.Next() {
		var cand populateCandidate
		var kind, description, technology, url, logoURL, repo, branch, filePath, language sql.NullString
		var techRaw, tagRaw, createdAt, updatedAt string
		var vectorBytes []byte
		if err := rows.Scan(
			&cand.element.ID, &cand.element.Name, &kind, &description, &technology, &url, &logoURL, &techRaw, &tagRaw, &repo, &branch, &filePath, &language, &createdAt, &updatedAt,
			&cand.ownerType, &cand.ownerKey, &cand.archConfidence, &cand.childCount, &vectorBytes,
		); err != nil {
			return nil, err
		}
		cand.element.Kind = nullStringPtr(kind)
		cand.element.Description = nullStringPtr(description)
		cand.element.Technology = nullStringPtr(technology)
		cand.element.URL = nullStringPtr(url)
		cand.element.LogoURL = nullStringPtr(logoURL)
		cand.element.Repo = nullStringPtr(repo)
		cand.element.Branch = nullStringPtr(branch)
		cand.element.FilePath = nullStringPtr(filePath)
		cand.element.Language = nullStringPtr(language)
		cand.element.TechnologyConnectors = json.RawMessage(techRaw)
		cand.element.Tags = json.RawMessage(tagRaw)
		cand.element.CreatedAt = createdAt
		cand.element.UpdatedAt = updatedAt
		cand.element.MatchKind = cand.ownerType
		if len(queryVector) > 0 && len(vectorBytes) > 0 {
			cand.embeddingScore = math.Max(0, watch.CosineSimilarity(queryVector, bytesToVector(vectorBytes)))
			cand.hasEmbedding = true
			cand.vectorBytes = vectorBytes
		}
		out = append(out, cand)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := hydratePopulateCandidateChildren(ctx, db, modelID, queryVector, out); err != nil {
		return nil, err
	}
	return out, nil
}

func hydratePopulateCandidateChildren(ctx context.Context, db *sql.DB, modelID int64, queryVector watch.Vector, candidates []populateCandidate) error {
	parentIndexes := map[int64]int{}
	for i := range candidates {
		if !supportsPopulateChildren(candidates[i].kind()) {
			continue
		}
		parentIndexes[candidates[i].element.ID] = i
	}
	if len(parentIndexes) == 0 {
		return nil
	}
	parentIDs := make([]int64, 0, len(parentIndexes))
	for id := range parentIndexes {
		parentIDs = append(parentIDs, id)
	}
	sort.Slice(parentIDs, func(i, j int) bool { return parentIDs[i] < parentIDs[j] })
	rows, err := db.QueryContext(ctx, fmt.Sprintf(`
		SELECT parent_id, name, kind, file_path, tags, vector
		FROM (
			SELECT child_view.owner_element_id AS parent_id,
			       child.name AS name,
			       COALESCE(child.kind, '') AS kind,
			       COALESCE(child.file_path, '') AS file_path,
			       child.tags AS tags,
			       pe.vector AS vector,
			       ROW_NUMBER() OVER (PARTITION BY child_view.owner_element_id ORDER BY placement.id) AS child_rank
			FROM views child_view
			JOIN placements placement ON placement.view_id = child_view.id
			JOIN elements child ON child.id = placement.element_id
			LEFT JOIN watch_materialization child_mat ON child_mat.resource_type = 'element' AND child_mat.resource_id = child.id
			LEFT JOIN watch_embeddings pe ON pe.model_id = ? AND pe.owner_type = 'populate_resource' AND pe.owner_key = child_mat.owner_type || ':' || child_mat.owner_key
			WHERE child_view.owner_element_id IN (%s)
		)
		WHERE child_rank <= 80
		ORDER BY parent_id, child_rank`, formatIDs(parentIDs)), modelID)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var parentID int64
		var child populateChildCandidate
		var vectorBytes []byte
		if err := rows.Scan(&parentID, &child.name, &child.kind, &child.filePath, &child.tags, &vectorBytes); err != nil {
			return err
		}
		if len(vectorBytes) > 0 {
			child.hasEmbedding = true
			child.vectorBytes = vectorBytes
			if len(queryVector) > 0 {
				child.embeddingScore = math.Max(0, watch.CosineSimilarity(queryVector, bytesToVector(vectorBytes)))
			}
		}
		idx, ok := parentIndexes[parentID]
		if !ok {
			continue
		}
		candidates[idx].children = append(candidates[idx].children, child)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for i := range candidates {
		if len(candidates[i].children) > candidates[i].childCount {
			candidates[i].childCount = len(candidates[i].children)
		}
	}
	return rows.Err()
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func scorePopulateCandidates(query populateQuery, candidates []populateCandidate, connectedIDs map[int64]bool) []populateCandidate {
	for i := range candidates {
		cand := &candidates[i]
		filePath := ""
		if cand.element.FilePath != nil {
			filePath = *cand.element.FilePath
		}
		kind := ""
		if cand.element.Kind != nil {
			kind = *cand.element.Kind
		}
		cand.lexicalPathScore = calculateLexicalPathScore(query.Base, query.ViewName, cand.element.Name, filePath+" "+kind+" "+string(cand.element.Tags))
		scorePopulateChildSupport(cand, query)
		connectivityScore := 0.0
		if connectedIDs[cand.element.ID] {
			connectivityScore = 1.0
		}
		cand.finalScore = calculatePopulateFinalScore(*cand, kind, connectivityScore)
		cand.element.SimilarityScore = cand.finalScore
		cand.element.MatchReason = populateMatchReason(*cand)
	}
	return candidates
}

func (cand populateCandidate) kind() string {
	if cand.element.Kind == nil {
		return ""
	}
	return *cand.element.Kind
}

func scorePopulateChildSupport(cand *populateCandidate, query populateQuery) {
	if cand == nil {
		return
	}
	cand.childMatchCount = 0
	cand.childCoverage = 0
	cand.childSupport = 0
	if !supportsPopulateChildren(cand.kind()) || len(cand.children) == 0 {
		return
	}
	total := 0.0
	weightedCoverage := 0.0
	matches := 0
	for _, child := range cand.children {
		childLexical := calculateLexicalPathScore(query.Base, query.ViewName, child.name, child.filePath+" "+child.kind+" "+child.tags)
		childEmbedding := 0.0
		if child.hasEmbedding {
			childEmbedding = child.embeddingScore
		}
		childScore := childLexical*0.35 + childEmbedding*0.65
		total += childScore
		if childScore >= 0.45 {
			matches++
		}
		weightedCoverage += clamp01((childScore - 0.25) / 0.45)
	}
	count := float64(len(cand.children))
	cand.childMatchCount = matches
	cand.childCoverage = weightedCoverage / count
	cand.childSupport = clamp01(cand.childCoverage*0.70 + (total/count)*0.30)
}

func rescorePopulateChildEmbeddings(cand *populateCandidate, queryVector watch.Vector) {
	if cand == nil || len(queryVector) == 0 {
		return
	}
	for i := range cand.children {
		if !cand.children[i].hasEmbedding || len(cand.children[i].vectorBytes) == 0 {
			continue
		}
		cand.children[i].embeddingScore = math.Max(0, watch.CosineSimilarity(queryVector, bytesToVector(cand.children[i].vectorBytes)))
	}
}

func supportsPopulateChildren(kind string) bool {
	switch kind {
	case "architecture-component", "repository-section", "folder", "cluster", "dependency-group", "fact-summary", "repository":
		return true
	default:
		return false
	}
}

func calculatePopulateFinalScore(cand populateCandidate, kind string, connectivityScore float64) float64 {
	abstractionScore := abstractionPriority(kind)
	score := cand.lexicalPathScore*0.20 + cand.embeddingScore*0.40 + cand.archConfidence*0.14 + connectivityScore*0.10 + cand.childSupport*0.12 + abstractionScore*0.04
	if supportsPopulateChildren(kind) {
		score *= containerEvidenceScale(cand)
	}
	return score
}

func containerEvidenceScale(cand populateCandidate) float64 {
	if len(cand.children) == 0 {
		return 0.55
	}
	return 0.45 + cand.childSupport*0.55
}

func clamp01(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func filterPopulateCandidates(candidates []populateCandidate, includeFiles bool) []populateCandidate {
	_ = includeFiles
	out := []populateCandidate{}
	for _, cand := range candidates {
		if cand.finalScore >= 0.18 || cand.lexicalPathScore >= 0.40 || (cand.hasEmbedding && cand.embeddingScore >= 0.55) {
			out = append(out, cand)
		}
	}
	return out
}

func abstractionPriority(kind string) float64 {
	switch kind {
	case "architecture-component":
		return 1.0
	case "repository-section", "folder", "cluster":
		return 0.85
	case "dependency-group", "fact-summary", "repository":
		return 0.75
	case "file":
		return 0.25
	case "function", "method", "constructor", "route":
		return 0.20
	case "interface", "struct", "type", "class", "service":
		return 0.35
	default:
		return 0.4
	}
}

func populateMatchReason(cand populateCandidate) string {
	parts := []string{}
	if cand.lexicalPathScore > 0 {
		parts = append(parts, fmt.Sprintf("lexical %.2f", cand.lexicalPathScore))
	}
	if cand.hasEmbedding {
		parts = append(parts, fmt.Sprintf("semantic %.2f", cand.embeddingScore))
	}
	if cand.archConfidence > 0 {
		parts = append(parts, fmt.Sprintf("architecture %.2f", cand.archConfidence))
	}
	if cand.childCount > 0 {
		if len(cand.children) > 0 {
			parts = append(parts, fmt.Sprintf("children %.2f (%d/%d)", cand.childSupport, cand.childMatchCount, len(cand.children)))
		} else {
			parts = append(parts, fmt.Sprintf("%d children", cand.childCount))
		}
	}
	return strings.Join(parts, ", ")
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

func vectorsEqual(a, b watch.Vector) bool {
	if len(a) != len(b) {
		return false
	}
	for i, v := range a {
		if v != b[i] {
			return false
		}
	}
	return true
}

func formatIDs(ids []int64) string {
	var sb strings.Builder
	for i, id := range ids {
		if i > 0 {
			sb.WriteString(",")
		}
		sb.WriteString(strconv.FormatInt(id, 10))
	}
	return sb.String()
}

func getTokens(s string) map[string]bool {
	tokens := make(map[string]bool)
	var current strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			current.WriteRune(r)
		} else {
			if current.Len() > 0 {
				tokens[strings.ToLower(current.String())] = true
				current.Reset()
			}
		}
	}
	if current.Len() > 0 {
		tokens[strings.ToLower(current.String())] = true
	}
	return tokens
}

func calculateLexicalPathScore(q string, viewName string, elementName string, filePath string) float64 {
	queryTokens := getTokens(q)
	viewTokens := getTokens(viewName)
	nameTokens := getTokens(elementName)
	pathTokens := getTokens(filePath)

	score := 0.0

	qLower := strings.ToLower(strings.TrimSpace(q))
	elLower := strings.ToLower(strings.TrimSpace(elementName))
	vLower := strings.ToLower(strings.TrimSpace(viewName))
	if elLower == qLower || elLower == vLower {
		score += 0.5
	} else {
		allMatchQ := len(nameTokens) > 0
		for t := range nameTokens {
			if !queryTokens[t] {
				allMatchQ = false
				break
			}
		}
		allMatchV := len(nameTokens) > 0
		for t := range nameTokens {
			if !viewTokens[t] {
				allMatchV = false
				break
			}
		}
		if allMatchQ || allMatchV {
			score += 0.5
		}
	}

	pathMatch := 0.0
	for t := range pathTokens {
		if queryTokens[t] || viewTokens[t] {
			pathMatch = 0.3
			break
		}
	}
	if pathMatch == 0.0 {
		pathLower := strings.ToLower(filePath)
		qLower2 := strings.ToLower(q)
		vLower2 := strings.ToLower(viewName)
		for token := range queryTokens {
			if len(token) >= 3 && strings.Contains(pathLower, token) {
				pathMatch = 0.15
				break
			}
		}
		if pathMatch == 0.0 {
			for token := range viewTokens {
				if len(token) >= 3 && strings.Contains(pathLower, token) {
					pathMatch = 0.15
					break
				}
			}
		}
		if pathMatch == 0.0 && (strings.Contains(qLower2, " ") || strings.Contains(vLower2, " ")) {
			pathMatch = 0.0
		}
	}
	if pathMatch == 0.0 {
		pathMatch = 0.05
	}
	score += pathMatch

	overlapCount := 0
	for t := range nameTokens {
		if queryTokens[t] || viewTokens[t] {
			overlapCount++
		}
	}
	if overlapCount >= 2 {
		score += 0.2
	} else if overlapCount == 1 {
		score += 0.1
	}

	if score > 1.0 {
		return 1.0
	}
	return score
}
