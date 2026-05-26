package embedlab

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"strconv"
)

//go:embed static/*
var staticFS embed.FS

type Handler struct {
	Store       *Store
	Service     *Service
	Repository  string
	Model       string
	Limit       int
	RuntimePath string
}

func NewHandler(store *Store, repository, model string, limit int, runtimePath string) *Handler {
	return &Handler{
		Store:       store,
		Service:     NewService(store),
		Repository:  repository,
		Model:       model,
		Limit:       limit,
		RuntimePath: runtimePath,
	}
}

func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/repositories", h.repositories)
	mux.HandleFunc("GET /api/models", h.models)
	mux.HandleFunc("GET /api/search", h.search)
	mux.HandleFunc("GET /api/graph", h.graph)
	mux.HandleFunc("GET /api/clusters", h.clusters)
	mux.HandleFunc("GET /api/stats", h.stats)
	dist, _ := fs.Sub(staticFS, "static")
	mux.Handle("/", http.FileServer(http.FS(dist)))
	return mux
}

func (h *Handler) repositories(w http.ResponseWriter, r *http.Request) {
	repos, err := h.Store.Repositories(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, repos)
}

func (h *Handler) models(w http.ResponseWriter, r *http.Request) {
	models, err := h.Store.Models(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, models)
}

func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	result, err := h.Service.Search(
		r.Context(),
		queryDefault(r, "repository", h.Repository),
		queryDefault(r, "model", h.Model),
		r.URL.Query().Get("q"),
		parseInt(r.URL.Query().Get("limit"), h.Limit),
	)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) graph(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	result, err := h.Service.Graph(r.Context(), GraphOptions{
		RepositorySelector: queryDefault(r, "repository", h.Repository),
		ModelSelector:      queryDefault(r, "model", h.Model),
		SymbolID:           int64(parseInt(query.Get("symbol_id"), 0)),
		Query:              query.Get("query"),
		Limit:              parseInt(query.Get("k"), h.Limit),
		MinSimilarity:      parseFloat(query.Get("min_similarity"), 0),
		IncludeFiles:       parseBool(query.Get("include_files"), true),
		IncludeReferences:  parseBool(query.Get("include_refs"), true),
		IncludeClusters:    parseBool(query.Get("include_clusters"), false),
		RuntimePath:        queryDefault(r, "runtime_path", h.RuntimePath),
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) clusters(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	result, err := h.Service.Clusters(
		r.Context(),
		queryDefault(r, "repository", h.Repository),
		queryDefault(r, "model", h.Model),
		query.Get("algorithm"),
		parseInt(query.Get("k"), 8),
	)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) stats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.Service.Stats(
		r.Context(),
		queryDefault(r, "repository", h.Repository),
		queryDefault(r, "model", h.Model),
	)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func queryDefault(r *http.Request, key, fallback string) string {
	if value := r.URL.Query().Get(key); value != "" {
		return value
	}
	return fallback
}

func parseInt(value string, fallback int) int {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseFloat(value string, fallback float64) float64 {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseBool(value string, fallback bool) bool {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func Addr(host, port string) string {
	if host == "" {
		host = "127.0.0.1"
	}
	if port == "" {
		port = "8072"
	}
	return fmt.Sprintf("%s:%s", host, port)
}
