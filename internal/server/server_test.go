package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	diagv1connect "buf.build/gen/go/tldiagramcom/diagram/connectrpc/go/diag/v1/diagv1connect"
	diagv1 "buf.build/gen/go/tldiagramcom/diagram/protocolbuffers/go/diag/v1"
	"connectrpc.com/connect"
	"github.com/google/uuid"
	assets "github.com/mertcikla/tld/v2"
	localstore "github.com/mertcikla/tld/v2/internal/store"
	"github.com/mertcikla/tld/v2/internal/watch"
)

func TestServerReadyReportsResourceCounts(t *testing.T) {
	sqliteStore, routes := newTestServer(t, uuid.MustParse("11111111-2222-3333-4444-555555555555"), nil)
	if _, err := sqliteStore.DB().Exec(`
		INSERT INTO elements(id, name, tags, technology_connectors, created_at, updated_at)
		VALUES
			(10, 'API', '[]', '[]', 'now', 'now'),
			(11, 'DB', '[]', '[]', 'now', 'now');
		INSERT INTO connectors(view_id, source_element_id, target_element_id, direction, style, created_at, updated_at)
		VALUES (1, 10, 11, 'forward', 'solid', 'now', 'now');
	`); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/ready", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body struct {
		OK        bool `json:"ok"`
		Resources struct {
			Views      int `json:"views"`
			Elements   int `json:"elements"`
			Connectors int `json:"connectors"`
		} `json:"resources"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.Resources.Views != 1 || body.Resources.Elements != 2 || body.Resources.Connectors != 1 {
		t.Fatalf("ready body = %+v, want 1/2/1 resources", body)
	}
}

func TestServerAllowsVSCodeWebviewCORSPreflight(t *testing.T) {
	_, routes := newTestServer(t, uuid.New(), nil)
	req := httptest.NewRequest(http.MethodOptions, "/api/diag.v1.WorkspaceService/ListViews", nil)
	req.Header.Set("Origin", "vscode-webview://abc123")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "content-type,connect-protocol-version,x-user-agent")
	req.Header.Set("Access-Control-Request-Private-Network", "true")

	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "vscode-webview://abc123" {
		t.Fatalf("allow origin = %q, want vscode webview origin", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("allow credentials = %q, want true", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(strings.ToLower(got), "connect-protocol-version") {
		t.Fatalf("allow headers = %q, want connect-protocol-version", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(strings.ToLower(got), "x-user-agent") {
		t.Fatalf("allow headers = %q, want requested x-user-agent reflected", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Private-Network"); got != "true" {
		t.Fatalf("allow private network = %q, want true", got)
	}
}

func TestServerAllowsVSCodeFileOrigin(t *testing.T) {
	_, routes := newTestServer(t, uuid.New(), nil)
	req := httptest.NewRequest(http.MethodOptions, "/api/diag.v1.WorkspaceService/ListViews", nil)
	req.Header.Set("Origin", "vscode-file://vscode-app")
	req.Header.Set("Access-Control-Request-Method", "POST")

	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "vscode-file://vscode-app" {
		t.Fatalf("allow origin = %q, want vscode-file origin", got)
	}
}

func TestServerRejectsNonLocalCORSOrigin(t *testing.T) {
	_, routes := newTestServer(t, uuid.New(), nil)
	req := httptest.NewRequest(http.MethodGet, "/api/ready", nil)
	req.Header.Set("Origin", "https://example.com")

	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("allow origin = %q, want empty for non-local origin", got)
	}
}

func TestServerOrgTagColorsRoundTrip(t *testing.T) {
	_, routes := newTestServer(t, uuid.MustParse("11111111-2222-3333-4444-555555555555"), nil)
	server := httptest.NewServer(routes)
	defer server.Close()

	client := diagv1connect.NewOrgServiceClient(http.DefaultClient, server.URL+"/api")
	description := "User managed color"
	if _, err := client.UpdateTag(context.Background(), connect.NewRequest(&diagv1.UpdateTagRequest{
		Tag:         "role:watch",
		Color:       "#123456",
		Description: &description,
	})); err != nil {
		t.Fatal(err)
	}
	resp, err := client.ListTagColors(context.Background(), connect.NewRequest(&diagv1.ListTagColorsRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	tag := resp.Msg.GetTags()["role:watch"]
	if tag == nil || tag.GetColor() != "#123456" || tag.Description == nil || tag.GetDescription() != description {
		t.Fatalf("tag = %+v, want persisted color and description", tag)
	}
}

func TestServerInjectsWorkspaceIDIntoConnectRPCResponses(t *testing.T) {
	workspaceID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	sqliteStore, routes := newTestServer(t, workspaceID, nil)
	if _, err := sqliteStore.DB().Exec(`
		INSERT INTO elements(id, name, tags, technology_connectors, created_at, updated_at)
		VALUES (10, 'API', '[]', '[]', 'now', 'now');
	`); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(routes)
	t.Cleanup(srv.Close)

	client := diagv1connect.NewWorkspaceServiceClient(srv.Client(), srv.URL+"/api")
	resp, err := client.ListElements(context.Background(), connect.NewRequest(&diagv1.ListElementsRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Msg.GetElements()) != 1 {
		t.Fatalf("elements = %+v, want one element", resp.Msg.GetElements())
	}
	if got := resp.Msg.GetElements()[0].GetOrgId(); got != workspaceID.String() {
		t.Fatalf("org id = %q, want %s", got, workspaceID)
	}
}

func TestWatchSessionLeaseDoesNotBlockWorkspaceWrites(t *testing.T) {
	sqliteStore, routes := newTestServer(t, uuid.New(), nil)
	repositoryID := insertWatchRepository(t, sqliteStore.DB())
	watchStore := watch.NewStore(sqliteStore.DB())
	if _, err := watchStore.AcquireLock(context.Background(), repositoryID, os.Getpid(), "session-token", watch.LockHeartbeatTimeout); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(routes)
	t.Cleanup(srv.Close)

	client := diagv1connect.NewWorkspaceServiceClient(srv.Client(), srv.URL+"/api")
	resp, err := client.CreateElement(context.Background(), connect.NewRequest(&diagv1.CreateElementRequest{Name: "Manual"}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Msg.GetElement().GetName() != "Manual" {
		t.Fatalf("created element = %+v", resp.Msg.GetElement())
	}
}

func TestWatchApplyLeaseBlocksWorkspaceWrites(t *testing.T) {
	sqliteStore, routes := newTestServer(t, uuid.New(), nil)
	repositoryID := insertWatchRepository(t, sqliteStore.DB())
	watchStore := watch.NewStore(sqliteStore.DB())
	if err := watchStore.AcquireApplyLock(context.Background(), repositoryID, os.Getpid(), "apply-token", watch.LockHeartbeatTimeout); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(routes)
	t.Cleanup(srv.Close)

	client := diagv1connect.NewWorkspaceServiceClient(srv.Client(), srv.URL+"/api")
	_, err := client.CreateElement(context.Background(), connect.NewRequest(&diagv1.CreateElementRequest{Name: "Manual"}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("code = %s, want failed_precondition: %v", code, err)
	}
	if err := watchStore.ReleaseApplyLock(context.Background(), repositoryID, "apply-token"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.CreateElement(context.Background(), connect.NewRequest(&diagv1.CreateElementRequest{Name: "Manual"})); err != nil {
		t.Fatal(err)
	}
}

func TestServerRoutesThumbnailAndStaticFallback(t *testing.T) {
	_, routes := newTestServer(t, uuid.New(), fstest.MapFS{
		"frontend/dist/index.html": {Data: []byte("<html>app</html>")},
		"frontend/dist/app.js":     {Data: []byte("console.log('app')")},
	})

	tests := []struct {
		name        string
		path        string
		wantStatus  int
		wantType    string
		wantBodySub string
	}{
		{
			name:        "root thumbnail",
			path:        "/api/views/1/thumbnail.svg",
			wantStatus:  http.StatusOK,
			wantType:    "image/svg+xml; charset=utf-8",
			wantBodySub: "<svg",
		},
		{
			name:        "invalid thumbnail id",
			path:        "/api/views/not-a-number/thumbnail.svg",
			wantStatus:  http.StatusBadRequest,
			wantBodySub: "invalid view id",
		},
		{
			name:        "static file",
			path:        "/app.js",
			wantStatus:  http.StatusOK,
			wantType:    "application/javascript",
			wantBodySub: "console.log",
		},
		{
			name:        "spa fallback",
			path:        "/views/123",
			wantStatus:  http.StatusOK,
			wantType:    "text/html; charset=utf-8",
			wantBodySub: "app",
		},
		{
			name:       "unknown api route",
			path:       "/api/not-real",
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			routes.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tt.path, nil))
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if tt.wantType != "" && rec.Header().Get("Content-Type") != tt.wantType {
				t.Fatalf("content type = %q, want %q", rec.Header().Get("Content-Type"), tt.wantType)
			}
			if tt.wantBodySub != "" && !strings.Contains(rec.Body.String(), tt.wantBodySub) {
				t.Fatalf("body = %q, want substring %q", rec.Body.String(), tt.wantBodySub)
			}
		})
	}
}

func TestServerServesPrecompressedStaticAssets(t *testing.T) {
	_, routes := newTestServer(t, uuid.New(), fstest.MapFS{
		"frontend/dist/index.html":    {Data: []byte("<html>app</html>")},
		"frontend/dist/index.html.gz": {Data: []byte("gzip-index")},
		"frontend/dist/index.html.br": {Data: []byte("brotli-index")},
		"frontend/dist/app.js":        {Data: []byte("console.log('app')")},
		"frontend/dist/app.js.gz":     {Data: []byte("gzip-js")},
		"frontend/dist/app.js.br":     {Data: []byte("brotli-js")},
	})

	tests := []struct {
		name           string
		path           string
		acceptEncoding string
		wantEncoding   string
		wantBody       string
	}{
		{
			name:           "brotli is preferred",
			path:           "/app.js",
			acceptEncoding: "gzip, br",
			wantEncoding:   "br",
			wantBody:       "brotli-js",
		},
		{
			name:           "gzip is used when brotli is unavailable",
			path:           "/app.js",
			acceptEncoding: "gzip",
			wantEncoding:   "gzip",
			wantBody:       "gzip-js",
		},
		{
			name:     "uncompressed file is used without accepted encoding",
			path:     "/app.js",
			wantBody: "console.log('app')",
		},
		{
			name:           "spa fallback can use compressed index",
			path:           "/views/123",
			acceptEncoding: "br",
			wantEncoding:   "br",
			wantBody:       "brotli-index",
		},
		{
			name:           "q zero disables encoding",
			path:           "/app.js",
			acceptEncoding: "br;q=0, gzip;q=0",
			wantBody:       "console.log('app')",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			if tt.acceptEncoding != "" {
				req.Header.Set("Accept-Encoding", tt.acceptEncoding)
			}
			rec := httptest.NewRecorder()
			routes.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
			if got := rec.Header().Get("Content-Encoding"); got != tt.wantEncoding {
				t.Fatalf("content encoding = %q, want %q", got, tt.wantEncoding)
			}
			if got := rec.Header().Get("Content-Type"); got != "application/javascript" && tt.path == "/app.js" {
				t.Fatalf("content type = %q, want application/javascript", got)
			}
			if got := rec.Body.String(); got != tt.wantBody {
				t.Fatalf("body = %q, want %q", got, tt.wantBody)
			}
			if !strings.Contains(rec.Header().Get("Vary"), "Accept-Encoding") {
				t.Fatalf("vary = %q, want Accept-Encoding", rec.Header().Get("Vary"))
			}
		})
	}
}

func TestPopulateScoreGateAllowsLexicallyAnchoredJinaMatches(t *testing.T) {
	tests := []struct {
		name             string
		finalScore       float64
		lexicalPathScore float64
		want             bool
	}{
		{
			name:             "legacy high score passes",
			finalScore:       0.35,
			lexicalPathScore: 0,
			want:             true,
		},
		{
			name:             "jina lexical match passes",
			finalScore:       0.284,
			lexicalPathScore: 0.40,
			want:             true,
		},
		{
			name:             "jina semantic-only weak match stays hidden",
			finalScore:       0.265,
			lexicalPathScore: 0,
			want:             false,
		},
		{
			name:             "lexical match still needs evidence",
			finalScore:       0.249,
			lexicalPathScore: 0.40,
			want:             false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := passesPopulateScoreGate(tt.finalScore, tt.lexicalPathScore)
			if got != tt.want {
				t.Fatalf("passesPopulateScoreGate(%v, %v) = %v, want %v", tt.finalScore, tt.lexicalPathScore, got, tt.want)
			}
		})
	}
}

func TestPopulateQueryEnrichmentAddsArchitectureHints(t *testing.T) {
	tests := []struct {
		query string
		want  []string
	}{
		{query: "frontend", want: []string{"web app", "ui", "client"}},
		{query: "backend", want: []string{"backend service", "api service", "server"}},
		{query: "cli", want: []string{"cli", "command"}},
		{query: "websocket", want: []string{"real time service", "websocket"}},
		{query: "panel", want: []string{"panel"}},
		{query: "watch", want: []string{"watch service", "scanner"}},
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			sqliteStore, _ := newTestServer(t, uuid.New(), nil)
			if _, err := sqliteStore.DB().Exec(`
				INSERT INTO views(id, name, created_at, updated_at)
				VALUES (20, ?, 'now', 'now')`, tt.query); err != nil {
				t.Fatal(err)
			}
			got, err := buildPopulateQuery(context.Background(), sqliteStore.DB(), 20, "")
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(got.Enriched, tt.query) {
				t.Fatalf("enriched query %q should preserve user term %q", got.Enriched, tt.query)
			}
			for _, want := range tt.want {
				if !strings.Contains(got.Enriched, want) {
					t.Fatalf("enriched query %q missing hint %q", got.Enriched, want)
				}
			}
		})
	}
}

func TestPopulatePrefersHighAbstractionCandidates(t *testing.T) {
	sqliteStore, routes := newTestServer(t, uuid.New(), nil)
	repoID := insertWatchRepository(t, sqliteStore.DB())
	if _, err := sqliteStore.DB().Exec(`
		INSERT INTO views(id, name, created_at, updated_at)
		VALUES (20, 'frontend', 'now', 'now');
		INSERT INTO elements(id, name, kind, tags, technology_connectors, file_path, created_at, updated_at)
		VALUES
			(100, 'frontend', 'folder', '["role:ui"]', '[]', 'frontend', 'now', 'now'),
			(101, 'index.tsx', 'file', '["role:ui"]', '[]', 'frontend/src/index.tsx', 'now', 'now'),
			(102, 'Frontend App', 'architecture-component', '["role:ui"]', '[]', 'frontend', 'now', 'now');
		INSERT INTO watch_materialization(repository_id, owner_type, owner_key, resource_type, resource_id, created_at, updated_at)
		VALUES
			(?, 'folder', 'folder:frontend', 'element', 100, 'now', 'now'),
			(?, 'file', 'file:frontend/src/index.tsx', 'element', 101, 'now', 'now'),
			(?, 'architecture-component', 'component:frontend', 'element', 102, 'now', 'now')`,
		repoID, repoID, repoID); err != nil {
		t.Fatal(err)
	}

	results := requestPopulateResults(t, routes, "/api/views/20/populate?q=frontend&limit=10")
	if len(results) == 0 {
		t.Fatal("expected populate results")
	}
	for _, result := range results {
		if result.Kind != "file" {
			return
		}
	}
	t.Fatalf("expected at least one high-abstraction result, got %+v", results)
}

func TestPopulateFallsBackToFilesAndExcludesPlaced(t *testing.T) {
	sqliteStore, routes := newTestServer(t, uuid.New(), nil)
	repoID := insertWatchRepository(t, sqliteStore.DB())
	if _, err := sqliteStore.DB().Exec(`
		INSERT INTO views(id, name, created_at, updated_at)
		VALUES (20, 'websocket', 'now', 'now');
		INSERT INTO elements(id, name, kind, tags, technology_connectors, file_path, created_at, updated_at)
		VALUES
			(100, 'websocket.go', 'file', '["role:watch"]', '[]', 'internal/watch/websocket.go', 'now', 'now'),
			(101, 'placed-websocket.go', 'file', '["role:watch"]', '[]', 'internal/watch/placed-websocket.go', 'now', 'now');
		INSERT INTO placements(view_id, element_id, position_x, position_y, created_at, updated_at)
		VALUES (20, 101, 0, 0, 'now', 'now');
		INSERT INTO watch_materialization(repository_id, owner_type, owner_key, resource_type, resource_id, created_at, updated_at)
		VALUES
			(?, 'file', 'file:internal/watch/websocket.go', 'element', 100, 'now', 'now'),
			(?, 'file', 'file:internal/watch/placed-websocket.go', 'element', 101, 'now', 'now')`,
		repoID, repoID); err != nil {
		t.Fatal(err)
	}

	results := requestPopulateResults(t, routes, "/api/views/20/populate?q=websocket&limit=10")
	if len(results) != 1 {
		t.Fatalf("results = %+v, want only unplaced file fallback", results)
	}
	if results[0].ID != 100 || results[0].Kind != "file" {
		t.Fatalf("result = %+v, want unplaced file 100", results[0])
	}
}

func TestPopulateLexicalScoreIgnoresContextHints(t *testing.T) {
	kind := "folder"
	tags := json.RawMessage(`["role:persistence"]`)
	workspacePath := "internal/workspace"
	storePath := "internal/store/sqlite"
	query := populateQuery{
		Base:     "database sqlite",
		ViewName: "Architecture",
		Hints:    []string{"workspace", "local", "repository"},
	}
	candidates := []populateCandidate{
		{
			element: populateElementResult{
				ID:       1,
				Name:     "workspace",
				Kind:     &kind,
				FilePath: &workspacePath,
				Tags:     json.RawMessage(`["role:config"]`),
			},
		},
		{
			element: populateElementResult{
				ID:       2,
				Name:     "sqlite store",
				Kind:     &kind,
				FilePath: &storePath,
				Tags:     tags,
			},
		},
	}

	scored := scorePopulateCandidates(query, candidates, nil)
	if scored[0].lexicalPathScore >= scored[1].lexicalPathScore {
		t.Fatalf("context hint contaminated lexical score: workspace=%.2f store=%.2f", scored[0].lexicalPathScore, scored[1].lexicalPathScore)
	}
}

func TestPopulatePenalizesSparseFolderMatches(t *testing.T) {
	folderKind := "folder"
	fileKind := "file"
	folderPath := "src/billing"
	filePath := "src/billing/BillingHandler.ts"
	query := populateQuery{Base: "billing api", ViewName: "Architecture"}
	children := []populateChildCandidate{
		{name: "BillingHandler", kind: "file", filePath: "src/billing/BillingHandler.ts", hasEmbedding: true, embeddingScore: 0.80},
		{name: "BillingRoutes", kind: "file", filePath: "src/billing/BillingRoutes.ts", hasEmbedding: true, embeddingScore: 0.80},
		{name: "Currency", kind: "file", filePath: "src/shared/Currency.ts"},
		{name: "Invoice", kind: "file", filePath: "src/accounting/Invoice.ts"},
		{name: "Tax", kind: "file", filePath: "src/shared/Tax.ts"},
		{name: "Discount", kind: "file", filePath: "src/promotions/Discount.ts"},
		{name: "Address", kind: "file", filePath: "src/customers/Address.ts"},
		{name: "Clock", kind: "file", filePath: "src/platform/Clock.ts"},
	}
	candidates := []populateCandidate{
		{
			element:        populateElementResult{ID: 1, Name: "billing", Kind: &folderKind, FilePath: &folderPath},
			children:       children,
			embeddingScore: 0.50,
			hasEmbedding:   true,
		},
		{
			element:        populateElementResult{ID: 2, Name: "BillingHandler", Kind: &fileKind, FilePath: &filePath},
			embeddingScore: 0.50,
			hasEmbedding:   true,
		},
	}

	scored := scorePopulateCandidates(query, candidates, nil)
	if scored[0].finalScore >= scored[1].finalScore {
		t.Fatalf("sparse folder score %.3f should be below concrete file %.3f; folder reason: %s", scored[0].finalScore, scored[1].finalScore, scored[0].element.MatchReason)
	}
}

func TestPopulateRewardsBroadFolderMatches(t *testing.T) {
	folderKind := "folder"
	fileKind := "file"
	folderPath := "src/billing/api"
	filePath := "src/billing/BillingHandler.ts"
	query := populateQuery{Base: "billing api", ViewName: "Architecture"}
	children := []populateChildCandidate{
		{name: "BillingHandler", kind: "file", filePath: "src/billing/api/BillingHandler.ts", hasEmbedding: true, embeddingScore: 0.80},
		{name: "BillingRoutes", kind: "file", filePath: "src/billing/api/BillingRoutes.ts", hasEmbedding: true, embeddingScore: 0.80},
		{name: "BillingController", kind: "file", filePath: "src/billing/api/BillingController.ts", hasEmbedding: true, embeddingScore: 0.80},
		{name: "BillingRequest", kind: "file", filePath: "src/billing/api/BillingRequest.ts", hasEmbedding: true, embeddingScore: 0.80},
		{name: "BillingResponse", kind: "file", filePath: "src/billing/api/BillingResponse.ts", hasEmbedding: true, embeddingScore: 0.80},
	}
	candidates := []populateCandidate{
		{
			element:        populateElementResult{ID: 1, Name: "billing api", Kind: &folderKind, FilePath: &folderPath},
			children:       children,
			embeddingScore: 0.50,
			hasEmbedding:   true,
		},
		{
			element:        populateElementResult{ID: 2, Name: "BillingHandler", Kind: &fileKind, FilePath: &filePath},
			embeddingScore: 0.50,
			hasEmbedding:   true,
		},
	}

	scored := scorePopulateCandidates(query, candidates, nil)
	if scored[0].finalScore <= scored[1].finalScore {
		t.Fatalf("broadly matching folder score %.3f should beat concrete file %.3f; folder reason: %s", scored[0].finalScore, scored[1].finalScore, scored[0].element.MatchReason)
	}
}

type populateResultForTest struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

func requestPopulateResults(t *testing.T, routes http.Handler, path string) []populateResultForTest {
	t.Helper()
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Results []populateResultForTest `json:"results"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body.Results
}

func insertWatchRepository(t *testing.T, db interface {
	Exec(string, ...any) (sql.Result, error)
}) int64 {
	t.Helper()
	res, err := db.Exec(`
		INSERT INTO watch_repositories(remote_url, repo_root, display_name, branch, head_commit, identity_status, settings_hash, created_at, updated_at)
		VALUES ('local', ?, 'repo', 'main', '', 'clean', '', 'now', 'now')`, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func newTestServer(t *testing.T, workspaceID uuid.UUID, static fs.FS) (*localstore.SQLiteStore, http.Handler) {
	t.Helper()
	t.Setenv("DEV", "")
	if static == nil {
		static = fstest.MapFS{"frontend/dist/index.html": {Data: []byte("<html>app</html>")}}
	}
	sqliteStore, err := localstore.Open(filepath.Join(t.TempDir(), "tld.db"), assets.FS)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqliteStore.Legacy().Close() })
	srv, err := New(sqliteStore, static, workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	return sqliteStore, srv.Routes()
}
