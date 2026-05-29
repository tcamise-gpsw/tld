package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	cmdversion "github.com/mertcikla/tld/v2/cmd/version"
	"github.com/mertcikla/tld/v2/internal/selfupdate"
)

const desktopUpdateAssetEnv = "TLD_DESKTOP_UPDATE_ASSET"

func runDesktopUpdateCommand(args []string, stdout io.Writer) (bool, error) {
	if !hasDesktopUpdateCommand(args) {
		return false, nil
	}

	fs := flag.NewFlagSet("desktop-update-test", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	test := fs.Bool("desktop-update-test", false, "")
	e2e := fs.Bool("desktop-update-e2e", false, "")
	assetPath := fs.String("desktop-update-asset", os.Getenv(desktopUpdateAssetEnv), "")
	if err := fs.Parse(args[1:]); err != nil {
		return true, err
	}
	if *test == *e2e {
		return true, errors.New("specify exactly one of --desktop-update-test or --desktop-update-e2e")
	}
	if *test {
		if err := runDesktopUpdateTest(); err != nil {
			return true, err
		}
		_, _ = fmt.Fprintln(stdout, "desktop update test ok")
		return true, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := runDesktopUpdateE2E(ctx, *assetPath); err != nil {
		return true, err
	}
	_, _ = fmt.Fprintln(stdout, "desktop update e2e ok")
	return true, nil
}

func hasDesktopUpdateCommand(args []string) bool {
	for _, arg := range args[1:] {
		switch arg {
		case "--desktop-update-test", "--desktop-update-e2e":
			return true
		}
	}
	return false
}

func runDesktopUpdateTest() error {
	assetName, supported := desktopAssetName(runtime.GOOS, runtime.GOARCH)
	if !supported {
		return fmt.Errorf("desktop updates are not available for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	if strings.TrimSpace(assetName) == "" {
		return errors.New("desktop update asset name is empty")
	}
	if strings.TrimSpace(cmdversion.Version) == "" {
		return errors.New("desktop app version is empty")
	}
	if runtime.GOOS == "darwin" {
		if _, err := currentAppBundle(); err != nil {
			return err
		}
	}
	return nil
}

func runDesktopUpdateE2E(ctx context.Context, assetPath string) error {
	if err := runDesktopUpdateTest(); err != nil {
		return err
	}
	if strings.TrimSpace(assetPath) == "" {
		return fmt.Errorf("--desktop-update-asset or %s is required", desktopUpdateAssetEnv)
	}
	assetPath, err := filepath.Abs(assetPath)
	if err != nil {
		return err
	}
	info, err := os.Stat(assetPath)
	if err != nil {
		return err
	}
	if info.Size() == 0 {
		return fmt.Errorf("desktop update asset is empty: %s", assetPath)
	}

	assetName, _ := desktopAssetName(runtime.GOOS, runtime.GOARCH)
	if filepath.Base(assetPath) != assetName {
		return fmt.Errorf("desktop update asset basename = %q, want %q", filepath.Base(assetPath), assetName)
	}

	server := fakeDesktopReleaseServer(assetName, assetPath)
	defer server.Close()

	status, err := selfupdate.Check(ctx, selfupdate.Options{
		Current:       "0.0.0",
		AssetName:     assetName,
		CheckInterval: time.Hour,
		StatePath:     filepath.Join(os.TempDir(), fmt.Sprintf("tld-desktop-update-e2e-%d.json", os.Getpid())),
		APIBaseURL:    server.URL,
		Force:         true,
	})
	if err != nil {
		return err
	}
	if !status.UpdateAvailable {
		return fmt.Errorf("fake release did not report an update: %+v", status)
	}
	if status.AssetName != assetName || status.AssetURL == "" {
		return fmt.Errorf("fake release selected asset %q url %q, want %q with a download URL", status.AssetName, status.AssetURL, assetName)
	}

	downloaded, err := downloadDesktopUpdate(ctx, status)
	if err != nil {
		return err
	}
	return validateDesktopUpdateAsset(ctx, downloaded)
}

func fakeDesktopReleaseServer(assetName, assetPath string) *httptest.Server {
	mux := http.NewServeMux()
	var server *httptest.Server
	mux.HandleFunc("/repos/Mertcikla/tld/releases", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		payload := []map[string]any{
			{
				"tag_name":   "v999.0.0",
				"prerelease": false,
				"html_url":   server.URL + "/release",
				"assets": []map[string]string{
					{
						"name":                 assetName,
						"browser_download_url": server.URL + "/assets/" + assetName,
					},
				},
			},
		}
		_ = json.NewEncoder(w).Encode(payload)
	})
	mux.HandleFunc("/assets/"+assetName, func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, assetPath)
	})
	server = httptest.NewServer(mux)
	return server
}

func validateDesktopUpdateAsset(ctx context.Context, assetPath string) error {
	switch runtime.GOOS {
	case "darwin":
		return validateMacDesktopUpdateAsset(ctx, assetPath)
	case "windows":
		return validateWindowsDesktopUpdateAsset(assetPath)
	default:
		return fmt.Errorf("desktop updates are not available for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
}

func validateMacDesktopUpdateAsset(ctx context.Context, assetPath string) error {
	if !strings.EqualFold(filepath.Ext(assetPath), ".zip") {
		return fmt.Errorf("macOS desktop update asset must be a zip: %s", filepath.Base(assetPath))
	}
	extractDir, err := os.MkdirTemp("", "tld-desktop-update-e2e-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.RemoveAll(extractDir) }()

	cmd := exec.CommandContext(ctx, "ditto", "-x", "-k", assetPath, extractDir)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("extract desktop update asset: %w: %s", err, strings.TrimSpace(string(out)))
	}
	appPath, err := findExtractedAppBundle(extractDir)
	if err != nil {
		return err
	}
	exePath := filepath.Join(appPath, "Contents", "MacOS", "tld")
	if info, err := os.Stat(exePath); err != nil {
		return err
	} else if info.IsDir() {
		return fmt.Errorf("macOS desktop update executable is a directory: %s", exePath)
	}

	test := exec.CommandContext(ctx, exePath, "--desktop-update-test")
	if out, err := test.CombinedOutput(); err != nil {
		return fmt.Errorf("run extracted desktop app test: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func validateWindowsDesktopUpdateAsset(assetPath string) error {
	if !strings.EqualFold(filepath.Ext(assetPath), ".exe") {
		return fmt.Errorf("windows desktop update asset must be an exe: %s", filepath.Base(assetPath))
	}
	file, err := os.Open(assetPath)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()

	header := make([]byte, 2)
	if _, err := io.ReadFull(file, header); err != nil {
		return err
	}
	if string(header) != "MZ" {
		return fmt.Errorf("windows desktop update asset does not look like an executable: %s", filepath.Base(assetPath))
	}
	return nil
}
