package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

type ViewMarkdownDocument struct {
	Path      string `json:"path"`
	IsManaged bool   `json:"is_managed"`
	UpdatedAt string `json:"updated_at"`
}

func (s *Store) viewMarkdownMap(ctx context.Context) (map[int64]*ViewMarkdownDocument, error) {
	if err := s.ensureViewMarkdownTable(ctx); err != nil {
		return nil, err
	}
	var rows []viewMarkdownModel
	if err := s.bun.NewSelect().Model(&rows).Order("view_id").Scan(ctx); err != nil {
		if stringsContainsNoSuchTable(err) {
			return map[int64]*ViewMarkdownDocument{}, nil
		}
		return nil, err
	}
	out := make(map[int64]*ViewMarkdownDocument, len(rows))
	for _, row := range rows {
		out[row.ViewID] = viewMarkdownDocumentFromModel(row)
	}
	return out, nil
}

func (s *Store) ViewMarkdownByViewID(ctx context.Context, viewID int64) (*ViewMarkdownDocument, error) {
	if err := s.ensureViewMarkdownTable(ctx); err != nil {
		return nil, err
	}
	var row viewMarkdownModel
	if err := s.bun.NewSelect().
		Model(&row).
		Where("view_id = ?", viewID).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) || stringsContainsNoSuchTable(err) {
			return nil, nil
		}
		return nil, err
	}
	return viewMarkdownDocumentFromModel(row), nil
}

func (s *Store) UpsertViewMarkdown(ctx context.Context, viewID int64, path string, isManaged bool, updatedAt string) error {
	if updatedAt == "" {
		updatedAt = nowString()
	}
	if err := s.ensureViewMarkdownTable(ctx); err != nil {
		return err
	}
	row := &viewMarkdownModel{
		ViewID:    viewID,
		Path:      path,
		IsManaged: isManaged,
		CreatedAt: updatedAt,
		UpdatedAt: updatedAt,
	}
	_, err := s.bun.NewInsert().
		Model(row).
		On("CONFLICT(view_id) DO UPDATE").
		Set("path = EXCLUDED.path").
		Set("is_managed = EXCLUDED.is_managed").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	return err
}

func (s *Store) DeleteViewMarkdown(ctx context.Context, viewID int64) error {
	if err := s.ensureViewMarkdownTable(ctx); err != nil {
		if stringsContainsNoSuchTable(err) {
			return nil
		}
		return err
	}
	_, err := s.bun.NewDelete().
		Model((*viewMarkdownModel)(nil)).
		Where("view_id = ?", viewID).
		Exec(ctx)
	return err
}

func (s *Store) ensureViewMarkdownTable(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS view_markdown_documents (
			view_id INTEGER PRIMARY KEY,
			org_id TEXT NULL,
			path TEXT NOT NULL,
			is_managed INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY (view_id) REFERENCES views(id) ON DELETE CASCADE
		)
	`); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `ALTER TABLE view_markdown_documents ADD COLUMN org_id TEXT NULL`); err != nil && !isDuplicateColumnError(err) {
		return err
	}
	return nil
}

func viewMarkdownDocumentFromModel(row viewMarkdownModel) *ViewMarkdownDocument {
	return &ViewMarkdownDocument{
		Path:      row.Path,
		IsManaged: row.IsManaged,
		UpdatedAt: row.UpdatedAt,
	}
}

func stringsContainsNoSuchTable(err error) bool {
	return err != nil && !errors.Is(err, sql.ErrNoRows) && containsNoSuchTable(err.Error())
}

func containsNoSuchTable(message string) bool {
	return strings.Contains(message, "no such table: view_markdown_documents") ||
		strings.Contains(message, `relation "view_markdown_documents" does not exist`)
}

func isDuplicateColumnError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "duplicate column name: org_id") ||
		strings.Contains(message, `column "org_id" of relation "view_markdown_documents" already exists`)
}
