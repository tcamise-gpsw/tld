package server

import (
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
}

func registerPopulateHandlers(mux *http.ServeMux, sqliteStore *store.SQLiteStore) {
	mux.HandleFunc("GET /api/views/{id}/populate-query", func(w http.ResponseWriter, r *http.Request) {
		viewID, ok := parseViewID(w, r)
		if !ok {
			return
		}
		var name string
		err := sqliteStore.DB().QueryRowContext(r.Context(), "SELECT name FROM views WHERE id = ?", viewID).Scan(&name)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSONError(w, http.StatusNotFound, "view not found")
			} else {
				writeJSONError(w, http.StatusBadRequest, err.Error())
			}
			return
		}
		writeJSON(w, map[string]string{"query": name})
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

		// 1. Get default repository and model
		var repoID int64
		err := sqliteStore.DB().QueryRowContext(r.Context(), "SELECT id FROM watch_repositories ORDER BY updated_at DESC, id DESC LIMIT 1").Scan(&repoID)
		if err != nil {
			writeJSON(w, map[string]any{"results": []any{}})
			return
		}

		var modelID int64
		var modelProvider, modelName, modelConfigHash string
		var modelDimension int
		err = sqliteStore.DB().QueryRowContext(r.Context(), "SELECT id, provider, model, dimension, config_hash FROM watch_embedding_models ORDER BY created_at DESC, id DESC LIMIT 1").Scan(
			&modelID, &modelProvider, &modelName, &modelDimension, &modelConfigHash,
		)
		if err != nil {
			writeJSON(w, map[string]any{"results": []any{}})
			return
		}

		if modelProvider == "none" {
			writeJSON(w, map[string]any{"results": []any{}})
			return
		}

		// Load view name
		var viewName string
		err = sqliteStore.DB().QueryRowContext(r.Context(), "SELECT name FROM views WHERE id = ?", viewID).Scan(&viewName)
		if err != nil {
			viewName = ""
		}

		// 2. Load global workspace configuration
		cfg, err := workspace.LoadGlobalConfig()
		if err != nil {
			cfg = workspace.DefaultConfig()
		}

		embCfg := watch.EmbeddingConfig{
			Provider:        modelProvider,
			Endpoint:        cfg.Watch.Embedding.Endpoint,
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

		// 3. Generate query vector
		vectors, err := provider.Embed(r.Context(), []watch.EmbeddingInput{{OwnerType: "query", Text: q}})
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "failed to embed query: "+err.Error())
			return
		}
		if len(vectors) != 1 {
			writeJSONError(w, http.StatusInternalServerError, "embedding provider returned invalid vector count")
			return
		}
		queryVector := vectors[0]

		// 4. Query all symbol embeddings for elements not already placed in the view
		rows, err := sqliteStore.DB().QueryContext(r.Context(), `
			SELECT el.id, el.name, el.kind, el.description, el.technology, el.url, el.logo_url, el.technology_connectors, el.tags, el.repo, el.branch, el.file_path, el.language, el.created_at, el.updated_at,
			       e.vector
			FROM watch_embeddings e
			JOIN watch_materialization m ON m.owner_type = 'symbol' AND m.owner_key = e.owner_key AND m.repository_id = ?
			JOIN elements el ON el.id = m.resource_id
			WHERE e.model_id = ? AND e.owner_type = 'symbol'
			  AND el.id NOT IN (SELECT element_id FROM placements WHERE view_id = ?)`, repoID, modelID, viewID)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "failed to query symbol embeddings: "+err.Error())
			return
		}
		defer func() { _ = rows.Close() }()

		type symbolHit struct {
			elementID  int64
			similarity float64
			elResult   populateElementResult
			filePath   string
		}

		var hits []symbolHit

		for rows.Next() {
			var id int64
			var name string
			var kind, description, technology, url, logoURL, repo, branch, filePath, language sql.NullString
			var techRaw, tagRaw, createdAt, updatedAt string
			var vectorBytes []byte

			if err := rows.Scan(
				&id, &name, &kind, &description, &technology, &url, &logoURL, &techRaw, &tagRaw, &repo, &branch, &filePath, &language, &createdAt, &updatedAt,
				&vectorBytes,
			); err != nil {
				writeJSONError(w, http.StatusInternalServerError, "failed to scan embedding row: "+err.Error())
				return
			}

			symbolVector := bytesToVector(vectorBytes)
			similarity := watch.CosineSimilarity(queryVector, symbolVector)

			var kindPtr, descPtr, techPtr, urlPtr, logoPtr, repoPtr, branchPtr, filePtr, langPtr *string
			if kind.Valid {
				kindPtr = &kind.String
			}
			if description.Valid {
				descPtr = &description.String
			}
			if technology.Valid {
				techPtr = &technology.String
			}
			if url.Valid {
				urlPtr = &url.String
			}
			if logoURL.Valid {
				logoPtr = &logoURL.String
			}
			if repo.Valid {
				repoPtr = &repo.String
			}
			if branch.Valid {
				branchPtr = &branch.String
			}
			if filePath.Valid {
				filePtr = &filePath.String
			}
			if language.Valid {
				langPtr = &language.String
			}

			elRes := populateElementResult{
				ID:                   id,
				Name:                 name,
				Kind:                 kindPtr,
				Description:          descPtr,
				Technology:           techPtr,
				URL:                  urlPtr,
				LogoURL:              logoPtr,
				TechnologyConnectors: json.RawMessage(techRaw),
				Tags:                 json.RawMessage(tagRaw),
				Repo:                 repoPtr,
				Branch:               branchPtr,
				FilePath:             filePtr,
				Language:             langPtr,
				CreatedAt:            createdAt,
				UpdatedAt:            updatedAt,
				SimilarityScore:      similarity,
			}

			var fp string
			if filePath.Valid {
				fp = filePath.String
			}

			hits = append(hits, symbolHit{
				elementID:  id,
				similarity: similarity,
				elResult:   elRes,
				filePath:   fp,
			})
		}

		if err := rows.Err(); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "rows iteration error: "+err.Error())
			return
		}

		// Group symbol hits by file path
		hitsByFile := make(map[string][]symbolHit)
		for _, hit := range hits {
			if hit.filePath != "" {
				hitsByFile[hit.filePath] = append(hitsByFile[hit.filePath], hit)
			}
		}

		type candidate struct {
			element          populateElementResult
			similarity       float64
			hitCount         int
			lexicalPathScore float64
			finalScore       float64
		}

		var candidates []candidate
		processedFiles := make(map[string]bool)

		for _, hit := range hits {
			fp := hit.filePath
			if fp == "" {
				candidates = append(candidates, candidate{
					element:    hit.elResult,
					similarity: hit.similarity,
					hitCount:   1,
				})
				continue
			}

			if processedFiles[fp] {
				continue
			}

			fileHits := hitsByFile[fp]
			if len(fileHits) > 1 {
				// Try to promote to file-level suggestion
				var fileEl populateElementResult
				var fKind, fDescription, fTechnology, fURL, fLogoURL, fRepo, fBranch, fFilePath, fLanguage sql.NullString
				var fTechRaw, fTagRaw, fCreatedAt, fUpdatedAt string
				err := sqliteStore.DB().QueryRowContext(r.Context(), `
					SELECT id, name, kind, description, technology, url, logo_url, technology_connectors, tags, repo, branch, file_path, language, created_at, updated_at
					FROM elements
					WHERE file_path = ? AND kind = 'file'
					LIMIT 1`, fp).Scan(
					&fileEl.ID, &fileEl.Name, &fKind, &fDescription, &fTechnology, &fURL, &fLogoURL, &fTechRaw, &fTagRaw, &fRepo, &fBranch, &fFilePath, &fLanguage, &fCreatedAt, &fUpdatedAt,
				)
				if err == nil {
					// Check if this promoted file element is already placed in the view
					var placedCount int
					errP := sqliteStore.DB().QueryRowContext(r.Context(), `SELECT COUNT(*) FROM placements WHERE view_id = ? AND element_id = ?`, viewID, fileEl.ID).Scan(&placedCount)
					if errP == nil && placedCount > 0 {
						// Already placed, skip suggesting
						processedFiles[fp] = true
						continue
					}

					if fKind.Valid {
						fileEl.Kind = &fKind.String
					}
					if fDescription.Valid {
						fileEl.Description = &fDescription.String
					}
					if fTechnology.Valid {
						fileEl.Technology = &fTechnology.String
					}
					if fURL.Valid {
						fileEl.URL = &fURL.String
					}
					if fLogoURL.Valid {
						fileEl.LogoURL = &fLogoURL.String
					}
					if fRepo.Valid {
						fileEl.Repo = &fRepo.String
					}
					if fBranch.Valid {
						fileEl.Branch = &fBranch.String
					}
					if fFilePath.Valid {
						fileEl.FilePath = &fFilePath.String
					}
					if fLanguage.Valid {
						fileEl.Language = &fLanguage.String
					}
					fileEl.TechnologyConnectors = json.RawMessage(fTechRaw)
					fileEl.Tags = json.RawMessage(fTagRaw)
					fileEl.CreatedAt = fCreatedAt
					fileEl.UpdatedAt = fUpdatedAt

					// Max similarity
					maxSim := -1.0
					for _, fh := range fileHits {
						if fh.similarity > maxSim {
							maxSim = fh.similarity
						}
					}
					fileEl.SimilarityScore = maxSim

					candidates = append(candidates, candidate{
						element:    fileEl,
						similarity: maxSim,
						hitCount:   len(fileHits),
					})
					processedFiles[fp] = true
					continue
				}
			}

			// Fallback to symbol-level suggestions for each hit in this file
			for _, fh := range fileHits {
				candidates = append(candidates, candidate{
					element:    fh.elResult,
					similarity: fh.similarity,
					hitCount:   1,
				})
			}
			processedFiles[fp] = true
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

		candidateIDs := make([]int64, 0, len(candidates))
		for _, cand := range candidates {
			candidateIDs = append(candidateIDs, cand.element.ID)
		}

		archConf := make(map[int64]float64)
		if len(candidateIDs) > 0 {
			_ = queryIDChunks(candidateIDs, 450, func(ids []int64) error {
				idsStr := formatIDs(ids)
				query := fmt.Sprintf(`
					SELECT target_resource_id, MAX(confidence)
					FROM watch_architecture_links
					WHERE target_resource_type = 'element' AND target_resource_id IN (%s)
					GROUP BY target_resource_id`, idsStr)
				rowsAC, err := sqliteStore.DB().QueryContext(r.Context(), query)
				if err != nil {
					return err
				}
				defer func() { _ = rowsAC.Close() }()
				for rowsAC.Next() {
					var id int64
					var confidence float64
					if err := rowsAC.Scan(&id, &confidence); err == nil {
						archConf[id] = confidence
					}
				}
				return rowsAC.Err()
			})
		}

		var scoredCandidates []candidate
		for _, cand := range candidates {
			semanticScore := math.Max(0.0, cand.similarity)
			acConfidence := archConf[cand.element.ID]

			connectivityScore := 0.0
			if connectedIDs[cand.element.ID] {
				connectivityScore = 1.0
			}

			filePathStr := ""
			if cand.element.FilePath != nil {
				filePathStr = *cand.element.FilePath
			}
			lexicalPathScore := calculateLexicalPathScore(q, viewName, cand.element.Name, filePathStr)

			aggregationBonus := 0.0
			if cand.hitCount > 1 {
				aggregationBonus = math.Min(1.0, math.Log1p(float64(cand.hitCount-1)))
			}

			finalScore := semanticScore*0.45 + acConfidence*0.25 + connectivityScore*0.15 + lexicalPathScore*0.10 + aggregationBonus*0.05

			cand.lexicalPathScore = lexicalPathScore
			cand.finalScore = finalScore
			cand.element.SimilarityScore = finalScore

			if passesPopulateScoreGate(finalScore, lexicalPathScore) {
				scoredCandidates = append(scoredCandidates, cand)
			}
		}

		// Sort by score descending
		sort.Slice(scoredCandidates, func(i, j int) bool {
			return scoredCandidates[i].finalScore > scoredCandidates[j].finalScore
		})

		// Gate: ambiguity suppression
		if len(scoredCandidates) >= 2 {
			top := scoredCandidates[0]
			second := scoredCandidates[1]
			if top.finalScore-second.finalScore <= 0.02 && top.lexicalPathScore < 0.30 && second.lexicalPathScore < 0.30 {
				thresholdScore := top.finalScore - 0.02
				var filtered []candidate
				for _, c := range scoredCandidates {
					if c.finalScore <= thresholdScore || c.lexicalPathScore >= 0.30 {
						filtered = append(filtered, c)
					}
				}
				scoredCandidates = filtered
			}
		}

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

func queryIDChunks(ids []int64, size int, fn func([]int64) error) error {
	if len(ids) == 0 {
		return nil
	}
	for start := 0; start < len(ids); start += size {
		end := min(start+size, len(ids))
		if err := fn(ids[start:end]); err != nil {
			return err
		}
	}
	return nil
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

	// 1. Exact or variant match with query/view name
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

	// 2. Path segment match
	pathMatch := false
	for t := range pathTokens {
		if queryTokens[t] || viewTokens[t] {
			pathMatch = true
			break
		}
	}
	if pathMatch {
		score += 0.3
	}

	// 3. Token overlap
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
