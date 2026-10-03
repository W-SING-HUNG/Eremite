PRAGMA foreign_keys = ON;

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE file_assets (
  id TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE content_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'link')),
  title TEXT NOT NULL,
  source_url TEXT,
  file_asset_id TEXT REFERENCES file_assets(id) ON DELETE RESTRICT,
  tags TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'processed', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((kind = 'file' AND file_asset_id IS NOT NULL AND source_url IS NULL) OR (kind = 'link' AND source_url IS NOT NULL AND file_asset_id IS NULL))
) STRICT;

CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'done', 'cancelled', 'archived')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE TABLE action_content_items (
  action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (action_id, content_item_id)
) STRICT;

CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY,
  automation_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  input_summary TEXT NOT NULL,
  output_summary TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE INDEX content_items_status_idx ON content_items(status, created_at DESC);
CREATE INDEX actions_status_idx ON actions(status, due_date);
CREATE INDEX automation_runs_created_idx ON automation_runs(created_at DESC);
