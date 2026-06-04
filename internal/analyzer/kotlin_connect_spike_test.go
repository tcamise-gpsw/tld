package analyzer

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestKotlinParser_ParsesAllConnectKotlinFiles(t *testing.T) {
	connectRoot := filepath.Clean(filepath.Join("..", "..", "..", ".."))
	if _, err := os.Stat(filepath.Join(connectRoot, "settings.gradle.kts")); err != nil {
		t.Skipf("connect root not available: %v", err)
	}

	service := NewService()
	var files, symbols, refs int
	err := filepath.WalkDir(connectRoot, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			switch entry.Name() {
			case ".gradle", ".kotlin", "build", "tools":
				return filepath.SkipDir
			}
			return nil
		}
		language, ok := DetectLanguage(path)
		if !ok || language != LanguageKotlin {
			return nil
		}
		result, err := service.ExtractPath(context.Background(), path, nil, nil)
		if err != nil {
			return err
		}
		files++
		symbols += len(result.Symbols)
		refs += len(result.Refs)
		return nil
	})
	if err != nil {
		t.Fatalf("parse all connect Kotlin files: %v", err)
	}
	if files == 0 {
		t.Fatal("expected Kotlin files under connect root")
	}
	if symbols == 0 {
		t.Fatalf("parsed %d Kotlin files but found no symbols", files)
	}
	if refs == 0 {
		t.Fatalf("parsed %d Kotlin files and %d symbols but found no refs", files, symbols)
	}
	t.Logf("parsed %d Kotlin files with %d symbols and %d refs", files, symbols, refs)
}
