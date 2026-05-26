package app

import (
	"context"
	"database/sql"
	"errors"
)

type ViewMarkdownDocument struct {
	Path      string `json:"path"`
	IsManaged bool   `json:"is_managed"`
	UpdatedAt string `json:"updated_at"`
}

func (s *Store) viewMarkdownMap(ctx context.Context) (map[int64]*ViewMarkdownDocument, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT view_id, path, is_managed, updated_at FROM view_markdown_documents ORDER BY view_id`)
	if err != nil {
		if stringsContainsNoSuchTable(err) {
			return map[int64]*ViewMarkdownDocument{}, nil
		}
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := make(map[int64]*ViewMarkdownDocument)
	for rows.Next() {
		var viewID int64
		var doc ViewMarkdownDocument
		if err := rows.Scan(&viewID, &doc.Path, &doc.IsManaged, &doc.UpdatedAt); err != nil {
			return nil, err
		}
		docCopy := doc
		out[viewID] = &docCopy
	}
	return out, rows.Err()
}

func (s *Store) ViewMarkdownByViewID(ctx context.Context, viewID int64) (*ViewMarkdownDocument, error) {
	row := s.db.QueryRowContext(ctx, `SELECT path, is_managed, updated_at FROM view_markdown_documents WHERE view_id = ?`, viewID)
	var doc ViewMarkdownDocument
	if err := row.Scan(&doc.Path, &doc.IsManaged, &doc.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		if stringsContainsNoSuchTable(err) {
			return nil, nil
		}
		return nil, err
	}
	return &doc, nil
}

func (s *Store) UpsertViewMarkdown(ctx context.Context, viewID int64, path string, isManaged bool, updatedAt string) error {
	if updatedAt == "" {
		updatedAt = nowString()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO view_markdown_documents(view_id, path, is_managed, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(view_id) DO UPDATE SET
			path = excluded.path,
			is_managed = excluded.is_managed,
			updated_at = excluded.updated_at
	`, viewID, path, isManaged, updatedAt, updatedAt)
	return err
}

func (s *Store) DeleteViewMarkdown(ctx context.Context, viewID int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM view_markdown_documents WHERE view_id = ?`, viewID)
	return err
}

func stringsContainsNoSuchTable(err error) bool {
	return err != nil && !errors.Is(err, sql.ErrNoRows) && containsNoSuchTable(err.Error())
}

func containsNoSuchTable(message string) bool {
	return message == "SQL logic error: no such table: view_markdown_documents (1)" ||
		message == "SQL logic error: no such table: view_markdown_documents"
}