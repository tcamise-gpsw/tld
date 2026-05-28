package selfupdate

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/mertcikla/tld/v2/internal/term"
	"golang.org/x/mod/semver"
)

const (
	DefaultRepo           = "Mertcikla/tld"
	DefaultCheckInterval  = 24 * time.Hour
	DefaultCheckTimeout   = 3 * time.Second
	DefaultInstallTimeout = 30 * time.Minute
	// defaultHTTPTimeout is set to 0 to rely on context timeouts.
	defaultHTTPTimeout = 0
)

type Options struct {
	Repo           string
	Current        string
	CheckInterval  time.Duration
	StatePath      string
	HTTPClient     *http.Client
	APIBaseURL     string
	Force          bool
	ProgressWriter io.Writer
}

type Status struct {
	Checked         bool
	Current         string
	Latest          string
	UpdateAvailable bool
	ReleaseURL      string
	AssetName       string
	AssetURL        string
	Cached          bool
}

type releaseInfo struct {
	TagName    string `json:"tag_name"`
	HTMLURL    string `json:"html_url"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

type stateFile struct {
	CheckedAt  time.Time `json:"checked_at"`
	Latest     string    `json:"latest"`
	ReleaseURL string    `json:"release_url"`
	AssetName  string    `json:"asset_name"`
	AssetURL   string    `json:"asset_url"`
}

func Check(ctx context.Context, opts Options) (Status, error) {
	opts = normalizeOptions(opts)
	status := Status{Current: opts.Current}
	if shouldSkipVersion(opts.Current) {
		return status, nil
	}
	if !opts.Force {
		if cached, ok := readFreshState(opts.StatePath, opts.CheckInterval); ok {
			status.Checked = true
			status.Latest = cached.Latest
			status.ReleaseURL = cached.ReleaseURL
			status.AssetName = cached.AssetName
			status.AssetURL = cached.AssetURL
			status.Cached = true
			status.UpdateAvailable = IsNewer(opts.Current, cached.Latest)
			return status, nil
		}
	}

	release, err := fetchLatest(ctx, opts)
	if err != nil {
		return status, err
	}
	status.Checked = true
	status.Latest = release.TagName
	status.ReleaseURL = release.HTMLURL
	status.UpdateAvailable = IsNewer(opts.Current, release.TagName)
	if assetName := assetName(); assetName != "" {
		for _, asset := range release.Assets {
			if asset.Name == assetName {
				status.AssetName = asset.Name
				status.AssetURL = asset.BrowserDownloadURL
				break
			}
		}
	}
	_ = writeState(opts.StatePath, stateFile{
		CheckedAt:  time.Now().UTC(),
		Latest:     status.Latest,
		ReleaseURL: status.ReleaseURL,
		AssetName:  status.AssetName,
		AssetURL:   status.AssetURL,
	})
	return status, nil
}

func Install(ctx context.Context, opts Options) (Status, error) {
	opts = normalizeOptions(opts)
	status, err := Check(ctx, opts)
	if err != nil {
		return status, err
	}
	if !status.UpdateAvailable {
		return status, nil
	}
	if status.AssetURL == "" {
		return status, fmt.Errorf("release %s does not include an asset for %s/%s", status.Latest, runtime.GOOS, runtime.GOARCH)
	}
	client := opts.HTTPClient
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, status.AssetURL, nil)
	if err != nil {
		return status, err
	}
	req.Header.Set("User-Agent", "tld-self-update")
	resp, err := client.Do(req)
	if err != nil {
		return status, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return status, fmt.Errorf("download %s: status %d", status.AssetName, resp.StatusCode)
	}

	tmpDir, err := os.MkdirTemp("", "tld-self-update-*")
	if err != nil {
		return status, err
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()
	archivePath := filepath.Join(tmpDir, status.AssetName)
	archive, err := os.Create(archivePath)
	if err != nil {
		return status, err
	}
	var src io.Reader = resp.Body
	var progress io.Writer
	if opts.ProgressWriter != nil && resp.ContentLength > 0 {
		progress = term.NewByteProgressWriter(opts.ProgressWriter, resp.ContentLength, "Downloading")
		src = io.TeeReader(resp.Body, progress)
	}
	if _, err := io.Copy(archive, src); err != nil {
		closeProgress(progress)
		_ = archive.Close()
		return status, err
	}
	closeProgress(progress)
	if err := archive.Close(); err != nil {
		return status, err
	}

	binaryPath, err := extractBinary(archivePath, tmpDir)
	if err != nil {
		return status, err
	}
	exe, err := os.Executable()
	if err != nil {
		return status, err
	}
	if err := replaceExecutable(exe, binaryPath); err != nil {
		return status, err
	}
	_ = writeState(opts.StatePath, stateFile{
		CheckedAt:  time.Now().UTC(),
		Latest:     status.Latest,
		ReleaseURL: status.ReleaseURL,
		AssetName:  status.AssetName,
		AssetURL:   status.AssetURL,
	})
	return status, nil
}

func closeProgress(w io.Writer) {
	if closer, ok := w.(interface{ Close() error }); ok {
		_ = closer.Close()
	}
}

func IsNewer(current, latest string) bool {
	current = normalizeVersion(current)
	latest = normalizeVersion(latest)
	if current == "" || latest == "" {
		return false
	}
	return semver.Compare(latest, current) > 0
}

func normalizeOptions(opts Options) Options {
	if opts.Repo == "" {
		opts.Repo = DefaultRepo
	}
	if opts.CheckInterval <= 0 {
		opts.CheckInterval = DefaultCheckInterval
	}
	if opts.HTTPClient == nil {
		opts.HTTPClient = &http.Client{Timeout: defaultHTTPTimeout}
	}
	if opts.APIBaseURL == "" {
		opts.APIBaseURL = "https://api.github.com"
	}
	return opts
}

func fetchLatest(ctx context.Context, opts Options) (releaseInfo, error) {
	url := strings.TrimRight(opts.APIBaseURL, "/") + "/repos/" + opts.Repo + "/releases"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return releaseInfo{}, err
	}
	req.Header.Set("User-Agent", "tld-self-update")
	resp, err := opts.HTTPClient.Do(req)
	if err != nil {
		return releaseInfo{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return releaseInfo{}, fmt.Errorf("releases status %d", resp.StatusCode)
	}
	var releases []releaseInfo
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return releaseInfo{}, err
	}

	for _, release := range releases {
		if release.Prerelease {
			continue
		}
		tag := strings.TrimSpace(release.TagName)
		if tag == "" {
			continue
		}

		// Skip if it contains beta, alpha, or rc
		lowerTag := strings.ToLower(tag)
		if strings.Contains(lowerTag, "beta") || strings.Contains(lowerTag, "alpha") || strings.Contains(lowerTag, "rc") {
			continue
		}

		return release, nil
	}

	return releaseInfo{}, errors.New("no stable release found")
}

func shouldSkipVersion(version string) bool {
	version = strings.TrimSpace(version)
	return version == "" || strings.Contains(version, "dev") || strings.Contains(version, "next")
}

func normalizeVersion(version string) string {
	version = strings.TrimSpace(version)
	if version == "" {
		return ""
	}
	if !strings.HasPrefix(version, "v") {
		version = "v" + version
	}
	if !semver.IsValid(version) {
		return ""
	}
	return version
}

func readFreshState(path string, interval time.Duration) (stateFile, bool) {
	if path == "" {
		return stateFile{}, false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return stateFile{}, false
	}
	var state stateFile
	if err := json.Unmarshal(data, &state); err != nil {
		return stateFile{}, false
	}
	if state.CheckedAt.IsZero() || time.Since(state.CheckedAt) > interval {
		return stateFile{}, false
	}
	return state, true
}

func writeState(path string, state stateFile) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func assetName() string {
	var osName, arch string
	switch runtime.GOOS {
	case "darwin":
		osName = "Darwin"
	case "linux":
		osName = "Linux"
	case "windows":
		osName = "Windows"
	default:
		return ""
	}
	switch runtime.GOARCH {
	case "amd64":
		arch = "x86_64"
	case "arm64":
		arch = "arm64"
	default:
		return ""
	}
	if runtime.GOOS == "windows" {
		return fmt.Sprintf("tld_%s_%s.zip", osName, arch)
	}
	return fmt.Sprintf("tld_%s_%s.tar.gz", osName, arch)
}

func extractBinary(archivePath, dstDir string) (string, error) {
	if strings.HasSuffix(archivePath, ".zip") {
		return extractZipBinary(archivePath, dstDir)
	}
	return extractTarGzBinary(archivePath, dstDir)
}

func extractTarGzBinary(archivePath, dstDir string) (string, error) {
	file, err := os.Open(archivePath)
	if err != nil {
		return "", err
	}
	defer func() { _ = file.Close() }()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return "", err
	}
	defer func() { _ = gz.Close() }()
	tr := tar.NewReader(gz)
	for {
		header, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
		if header.FileInfo().IsDir() || filepath.Base(header.Name) != "tld" {
			continue
		}
		return writeExtractedBinary(filepath.Join(dstDir, "tld"), tr, header.FileInfo().Mode())
	}
	return "", errors.New("archive did not contain tld binary")
}

func extractZipBinary(archivePath, dstDir string) (string, error) {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", err
	}
	defer func() { _ = reader.Close() }()
	for _, file := range reader.File {
		if file.FileInfo().IsDir() || filepath.Base(file.Name) != "tld.exe" {
			continue
		}
		src, err := file.Open()
		if err != nil {
			return "", err
		}
		path, err := writeExtractedBinary(filepath.Join(dstDir, "tld.exe"), src, file.FileInfo().Mode())
		_ = src.Close()
		return path, err
	}
	return "", errors.New("archive did not contain tld.exe binary")
}

func writeExtractedBinary(path string, src io.Reader, mode os.FileMode) (string, error) {
	dst, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode|0o755)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		return "", err
	}
	if err := dst.Close(); err != nil {
		return "", err
	}
	return path, nil
}

func replaceExecutable(exe, replacement string) error {
	info, err := os.Stat(exe)
	if err != nil {
		return err
	}
	backup := exe + ".old"
	_ = os.Remove(backup)
	if runtime.GOOS == "windows" {
		return os.Rename(replacement, exe)
	}
	if err := os.Rename(exe, backup); err != nil {
		return err
	}
	if err := os.Rename(replacement, exe); err != nil {
		_ = os.Rename(backup, exe)
		return err
	}
	_ = os.Chmod(exe, info.Mode())
	_ = os.Remove(backup)
	return nil
}
