package watch

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	tldgit "github.com/mertcikla/tld/v2/internal/git"
	"github.com/mertcikla/tld/v2/internal/ignore"
)

type scanPlan struct {
	Strategy            string
	Mode                string
	Reason              string
	TrackedFiles        int
	SelectedFiles       int
	SkippedTrackedFiles int
	Limited             bool
	Files               []string
	RecentFiles         []string
	AnchorFiles         []string
	Warnings            []string
}

func planScan(repoRoot string, settings Settings, rules *ignore.Rules) (scanPlan, error) {
	settings = NormalizeSettings(settings)
	tracked, err := tldgit.ListTrackedFiles(repoRoot, settings.Scale.MaxTrackedFiles+1)
	if err != nil {
		return scanPlan{}, err
	}
	plan := scanPlan{
		Strategy:     settings.Scale.Strategy,
		Mode:         "full",
		TrackedFiles: tracked.Total,
	}
	switch settings.Scale.Strategy {
	case ScanStrategyFull:
		plan.Reason = "full scan requested"
		return plan, nil
	case ScanStrategyAbort:
		if tracked.Total > settings.Scale.MaxTrackedFiles || tracked.Capped {
			return plan, fmt.Errorf("repository has more than %d tracked files; watch.scale.strategy=abort", settings.Scale.MaxTrackedFiles)
		}
		plan.Reason = "repository below scale threshold"
		return plan, nil
	case ScanStrategyLimited:
		plan.Reason = "limited scan requested"
	default:
		if tracked.Total <= settings.Scale.MaxTrackedFiles && !tracked.Capped {
			plan.Reason = "repository below scale threshold"
			return plan, nil
		}
		plan.Reason = fmt.Sprintf("tracked files exceed %d", settings.Scale.MaxTrackedFiles)
	}
	plan.Mode = "limited"
	plan.Limited = true
	if tracked.Capped {
		if fullTracked, err := tldgit.ListTrackedFiles(repoRoot, 0); err == nil {
			tracked = fullTracked
			plan.TrackedFiles = tracked.Total
		} else {
			plan.Warnings = append(plan.Warnings, "limited view: tracked-file listing capped before anchor selection: "+err.Error())
		}
	}
	plan.RecentFiles = selectRecentFiles(repoRoot, settings, rules)
	if len(plan.RecentFiles) == 0 {
		plan.Warnings = append(plan.Warnings, "limited view: local git history did not return recent files; falling back to tracked file order")
		plan.RecentFiles = selectTrackedFallbackFiles(repoRoot, tracked.Files, settings, rules)
	}
	plan.AnchorFiles = selectAnchorFiles(repoRoot, tracked.Files, settings, rules)
	plan.Files = uniqueLimitedAbsFiles(append(append([]string{}, plan.RecentFiles...), plan.AnchorFiles...), settings.Scale.MaxLimitedFiles)
	plan.SelectedFiles = len(plan.Files)
	plan.SkippedTrackedFiles = max(tracked.Total-len(plan.Files), 0)
	plan.Warnings = append(plan.Warnings, fmt.Sprintf("limited view: %s; selected %d recent/anchor files out of %d tracked files", plan.Reason, plan.SelectedFiles, plan.TrackedFiles))
	return plan, nil
}

func selectRecentFiles(repoRoot string, settings Settings, rules *ignore.Rules) []string {
	settings = NormalizeSettings(settings)
	recent, err := tldgit.RecentChangedFiles(repoRoot, settings.Scale.MaxRecentFiles)
	if err != nil {
		return nil
	}
	return filterLimitedRelFiles(repoRoot, recent, settings, rules, settings.Scale.MaxRecentFiles)
}

func uniqueLimitedAbsFiles(files []string, limit int) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(files))
	for _, file := range files {
		file = filepath.Clean(file)
		if file == "" {
			continue
		}
		if _, ok := seen[file]; ok {
			continue
		}
		seen[file] = struct{}{}
		out = append(out, file)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

func selectTrackedFallbackFiles(repoRoot string, tracked []string, settings Settings, rules *ignore.Rules) []string {
	settings = NormalizeSettings(settings)
	return filterLimitedRelFiles(repoRoot, tracked, settings, rules, settings.Scale.MaxRecentFiles)
}

func filterLimitedRelFiles(repoRoot string, relFiles []string, settings Settings, rules *ignore.Rules, limit int) []string {
	settings = NormalizeSettings(settings)
	allowed := map[string]struct{}{}
	for _, language := range settings.Languages {
		allowed[language] = struct{}{}
	}
	if rules == nil {
		rules = &ignore.Rules{}
	}
	files := make([]string, 0, min(limit, len(relFiles)))
	seen := map[string]struct{}{}
	for _, rel := range relFiles {
		rel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
		if rel == "." || rel == ".." || strings.HasPrefix(rel, "../") || rules.ShouldIgnorePath(rel) {
			continue
		}
		abs := filepath.Join(repoRoot, filepath.FromSlash(rel))
		language, parseable, ok := watchedFileLanguage(abs)
		if !ok {
			continue
		}
		if parseable && !languageAllowed(language, allowed) {
			continue
		}
		if _, ok := seen[rel]; ok {
			continue
		}
		seen[rel] = struct{}{}
		files = append(files, abs)
		if limit > 0 && len(files) >= limit {
			break
		}
	}
	return files
}

func selectAnchorFiles(repoRoot string, tracked []string, settings Settings, rules *ignore.Rules) []string {
	settings = NormalizeSettings(settings)
	allowed := map[string]struct{}{}
	for _, language := range settings.Languages {
		allowed[language] = struct{}{}
	}
	if rules == nil {
		rules = &ignore.Rules{}
	}
	type candidate struct {
		path  string
		score int
	}
	var candidates []candidate
	seen := map[string]struct{}{}
	for _, rel := range tracked {
		rel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
		if rel == "." || rel == ".." || strings.HasPrefix(rel, "../") || rules.ShouldIgnorePath(rel) {
			continue
		}
		score := repoSignalAnchorScore(rel)
		if score == 0 {
			continue
		}
		abs := filepath.Join(repoRoot, filepath.FromSlash(rel))
		language, parseable, ok := watchedFileLanguage(abs)
		if !ok || (parseable && !languageAllowed(language, allowed)) {
			continue
		}
		if _, ok := seen[rel]; ok {
			continue
		}
		seen[rel] = struct{}{}
		candidates = append(candidates, candidate{path: abs, score: score})
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score > candidates[j].score
		}
		return candidates[i].path < candidates[j].path
	})
	limit := min(50, len(candidates))
	files := make([]string, 0, limit)
	for _, candidate := range candidates[:limit] {
		files = append(files, candidate.path)
	}
	sort.Strings(files)
	return files
}

func repoSignalAnchorScore(rel string) int {
	base := strings.ToLower(filepath.Base(rel))
	relLower := strings.ToLower(filepath.ToSlash(rel))
	switch {
	case base == "dockerfile" || strings.HasPrefix(base, "dockerfile."):
		return 100
	case strings.HasPrefix(base, "docker-compose") && (strings.HasSuffix(base, ".yml") || strings.HasSuffix(base, ".yaml")):
		return 100
	case base == "kustomization.yaml" || base == "kustomization.yml" || base == "chart.yaml" || base == "values.yaml":
		return 95
	case strings.Contains(relLower, ".github/workflows/") || strings.Contains(relLower, "/.github/workflows/"):
		return 90
	case base == "codeowners":
		return 90
	case base == "package.json" || base == "package-lock.json" || base == "pnpm-lock.yaml" || base == "yarn.lock":
		return 85
	case base == "go.mod" || base == "go.sum" || base == "pom.xml" || base == "build.gradle" || base == "settings.gradle":
		return 85
	case base == "requirements.txt" || base == "requirements.in" || base == "pyproject.toml" || base == "poetry.lock" || base == "cargo.toml":
		return 85
	case strings.HasSuffix(base, ".tf") || strings.HasSuffix(base, ".proto"):
		return 80
	case strings.HasPrefix(base, "readme"):
		return 70
	case strings.HasSuffix(base, ".yaml") || strings.HasSuffix(base, ".yml"):
		if strings.Contains(relLower, "k8s") || strings.Contains(relLower, "kubernetes") || strings.Contains(relLower, "deploy") || strings.Contains(relLower, "manifest") {
			return 88
		}
		return 40
	case base == "main.go" || base == "server.go" || base == "app.ts" || base == "app.tsx" || base == "index.ts" || base == "index.tsx":
		return 60
	default:
		return 0
	}
}
