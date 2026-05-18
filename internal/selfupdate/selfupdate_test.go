package selfupdate

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestIsNewerNormalizesTags(t *testing.T) {
	if !IsNewer("2.0.2", "v2.0.3") {
		t.Fatal("expected v2.0.3 to be newer than 2.0.2")
	}
	if IsNewer("2.0.3", "v2.0.3") {
		t.Fatal("same version should not be newer")
	}
	if IsNewer("2.0.3", "not-a-version") {
		t.Fatal("invalid latest version should not be newer")
	}
}

func TestCheckUsesFreshCachedState(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "update-check.json")
	if err := writeState(statePath, stateFile{
		CheckedAt:  time.Now().UTC(),
		Latest:     "v2.0.3",
		ReleaseURL: "https://github.com/Mertcikla/tld/releases/tag/v2.0.3",
		AssetName:  assetName(),
		AssetURL:   "https://example.test/tld.tar.gz",
	}); err != nil {
		t.Fatalf("write state: %v", err)
	}

	status, err := Check(context.Background(), Options{
		Current:       "2.0.2",
		CheckInterval: time.Hour,
		StatePath:     statePath,
	})
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if !status.Cached || !status.UpdateAvailable || status.Latest != "v2.0.3" {
		t.Fatalf("unexpected status: %+v", status)
	}
}

func TestCheckFetchesLatestReleaseWhenCacheIsStale(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/Mertcikla/tld/releases", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`[{"tag_name":"v2.0.4","prerelease":false,"html_url":"https://github.com/Mertcikla/tld/releases/tag/v2.0.4","assets":[{"name":"` + assetName() + `","browser_download_url":"https://example.test/asset"}]}]`))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	status, err := Check(context.Background(), Options{
		Current:       "2.0.2",
		CheckInterval: time.Hour,
		StatePath:     filepath.Join(t.TempDir(), "update-check.json"),
		HTTPClient:    server.Client(),
		APIBaseURL:    server.URL,
	})
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if !status.UpdateAvailable || status.Latest != "v2.0.4" || status.AssetURL == "" {
		t.Fatalf("unexpected status: %+v", status)
	}
}

func TestInstallDownloadUsesContextDeadline(t *testing.T) {
	name := assetName()
	if name == "" {
		t.Skip("unsupported test platform")
	}

	mux := http.NewServeMux()
	server := httptest.NewServer(mux)
	defer server.Close()

	mux.HandleFunc("/repos/Mertcikla/tld/releases", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`[{"tag_name":"v2.0.4","prerelease":false,"html_url":"https://github.com/Mertcikla/tld/releases/tag/v2.0.4","assets":[{"name":"` + name + `","browser_download_url":"` + server.URL + `/asset"}]}]`))
	})
	mux.HandleFunc("/asset", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "1024")
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-r.Context().Done()
	})

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := Install(ctx, Options{
		Current:       "2.0.2",
		CheckInterval: time.Hour,
		StatePath:     filepath.Join(t.TempDir(), "update-check.json"),
		HTTPClient:    server.Client(),
		APIBaseURL:    server.URL,
		Force:         true,
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Install() error = %v, want context deadline exceeded", err)
	}
}
