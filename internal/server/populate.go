package server

import (
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
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

		type scoreEntry struct {
			element    populateElementResult
			similarity float64
		}

		var entries []scoreEntry
		seenElements := make(map[int64]float64)

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

			// Keep highest similarity score per element
			if existingScore, seen := seenElements[id]; seen {
				if similarity > existingScore {
					seenElements[id] = similarity
					// Update score in entries list
					for i, entry := range entries {
						if entry.element.ID == id {
							entries[i].similarity = similarity
							entries[i].element.SimilarityScore = similarity
							break
						}
					}
				}
				continue
			}

			seenElements[id] = similarity

			var kindPtr, descPtr, techPtr, urlPtr, logoPtr, repoPtr, branchPtr, filePtr, langPtr *string
			if kind.Valid { kindPtr = &kind.String }
			if description.Valid { descPtr = &description.String }
			if technology.Valid { techPtr = &technology.String }
			if url.Valid { urlPtr = &url.String }
			if logoURL.Valid { logoPtr = &logoURL.String }
			if repo.Valid { repoPtr = &repo.String }
			if branch.Valid { branchPtr = &branch.String }
			if filePath.Valid { filePtr = &filePath.String }
			if language.Valid { langPtr = &language.String }

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

			entries = append(entries, scoreEntry{
				element:    elRes,
				similarity: similarity,
			})
		}

		if err := rows.Err(); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "rows iteration error: "+err.Error())
			return
		}

		// Sort by similarity descending
		sort.Slice(entries, func(i, j int) bool {
			return entries[i].similarity > entries[j].similarity
		})

		// Slice to limit
		if len(entries) > limit {
			entries = entries[:limit]
		}

		results := make([]populateElementResult, 0, len(entries))
		for _, entry := range entries {
			results = append(results, entry.element)
		}

		writeJSON(w, map[string]any{"results": results})
	})
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
