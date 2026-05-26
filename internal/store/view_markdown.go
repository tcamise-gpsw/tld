package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	diagv1 "buf.build/gen/go/tldiagramcom/diagram/protocolbuffers/go/diag/v1"
	"github.com/google/uuid"
	"github.com/mertcikla/tld/v2/internal/app"
)

const managedViewMarkdownDir = "view-markdown"

func (a *APIAdapter) GetViewMarkdown(ctx context.Context, viewID int32, _ uuid.UUID) (*diagv1.ViewMarkdownDocument, string, error) {
	if _, err := a.Store.legacy.ViewByID(ctx, int64(viewID)); err != nil {
		return nil, "", err
	}
	doc, err := a.Store.legacy.ViewMarkdownByViewID(ctx, int64(viewID))
	if err != nil {
		return nil, "", err
	}
	if doc == nil {
		return nil, "", sql.ErrNoRows
	}
	absPath, err := a.resolveStoredMarkdownPath(doc.Path)
	if err != nil {
		return nil, "", err
	}
	content, err := os.ReadFile(absPath)
	if err != nil {
		return nil, "", err
	}
	return viewMarkdownToProto(doc), string(content), nil
}

func (a *APIAdapter) CreateViewMarkdown(ctx context.Context, viewID int32, workspaceID uuid.UUID, fileName *string, initialContent *string) (*diagv1.View, error) {
	view, err := a.Store.legacy.ViewByID(ctx, int64(viewID))
	if err != nil {
		return nil, err
	}
	if existing, err := a.Store.legacy.ViewMarkdownByViewID(ctx, int64(viewID)); err != nil {
		return nil, err
	} else if existing != nil {
		return a.GetView(ctx, viewID, workspaceID)
	}
	storedPath, absPath, err := a.managedMarkdownPath(viewID, view.Name, fileName)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return nil, err
	}
	content := ""
	if initialContent != nil {
		content = *initialContent
	}
	file, err := os.OpenFile(absPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return nil, err
	}
	if _, err := file.WriteString(content); err != nil {
		_ = file.Close()
		return nil, err
	}
	if err := file.Close(); err != nil {
		return nil, err
	}
	if err := a.Store.legacy.UpsertViewMarkdown(ctx, int64(viewID), storedPath, true, nowString()); err != nil {
		return nil, err
	}
	return a.GetView(ctx, viewID, workspaceID)
}

func (a *APIAdapter) LinkViewMarkdown(ctx context.Context, viewID int32, workspaceID uuid.UUID, path string) (*diagv1.View, error) {
	if _, err := a.Store.legacy.ViewByID(ctx, int64(viewID)); err != nil {
		return nil, err
	}
	storedPath, absPath, err := a.normalizeLinkedMarkdownPath(path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("markdown path must point to a file")
	}
	if err := a.Store.legacy.UpsertViewMarkdown(ctx, int64(viewID), storedPath, false, info.ModTime().UTC().Format(time.RFC3339)); err != nil {
		return nil, err
	}
	return a.GetView(ctx, viewID, workspaceID)
}

func (a *APIAdapter) SaveViewMarkdown(ctx context.Context, viewID int32, _ uuid.UUID, content string) (*diagv1.ViewMarkdownDocument, error) {
	doc, err := a.Store.legacy.ViewMarkdownByViewID(ctx, int64(viewID))
	if err != nil {
		return nil, err
	}
	if doc == nil {
		return nil, sql.ErrNoRows
	}
	absPath, err := a.resolveStoredMarkdownPath(doc.Path)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(absPath, []byte(content), 0o644); err != nil {
		return nil, err
	}
	updatedAt := nowString()
	if err := a.Store.legacy.UpsertViewMarkdown(ctx, int64(viewID), doc.Path, doc.IsManaged, updatedAt); err != nil {
		return nil, err
	}
	updated := &app.ViewMarkdownDocument{
		Path:      doc.Path,
		IsManaged: doc.IsManaged,
		UpdatedAt: updatedAt,
	}
	return viewMarkdownToProto(updated), nil
}

func (a *APIAdapter) UnlinkViewMarkdown(ctx context.Context, viewID int32, workspaceID uuid.UUID, deleteManagedFile bool) (*diagv1.View, error) {
	doc, err := a.Store.legacy.ViewMarkdownByViewID(ctx, int64(viewID))
	if err != nil {
		return nil, err
	}
	if doc == nil {
		return a.GetView(ctx, viewID, workspaceID)
	}
	if deleteManagedFile && doc.IsManaged {
		absPath, err := a.resolveStoredMarkdownPath(doc.Path)
		if err != nil {
			return nil, err
		}
		if err := os.Remove(absPath); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
	}
	if err := a.Store.legacy.DeleteViewMarkdown(ctx, int64(viewID)); err != nil {
		return nil, err
	}
	return a.GetView(ctx, viewID, workspaceID)
}

func viewMarkdownToProto(doc *app.ViewMarkdownDocument) *diagv1.ViewMarkdownDocument {
	if doc == nil {
		return nil
	}
	return &diagv1.ViewMarkdownDocument{
		Path:      doc.Path,
		IsManaged: doc.IsManaged,
		UpdatedAt: ts(doc.UpdatedAt),
	}
}

func (a *APIAdapter) requireDataDir() (string, error) {
	if strings.TrimSpace(a.DataDir) == "" {
		return "", fmt.Errorf("data directory is not configured")
	}
	return a.DataDir, nil
}

func (a *APIAdapter) resolveStoredMarkdownPath(storedPath string) (string, error) {
	if filepath.IsAbs(storedPath) {
		return filepath.Clean(storedPath), nil
	}
	dataDir, err := a.requireDataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dataDir, filepath.Clean(storedPath)), nil
}

func (a *APIAdapter) normalizeLinkedMarkdownPath(path string) (string, string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", "", fmt.Errorf("markdown path must not be empty")
	}
	dataDir, err := a.requireDataDir()
	if err != nil {
		return "", "", err
	}
	var absPath string
	if filepath.IsAbs(trimmed) {
		absPath = filepath.Clean(trimmed)
	} else {
		absPath = filepath.Clean(filepath.Join(dataDir, trimmed))
	}
	relPath, err := filepath.Rel(dataDir, absPath)
	if err == nil && relPath != ".." && !strings.HasPrefix(relPath, ".."+string(os.PathSeparator)) {
		return relPath, absPath, nil
	}
	return absPath, absPath, nil
}

func (a *APIAdapter) managedMarkdownPath(viewID int32, viewName string, fileName *string) (string, string, error) {
	dataDir, err := a.requireDataDir()
	if err != nil {
		return "", "", err
	}
	baseName := viewName
	if fileName != nil && strings.TrimSpace(*fileName) != "" {
		baseName = strings.TrimSpace(*fileName)
	}
	baseName = strings.TrimSuffix(filepath.Base(baseName), filepath.Ext(baseName))
	slug := sanitizeMarkdownBaseName(baseName)
	storedPath := filepath.Join(managedViewMarkdownDir, fmt.Sprintf("view-%d-%s.md", viewID, slug))
	return storedPath, filepath.Join(dataDir, storedPath), nil
}

func sanitizeMarkdownBaseName(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "notes"
	}
	var builder strings.Builder
	lastWasDash := false
	for _, r := range strings.ToLower(trimmed) {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
			lastWasDash = false
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
			lastWasDash = false
		default:
			if !lastWasDash {
				builder.WriteByte('-')
				lastWasDash = true
			}
		}
	}
	slug := strings.Trim(builder.String(), "-")
	if slug == "" {
		return "notes"
	}
	return slug
}
