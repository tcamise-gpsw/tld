package embedlab

import (
	"context"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/mertcikla/tld/v2/internal/watch"
)

type GraphOptions struct {
	RepositorySelector string
	ModelSelector      string
	SymbolID           int64
	Query              string
	Limit              int
	MinSimilarity      float64
	IncludeFiles       bool
	IncludeReferences  bool
	IncludeClusters    bool
	RuntimePath        string
}

type Service struct {
	store *Store
}

func NewService(store *Store) *Service {
	return &Service{store: store}
}

func (s *Service) Graph(ctx context.Context, opts GraphOptions) (GraphResponse, error) {
	start := time.Now()
	repo, model, err := s.repoAndModel(ctx, opts.RepositorySelector, opts.ModelSelector)
	if err != nil {
		return GraphResponse{}, err
	}
	log.Printf("[embedlab] repoAndModel took %s", time.Since(start))

	if opts.Limit <= 0 {
		opts.Limit = 25
	}
	t0 := time.Now()
	all, err := s.store.EmbeddedSymbols(ctx, repo.ID, model.ID)
	if err != nil {
		return GraphResponse{}, err
	}
	log.Printf("[embedlab] Loaded %d embedded symbols from DB in %s", len(all), time.Since(t0))

	if len(all) == 0 {
		stats, statsErr := s.store.Stats(ctx, repo.ID, model.ID)
		if statsErr != nil {
			return GraphResponse{}, statsErr
		}
		return GraphResponse{Repository: repo, Model: model, Query: opts.Query, Stats: stats}, nil
	}

	var center *Symbol
	var centerVector watch.Vector
	if opts.SymbolID > 0 {
		t0 = time.Now()
		item, err := s.store.EmbeddingForSymbol(ctx, repo.ID, model.ID, opts.SymbolID)
		if err != nil {
			return GraphResponse{}, err
		}
		sym := item.Symbol
		score := 1.0
		sym.Similarity = &score
		center = &sym
		centerVector = item.Vector
		log.Printf("[embedlab] Loaded symbol embedding from DB in %s", time.Since(t0))
	} else if strings.TrimSpace(opts.Query) != "" {
		t0 = time.Now()
		vector, err := embedQuery(ctx, model, opts.Query, opts.RuntimePath)
		if err != nil {
			return GraphResponse{}, err
		}
		centerVector = vector
		log.Printf("[embedlab] Embedded text query via provider in %s", time.Since(t0))
	} else {
		sym := all[0].Symbol
		score := 1.0
		sym.Similarity = &score
		center = &sym
		centerVector = all[0].Vector
	}

	t0 = time.Now()
	neighbors := scoreNeighbors(all, centerVector, opts.MinSimilarity, opts.Limit)
	log.Printf("[embedlab] Scored cosine similarities for %d symbols in %s", len(all), time.Since(t0))

	if center != nil {
		neighbors = ensureCenterFirst(neighbors, *center)
	}
	stats, err := s.store.Stats(ctx, repo.ID, model.ID)
	if err != nil {
		return GraphResponse{}, err
	}

	t0 = time.Now()
	nodes, edges, err := s.graphElements(ctx, repo.ID, center, neighbors, opts)
	if err != nil {
		return GraphResponse{}, err
	}
	log.Printf("[embedlab] Constructed graph elements (%d nodes, %d edges) in %s", len(nodes), len(edges), time.Since(t0))

	log.Printf("[embedlab] Total Service.Graph execution took %s", time.Since(start))
	return GraphResponse{
		Repository: repo,
		Model:      model,
		Query:      opts.Query,
		Center:     center,
		Nodes:      nodes,
		Edges:      edges,
		Neighbors:  neighbors,
		Stats:      stats,
	}, nil
}

func (s *Service) Search(ctx context.Context, repoSelector, modelSelector, query string, limit int) (SearchResult, error) {
	repo, model, err := s.repoAndModel(ctx, repoSelector, modelSelector)
	if err != nil {
		return SearchResult{}, err
	}
	symbols, err := s.store.SearchSymbols(ctx, repo.ID, model.ID, query, limit)
	if err != nil {
		return SearchResult{}, err
	}
	return SearchResult{Repository: repo, Model: model, Symbols: symbols}, nil
}

func (s *Service) Stats(ctx context.Context, repoSelector, modelSelector string) (Stats, error) {
	repo, model, err := s.repoAndModel(ctx, repoSelector, modelSelector)
	if err != nil {
		return Stats{}, err
	}
	return s.store.Stats(ctx, repo.ID, model.ID)
}

func (s *Service) Clusters(ctx context.Context, repoSelector, modelSelector, algorithm string, k int) (ClusterResponse, error) {
	start := time.Now()
	repo, model, err := s.repoAndModel(ctx, repoSelector, modelSelector)
	if err != nil {
		return ClusterResponse{}, err
	}
	log.Printf("[embedlab] [clusters] repoAndModel took %s", time.Since(start))

	t0 := time.Now()
	items, err := s.store.EmbeddedSymbols(ctx, repo.ID, model.ID)
	if err != nil {
		return ClusterResponse{}, err
	}
	log.Printf("[embedlab] [clusters] Loaded %d embedded symbols from DB in %s", len(items), time.Since(t0))

	if algorithm == "" {
		algorithm = "connected"
	}
	t0 = time.Now()
	clusters := clusterSymbols(items, algorithm, k)
	log.Printf("[embedlab] [clusters] Executed %s clustering for %d symbols in %s", algorithm, len(items), time.Since(t0))

	log.Printf("[embedlab] [clusters] Total Clusters execution took %s", time.Since(start))
	return ClusterResponse{Repository: repo, Model: model, Algorithm: algorithm, Clusters: clusters}, nil
}

func (s *Service) repoAndModel(ctx context.Context, repoSelector, modelSelector string) (Repository, Model, error) {
	repo, err := s.store.Repository(ctx, repoSelector)
	if err != nil {
		return Repository{}, Model{}, err
	}
	model, err := s.store.Model(ctx, modelSelector)
	if err != nil {
		return Repository{}, Model{}, err
	}
	return repo, model, nil
}

func embedQuery(ctx context.Context, model Model, query, runtimePath string) (watch.Vector, error) {
	provider, err := watch.NewEmbeddingProvider(watch.EmbeddingConfig{
		Provider:    model.Provider,
		Model:       model.Name,
		Dimension:   model.Dimension,
		RuntimePath: runtimePath,
	})
	if err != nil {
		return nil, err
	}
	if closer, ok := provider.(watch.ClosableProvider); ok {
		defer func() { _ = closer.Close() }()
	}
	vectors, err := provider.Embed(ctx, []watch.EmbeddingInput{{Text: query}})
	if err != nil {
		return nil, err
	}
	if len(vectors) != 1 {
		return nil, fmt.Errorf("embedding provider returned %d query vectors", len(vectors))
	}
	return vectors[0], nil
}

func scoreNeighbors(items []embeddedSymbol, center watch.Vector, minSimilarity float64, limit int) []Symbol {
	out := []Symbol{}
	for _, item := range items {
		score := watch.CosineSimilarity(center, item.Vector)
		if score < minSimilarity {
			continue
		}
		sym := item.Symbol
		sym.Similarity = &score
		out = append(out, sym)
	}
	sort.SliceStable(out, func(i, j int) bool {
		left := 0.0
		right := 0.0
		if out[i].Similarity != nil {
			left = *out[i].Similarity
		}
		if out[j].Similarity != nil {
			right = *out[j].Similarity
		}
		if left == right {
			return out[i].ID < out[j].ID
		}
		return left > right
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

func ensureCenterFirst(symbols []Symbol, center Symbol) []Symbol {
	out := make([]Symbol, 0, len(symbols)+1)
	out = append(out, center)
	for _, sym := range symbols {
		if sym.ID != center.ID {
			out = append(out, sym)
		}
	}
	return out
}

func (s *Service) graphElements(ctx context.Context, repoID int64, center *Symbol, symbols []Symbol, opts GraphOptions) ([]GraphNode, []GraphEdge, error) {
	nodes := []GraphNode{}
	edges := []GraphEdge{}
	symbolIDs := make([]int64, 0, len(symbols))
	seenSymbols := map[int64]struct{}{}
	seenFiles := map[int64]string{}
	for _, sym := range symbols {
		if _, ok := seenSymbols[sym.ID]; ok {
			continue
		}
		seenSymbols[sym.ID] = struct{}{}
		symbolIDs = append(symbolIDs, sym.ID)
		nodes = append(nodes, symbolNode(sym))
		if opts.IncludeFiles {
			seenFiles[sym.FileID] = sym.FilePath
			edges = append(edges, GraphEdge{
				ID:     fmt.Sprintf("file:%d:symbol:%d", sym.FileID, sym.ID),
				Source: nodeID("file", sym.FileID),
				Target: nodeID("symbol", sym.ID),
				Type:   "contains",
			})
		}
		if center != nil && center.ID != sym.ID && sym.Similarity != nil {
			edges = append(edges, GraphEdge{
				ID:     fmt.Sprintf("sim:%d:%d", center.ID, sym.ID),
				Source: nodeID("symbol", center.ID),
				Target: nodeID("symbol", sym.ID),
				Type:   "similarity",
				Label:  fmt.Sprintf("%.3f", *sym.Similarity),
				Weight: *sym.Similarity,
			})
		}
	}
	if opts.IncludeFiles {
		for id, file := range seenFiles {
			nodes = append(nodes, GraphNode{
				ID:       nodeID("file", id),
				Type:     "file",
				Label:    shortPath(file),
				Subtitle: file,
				Data: map[string]any{
					"file_path": file,
				},
			})
		}
	}
	if opts.IncludeReferences {
		tRef := time.Now()
		refEdges, err := s.store.ReferencesBetween(ctx, repoID, symbolIDs)
		if err != nil {
			return nil, nil, err
		}
		edges = append(edges, refEdges...)
		log.Printf("[embedlab]   Fetched references took %s", time.Since(tRef))
	}
	if opts.IncludeClusters {
		tClust := time.Now()
		clusterNodes, clusterEdges, err := s.store.PersistedClusters(ctx, repoID, symbolIDs)
		if err != nil {
			return nil, nil, err
		}
		nodes = append(nodes, clusterNodes...)
		edges = append(edges, clusterEdges...)
		log.Printf("[embedlab]   Fetched persisted clusters took %s", time.Since(tClust))
	}

	tConn := time.Now()
	// Query TLD connectors between the resolved nodes (symbols, files, and clusters)
	var fileIDs []int64
	if opts.IncludeFiles {
		for id := range seenFiles {
			fileIDs = append(fileIDs, id)
		}
	}
	var clusterIDs []int64
	for _, node := range nodes {
		if node.Type == "cluster" {
			var cid int64
			if _, err := fmt.Sscanf(node.ID, "cluster:%d", &cid); err == nil {
				clusterIDs = append(clusterIDs, cid)
			}
		}
	}
	tldEdges, err := s.store.TLDConnectorsBetween(ctx, repoID, symbolIDs, fileIDs, clusterIDs)
	if err != nil {
		return nil, nil, err
	}
	edges = append(edges, tldEdges...)
	log.Printf("[embedlab]   Fetched TLD connectors took %s", time.Since(tConn))

	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	sort.Slice(edges, func(i, j int) bool { return edges[i].ID < edges[j].ID })
	return nodes, edges, nil
}

func symbolNode(sym Symbol) GraphNode {
	data := map[string]any{
		"symbol": sym,
	}
	if sym.Similarity != nil {
		data["similarity"] = *sym.Similarity
	}
	if sym.Score != nil {
		data["score"] = *sym.Score
	}
	return GraphNode{
		ID:       nodeID("symbol", sym.ID),
		Type:     "symbol",
		Label:    sym.Name,
		Subtitle: sym.FilePath,
		Data:     data,
	}
}

func shortPath(path string) string {
	path = strings.Trim(path, "/")
	if path == "" {
		return "(root)"
	}
	parts := strings.Split(path, "/")
	if len(parts) <= 2 {
		return path
	}
	return strings.Join(parts[len(parts)-2:], "/")
}

func clusterSymbols(items []embeddedSymbol, algorithm string, k int) []Cluster {
	switch algorithm {
	case "kmeans":
		return kmeansClusters(items, k)
	case "louvain-lite":
		return pathClusters(items)
	default:
		return connectedClusters(items)
	}
}

func connectedClusters(items []embeddedSymbol) []Cluster {
	if len(items) == 0 {
		return []Cluster{}
	}
	visited := map[int64]struct{}{}
	clusters := []Cluster{}
	for _, item := range items {
		if _, ok := visited[item.ID]; ok {
			continue
		}
		cluster := Cluster{ID: fmt.Sprintf("connected:%d", len(clusters)+1), Label: shortPath(item.FilePath)}
		for _, candidate := range items {
			if _, ok := visited[candidate.ID]; ok {
				continue
			}
			if candidate.FilePath == item.FilePath || watch.CosineSimilarity(item.Vector, candidate.Vector) >= 0.78 {
				visited[candidate.ID] = struct{}{}
				cluster.Members = append(cluster.Members, candidate.Symbol)
			}
		}
		cluster.Size = len(cluster.Members)
		clusters = append(clusters, cluster)
	}
	sortClusters(clusters)
	return clusters
}

func pathClusters(items []embeddedSymbol) []Cluster {
	byDir := map[string][]Symbol{}
	for _, item := range items {
		dir := item.FilePath
		if idx := strings.LastIndex(dir, "/"); idx >= 0 {
			dir = dir[:idx]
		}
		byDir[dir] = append(byDir[dir], item.Symbol)
	}
	clusters := make([]Cluster, 0, len(byDir))
	for dir, members := range byDir {
		clusters = append(clusters, Cluster{ID: "path:" + dir, Label: dir, Size: len(members), Members: members})
	}
	sortClusters(clusters)
	return clusters
}

func kmeansClusters(items []embeddedSymbol, k int) []Cluster {
	if k <= 0 {
		k = 8
	}
	if len(items) < k {
		k = len(items)
	}
	if k == 0 {
		return []Cluster{}
	}
	centroids := make([]watch.Vector, k)
	for i := range centroids {
		centroids[i] = cloneVector(items[i*len(items)/k].Vector)
	}
	assignments := make([]int, len(items))
	for iteration := 0; iteration < 8; iteration++ {
		for i, item := range items {
			assignments[i] = nearestCentroid(item.Vector, centroids)
		}
		next := make([]watch.Vector, k)
		counts := make([]int, k)
		for i, item := range items {
			slot := assignments[i]
			if next[slot] == nil {
				next[slot] = make(watch.Vector, len(item.Vector))
			}
			for dimension, value := range item.Vector {
				next[slot][dimension] += value
			}
			counts[slot]++
		}
		for i := range next {
			if counts[i] == 0 {
				next[i] = centroids[i]
				continue
			}
			scale := float32(1.0 / float64(counts[i]))
			for dimension := range next[i] {
				next[i][dimension] *= scale
			}
			normalize(next[i])
		}
		centroids = next
	}
	clusters := make([]Cluster, k)
	for i := range clusters {
		clusters[i] = Cluster{ID: fmt.Sprintf("kmeans:%d", i+1), Label: fmt.Sprintf("Cluster %d", i+1)}
	}
	for i, item := range items {
		slot := assignments[i]
		clusters[slot].Members = append(clusters[slot].Members, item.Symbol)
	}
	for i := range clusters {
		clusters[i].Size = len(clusters[i].Members)
	}
	sortClusters(clusters)
	return clusters
}

func nearestCentroid(vector watch.Vector, centroids []watch.Vector) int {
	bestIndex := 0
	bestScore := math.Inf(-1)
	for i, centroid := range centroids {
		score := watch.CosineSimilarity(vector, centroid)
		if score > bestScore {
			bestScore = score
			bestIndex = i
		}
	}
	return bestIndex
}

func cloneVector(vector watch.Vector) watch.Vector {
	out := make(watch.Vector, len(vector))
	copy(out, vector)
	return out
}

func normalize(vector watch.Vector) {
	var norm float64
	for _, value := range vector {
		norm += float64(value * value)
	}
	if norm == 0 {
		return
	}
	scale := float32(1 / math.Sqrt(norm))
	for i := range vector {
		vector[i] *= scale
	}
}

func sortClusters(clusters []Cluster) {
	sort.SliceStable(clusters, func(i, j int) bool {
		if clusters[i].Size == clusters[j].Size {
			return clusters[i].Label < clusters[j].Label
		}
		return clusters[i].Size > clusters[j].Size
	})
}
