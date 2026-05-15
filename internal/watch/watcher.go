package watch

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/fsnotify/fsnotify"
	"github.com/mertcikla/tld/v2/internal/ignore"
)

type sourceWatcher struct {
	Mode     string
	Events   <-chan struct{}
	Warnings []string
	Close    func() error
}

func newSourceWatcher(ctx context.Context, root string, settings Settings, rules *ignore.Rules, logger EventLogger) sourceWatcher {
	settings = NormalizeSettings(settings)
	if settings.Watcher == WatcherPoll {
		return sourceWatcher{Mode: WatcherPoll}
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		if settings.Watcher == WatcherFSNotify {
			return sourceWatcher{Mode: WatcherPoll, Warnings: []string{"fsnotify unavailable: " + err.Error()}}
		}
		return sourceWatcher{Mode: WatcherPoll, Warnings: []string{"fsnotify unavailable; using poll fallback"}}
	}
	ch := make(chan struct{}, 1)
	allowed := map[string]struct{}{}
	for _, lang := range settings.Languages {
		allowed[lang] = struct{}{}
	}
	if rules == nil {
		rules = &ignore.Rules{}
	}
	warnings := []string{}
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		if rel != "." && (rules.ShouldIgnorePath(rel) || isHiddenBuildOutput(d.Name())) {
			return filepath.SkipDir
		}
		if err := watcher.Add(path); err != nil {
			warnings = append(warnings, fsnotifyAddWarning(path, err))
			logError(ctx, logger, "watch.fsnotify.add_failed", err, "path", path)
		}
		return nil
	})
	if walkErr != nil {
		warnings = append(warnings, "fsnotify setup warning: "+walkErr.Error())
	}
	go func() {
		defer close(ch)
		defer func() { _ = watcher.Close() }()
		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if event.Has(fsnotify.Create) {
					if info, err := filepathAbsStat(event.Name); err == nil && info.IsDir() {
						addCreatedWatchTree(ctx, watcher, root, event.Name, rules, logger)
					}
				}
				if sourceEventRelevant(root, event.Name, allowed, rules) {
					select {
					case ch <- struct{}{}:
					default:
					}
				}
			case <-watcher.Errors:
				select {
				case ch <- struct{}{}:
				default:
				}
			}
		}
	}()
	return sourceWatcher{Mode: WatcherFSNotify, Events: ch, Warnings: warnings, Close: watcher.Close}
}

func addCreatedWatchTree(ctx context.Context, watcher *fsnotify.Watcher, root, dir string, rules *ignore.Rules, logger EventLogger) {
	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		if !sourceWatchDirAllowed(root, path, d.Name(), rules) {
			return filepath.SkipDir
		}
		if err := watcher.Add(path); err != nil {
			logError(ctx, logger, "watch.fsnotify.add_failed", err, "path", path, "warning", fsnotifyAddWarning(path, err))
		}
		return nil
	})
}

func sourceWatchDirAllowed(root, path, name string, rules *ignore.Rules) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil || strings.HasPrefix(rel, "..") {
		return false
	}
	rel = filepath.ToSlash(rel)
	if rel != "." && (rules.ShouldIgnorePath(rel) || isHiddenBuildOutput(name)) {
		return false
	}
	return true
}

func fsnotifyAddWarning(path string, err error) string {
	return fmt.Sprintf("fsnotify could not watch %s: %v; increase the open file limit or use a scalable native watcher such as fsevents on macOS", path, err)
}

func sourceEventRelevant(root, eventPath string, allowed map[string]struct{}, rules *ignore.Rules) bool {
	rel, err := filepath.Rel(root, eventPath)
	if err != nil || strings.HasPrefix(rel, "..") {
		return false
	}
	rel = filepath.ToSlash(rel)
	if rules != nil && rules.ShouldIgnorePath(rel) {
		return false
	}
	language, _, ok := watchedFileLanguage(eventPath)
	return ok && languageAllowed(language, allowed)
}

func filepathAbsStat(path string) (fs.FileInfo, error) {
	return os.Stat(path)
}
