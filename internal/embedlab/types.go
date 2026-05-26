package embedlab

type Repository struct {
	ID          int64  `json:"id"`
	RepoRoot    string `json:"repo_root"`
	DisplayName string `json:"display_name"`
	Branch      string `json:"branch,omitempty"`
	HeadCommit  string `json:"head_commit,omitempty"`
	UpdatedAt   string `json:"updated_at"`
}

type Model struct {
	ID             int64  `json:"id"`
	Provider       string `json:"provider"`
	Name           string `json:"name"`
	Dimension      int    `json:"dimension"`
	ConfigHash     string `json:"config_hash"`
	EmbeddingCount int    `json:"embedding_count"`
	CreatedAt      string `json:"created_at"`
}

type Symbol struct {
	ID            int64    `json:"id"`
	EmbeddingID   int64    `json:"embedding_id,omitempty"`
	OwnerKey      string   `json:"owner_key,omitempty"`
	RepositoryID  int64    `json:"repository_id"`
	FileID        int64    `json:"file_id"`
	FilePath      string   `json:"file_path"`
	StableKey     string   `json:"stable_key"`
	Name          string   `json:"name"`
	QualifiedName string   `json:"qualified_name"`
	Kind          string   `json:"kind"`
	StartLine     int      `json:"start_line"`
	EndLine       *int     `json:"end_line,omitempty"`
	Similarity    *float64 `json:"similarity,omitempty"`
	Decision      string   `json:"decision,omitempty"`
	Reason        string   `json:"reason,omitempty"`
	Score         *float64 `json:"score,omitempty"`
	Tier          int      `json:"tier,omitempty"`
}

type SearchResult struct {
	Repository Repository `json:"repository"`
	Model      Model      `json:"model"`
	Symbols    []Symbol   `json:"symbols"`
}

type GraphNode struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Label    string         `json:"label"`
	Subtitle string         `json:"subtitle,omitempty"`
	Data     map[string]any `json:"data,omitempty"`
}

type GraphEdge struct {
	ID     string         `json:"id"`
	Source string         `json:"source"`
	Target string         `json:"target"`
	Type   string         `json:"type"`
	Label  string         `json:"label,omitempty"`
	Weight float64        `json:"weight,omitempty"`
	Data   map[string]any `json:"data,omitempty"`
}

type GraphResponse struct {
	Repository Repository  `json:"repository"`
	Model      Model       `json:"model"`
	Query      string      `json:"query,omitempty"`
	Center     *Symbol     `json:"center,omitempty"`
	Nodes      []GraphNode `json:"nodes"`
	Edges      []GraphEdge `json:"edges"`
	Neighbors  []Symbol    `json:"neighbors"`
	Stats      Stats       `json:"stats"`
}

type Stats struct {
	RepositoryID      int64          `json:"repository_id,omitempty"`
	ModelID           int64          `json:"model_id,omitempty"`
	FileCount         int            `json:"file_count"`
	SymbolCount       int            `json:"symbol_count"`
	EmbeddedCount     int            `json:"embedded_count"`
	ReferenceCount    int            `json:"reference_count"`
	VisibleCount      int            `json:"visible_count"`
	HiddenCount       int            `json:"hidden_count"`
	DecisionCounts    map[string]int `json:"decision_counts,omitempty"`
	ScoreDistribution map[string]int `json:"score_distribution,omitempty"`
	TopFiles          []StatItem     `json:"top_files,omitempty"`
	TopKinds          []StatItem     `json:"top_kinds,omitempty"`
	ClusterSizes      []StatItem     `json:"cluster_sizes,omitempty"`
}

type StatItem struct {
	Label string  `json:"label"`
	Count int     `json:"count,omitempty"`
	Score float64 `json:"score,omitempty"`
}

type ClusterResponse struct {
	Repository Repository `json:"repository"`
	Model      Model      `json:"model"`
	Algorithm  string     `json:"algorithm"`
	Clusters   []Cluster  `json:"clusters"`
}

type Cluster struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Size    int      `json:"size"`
	Members []Symbol `json:"members"`
}
