package lsp

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/mertcikla/tld/v2/internal/analyzer"
	"go.lsp.dev/protocol"
	"go.lsp.dev/uri"
)

func TestKMPLSP_StartsForConnectWorkspace(t *testing.T) {
	kmpPath, err := exec.LookPath("kmp-lsp")
	if err != nil {
		t.Skipf("kmp-lsp not installed: %v", err)
	}

	connectRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "..", ".."))
	if err != nil {
		t.Fatalf("resolve connect root: %v", err)
	}
	if _, err := os.Stat(filepath.Join(connectRoot, "settings.gradle.kts")); err != nil {
		t.Skipf("connect root not available: %v", err)
	}
	refPath := filepath.Join(
		connectRoot,
		"sdk", "connect-sdk-api", "src", "commonMain", "kotlin", "com", "gopro", "katalyst", "connect", "api", "domain", "usecase", "commands", "cameradevice", "CameraDeviceSelectCameraSubmodeUseCase.kt",
	)
	defPath := filepath.Join(
		connectRoot,
		"sdk", "connect-sdk-api", "src", "commonMain", "kotlin", "com", "gopro", "katalyst", "connect", "api", "domain", "usecase", "commands", "cameradevice", "CameraDeviceSetCaptureModeUseCase.kt",
	)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	session, err := StartSession(ctx, SessionConfig{
		Language: analyzer.LanguageKotlin,
		RootDir:  connectRoot,
		Command: ResolvedCommand{
			Path:          kmpPath,
			CommandSource: CommandSourceDefault,
		},
	})
	if err != nil {
		t.Fatalf("start kmp-lsp: %v", err)
	}
	defer func() {
		if err := session.Close(); err != nil {
			t.Logf("close kmp-lsp session: %v", err)
		}
	}()

	if !session.SupportsDefinition() {
		t.Fatal("kmp-lsp should support definition lookup")
	}
	if !session.SupportsReferences() {
		t.Fatal("kmp-lsp should support references lookup")
	}
	data, err := os.ReadFile(refPath)
	if err != nil {
		t.Fatalf("read reference file: %v", err)
	}
	if err := session.OpenDocument(ctx, refPath, string(data)); err != nil {
		t.Fatalf("open reference file: %v", err)
	}

	locations, err := session.Definition(ctx, &protocol.DefinitionParams{
		TextDocumentPositionParams: protocol.TextDocumentPositionParams{
			TextDocument: protocol.TextDocumentIdentifier{URI: uri.File(refPath)},
			Position: protocol.Position{
				Line:      22,
				Character: 42,
			},
		},
	})
	if err != nil {
		t.Fatalf("definition lookup: %v", err)
	}
	if !slices.ContainsFunc(locations, func(location protocol.Location) bool {
		return filepath.Clean(location.URI.Filename()) == defPath && int(location.Range.Start.Line)+1 == 97
	}) {
		t.Fatalf("definition locations = %#v, want %s:97", locations, defPath)
	}
}
