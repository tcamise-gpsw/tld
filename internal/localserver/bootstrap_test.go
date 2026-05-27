package localserver_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
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
	"github.com/mertcikla/tld/v2/internal/localserver"
	_ "modernc.org/sqlite"
)

func TestBootstrapCreatesDatabaseAndReadyEndpoint(t *testing.T) {
	app, err := localserver.Bootstrap(t.TempDir())
	if err != nil {
		t.Fatalf("bootstrap app: %v", err)
	}

	if _, err := os.Stat(app.DBPath); err != nil {
		t.Fatalf("stat db path %s: %v", app.DBPath, err)
	}
	if got, want := filepath.Base(app.DBPath), "tld.db"; got != want {
		t.Fatalf("db filename = %q, want %q", got, want)
	}
	if !app.InitializedData {
		t.Fatal("bootstrap should report initialized data when creating a new database")
	}

	server := httptest.NewServer(app.Handler)
	defer server.Close()

	resp, err := http.Get(server.URL + "/api/ready")
	if err != nil {
		t.Fatalf("get ready endpoint: %v", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			t.Errorf("close response body: %v", closeErr)
		}
	}()

	if got, want := resp.StatusCode, http.StatusOK; got != want {
		t.Fatalf("ready status = %d, want %d", got, want)
	}

	var body struct {
		OK        bool `json:"ok"`
		Resources struct {
			Views      int `json:"views"`
			Elements   int `json:"elements"`
			Connectors int `json:"connectors"`
		} `json:"resources"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode ready response: %v", err)
	}
	if !body.OK {
		t.Fatalf("ready response ok = false")
	}
	if body.Resources.Views < 0 || body.Resources.Elements < 0 || body.Resources.Connectors < 0 {
		t.Fatalf("ready response contains negative resources: %+v", body.Resources)
	}
	if body.Resources.Views != app.Resources.Views || body.Resources.Elements != app.Resources.Elements || body.Resources.Connectors != app.Resources.Connectors {
		t.Fatalf("ready resources = %+v, want bootstrap resources %+v", body.Resources, app.Resources)
	}
}

func TestBootstrapReportsExistingDatabase(t *testing.T) {
	dir := t.TempDir()
	first, err := localserver.Bootstrap(dir)
	if err != nil {
		t.Fatalf("bootstrap first app: %v", err)
	}
	if !first.InitializedData {
		t.Fatal("first bootstrap should report initialized data")
	}

	second, err := localserver.Bootstrap(dir)
	if err != nil {
		t.Fatalf("bootstrap second app: %v", err)
	}
	if second.InitializedData {
		t.Fatal("second bootstrap should report existing data")
	}
	if second.Resources.Views < 0 || second.Resources.Elements < 0 || second.Resources.Connectors < 0 {
		t.Fatalf("second bootstrap contains negative resources: %+v", second.Resources)
	}
}

func TestBootstrapServesLegacyNullOrgRows(t *testing.T) {
	dir := t.TempDir()
	app, err := localserver.Bootstrap(dir)
	if err != nil {
		t.Fatalf("bootstrap app: %v", err)
	}

	db, err := sql.Open("sqlite", app.DBPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer func() {
		if closeErr := db.Close(); closeErr != nil {
			t.Errorf("close db: %v", closeErr)
		}
	}()
	if _, err := db.Exec(`
		INSERT INTO elements(id, name, tags, technology_connectors, created_at, updated_at)
		VALUES (10, 'API', '[]', '[]', 'now', 'now');
		INSERT INTO placements(view_id, element_id, position_x, position_y, created_at, updated_at)
		VALUES (1, 10, 0, 0, 'now', 'now');
	`); err != nil {
		t.Fatalf("seed legacy rows: %v", err)
	}

	server := httptest.NewServer(app.Handler)
	defer server.Close()

	client := diagv1connect.NewWorkspaceServiceClient(server.Client(), server.URL+"/api")
	elements, err := client.ListElements(context.Background(), connect.NewRequest(&diagv1.ListElementsRequest{}))
	if err != nil {
		t.Fatalf("list elements: %v", err)
	}
	if got := len(elements.Msg.GetElements()); got != 1 {
		t.Fatalf("elements length = %d, want 1", got)
	}

	workspace, err := client.GetWorkspace(context.Background(), connect.NewRequest(&diagv1.GetWorkspaceRequest{IncludeContent: true}))
	if err != nil {
		t.Fatalf("get workspace: %v", err)
	}
	if got := len(workspace.Msg.GetViews()); got != 1 {
		t.Fatalf("views length = %d, want 1", got)
	}
	if got := len(workspace.Msg.GetContent()); got != 1 {
		t.Fatalf("content length = %d, want 1", got)
	}
}

func TestBootstrapServesEmbeddedAppIndex(t *testing.T) {
	mockFS := fstest.MapFS{
		"frontend/dist/index.html": {Data: []byte("<!doctype html><html>app</html>")},
	}
	app, err := localserver.Bootstrap(t.TempDir(), localserver.ServeOptions{StaticFS: mockFS})
	if err != nil {
		t.Fatalf("bootstrap app: %v", err)
	}

	server := httptest.NewServer(app.Handler)
	defer server.Close()

	resp, err := http.Get(server.URL + "/")
	if err != nil {
		t.Fatalf("get root endpoint: %v", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			t.Errorf("close response body: %v", closeErr)
		}
	}()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read root response body: %v", err)
	}

	if got, want := resp.StatusCode, http.StatusOK; got != want {
		t.Fatalf("root status = %d, want %d; body=%q", got, want, string(body))
	}
	if got := resp.Header.Get("Content-Type"); !strings.Contains(got, "text/html") {
		t.Fatalf("root content-type = %q, want HTML", got)
	}
	if !strings.Contains(strings.ToLower(string(body)), "<!doctype html") {
		t.Fatalf("root response does not look like the embedded app index")
	}
}

func TestAddrFromEnvPrefersTLDAddrAndFallsBackToPort(t *testing.T) {
	t.Setenv("PORT", "9091")
	if got, want := localserver.AddrFromEnv(), "127.0.0.1:9091"; got != want {
		t.Fatalf("addr from PORT = %q, want %q", got, want)
	}

	t.Setenv("TLD_ADDR", "0.0.0.0:7000")
	if got, want := localserver.AddrFromEnv(), "0.0.0.0:7000"; got != want {
		t.Fatalf("addr from TLD_ADDR = %q, want %q", got, want)
	}
}
