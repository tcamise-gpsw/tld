CREATE TABLE IF NOT EXISTS view_markdown_documents (
  view_id INTEGER PRIMARY KEY,
  org_id TEXT NULL,
  path TEXT NOT NULL,
  is_managed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (view_id) REFERENCES views(id) ON DELETE CASCADE
);
