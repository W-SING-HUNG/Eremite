PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE file_blobs (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
  storage_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  verification_status TEXT NOT NULL DEFAULT 'ready' CHECK (verification_status IN ('ready', 'missing', 'quarantined')),
  verified_at TEXT,
  fingerprint_size INTEGER,
  fingerprint_mtime_ms REAL,
  created_at TEXT NOT NULL
) STRICT;

INSERT INTO file_blobs (id, sha256, storage_key, byte_size, verification_status, verified_at, created_at)
SELECT sha256, sha256, storage_key, byte_size, 'ready', created_at, created_at
FROM file_assets;

CREATE TEMP TABLE file_asset_migration_map (
  content_id TEXT PRIMARY KEY,
  old_asset_id TEXT NOT NULL,
  new_asset_id TEXT NOT NULL UNIQUE,
  version_id TEXT NOT NULL UNIQUE
) STRICT;

INSERT INTO file_asset_migration_map (content_id, old_asset_id, new_asset_id, version_id)
SELECT id,
       file_asset_id,
       CASE WHEN ROW_NUMBER() OVER (PARTITION BY file_asset_id ORDER BY created_at, id) = 1
            THEN file_asset_id ELSE eremite_uuidv7() END,
       eremite_uuidv7()
FROM content_items
WHERE kind = 'file';

CREATE TABLE file_assets_new (
  id TEXT PRIMARY KEY,
  current_version_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (id, current_version_id) REFERENCES file_versions(asset_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE file_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES file_assets_new(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  blob_id TEXT NOT NULL REFERENCES file_blobs(id) ON DELETE RESTRICT,
  original_name TEXT NOT NULL,
  declared_mime_type TEXT NOT NULL,
  detected_mime_type TEXT NOT NULL,
  viewer_kind TEXT NOT NULL CHECK (viewer_kind IN ('pdf', 'image', 'text', 'markdown', 'docx', 'archive', 'video', 'unsupported')),
  change_source TEXT NOT NULL CHECK (change_source IN ('migration', 'upload', 'replace', 'text_edit', 'restore')),
  source_version_id TEXT REFERENCES file_versions(id) ON DELETE SET NULL,
  text_encoding TEXT,
  text_bom TEXT,
  text_newline TEXT CHECK (text_newline IS NULL OR text_newline IN ('lf', 'crlf', 'cr', 'mixed')),
  text_trailing_newline INTEGER CHECK (text_trailing_newline IS NULL OR text_trailing_newline IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (asset_id, version_number),
  UNIQUE (asset_id, id)
) STRICT;

INSERT INTO file_assets_new (id, current_version_id, revision, created_at, updated_at)
SELECT map.new_asset_id, map.version_id, 1, old.created_at, ci.updated_at
FROM file_asset_migration_map map
JOIN file_assets old ON old.id = map.old_asset_id
JOIN content_items ci ON ci.id = map.content_id;

INSERT INTO file_versions (
  id, asset_id, version_number, blob_id, original_name, declared_mime_type,
  detected_mime_type, viewer_kind, change_source, created_at
)
SELECT map.version_id, map.new_asset_id, 1, old.sha256, old.original_name, old.mime_type,
       old.mime_type,
       CASE
         WHEN lower(old.original_name) LIKE '%.pdf' OR old.mime_type = 'application/pdf' THEN 'pdf'
         WHEN lower(old.original_name) GLOB '*.jpg' OR lower(old.original_name) GLOB '*.jpeg' OR lower(old.original_name) GLOB '*.png' OR lower(old.original_name) GLOB '*.webp' OR old.mime_type LIKE 'image/%' THEN 'image'
         WHEN lower(old.original_name) GLOB '*.md' OR lower(old.original_name) GLOB '*.markdown' OR old.mime_type = 'text/markdown' THEN 'markdown'
         WHEN lower(old.original_name) GLOB '*.txt' OR old.mime_type LIKE 'text/%' THEN 'text'
         WHEN lower(old.original_name) GLOB '*.docx' THEN 'docx'
         WHEN lower(old.original_name) GLOB '*.zip' THEN 'archive'
         WHEN old.mime_type LIKE 'video/%' THEN 'video'
         ELSE 'unsupported'
       END,
       'migration', old.created_at
FROM file_asset_migration_map map
JOIN file_assets old ON old.id = map.old_asset_id;

CREATE TABLE content_items_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'link')),
  title TEXT NOT NULL,
  source_url TEXT,
  file_asset_id TEXT UNIQUE REFERENCES file_assets_new(id) ON DELETE RESTRICT,
  tags TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'processed', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((kind = 'file' AND file_asset_id IS NOT NULL AND source_url IS NULL) OR (kind = 'link' AND source_url IS NOT NULL AND file_asset_id IS NULL))
) STRICT;

INSERT INTO content_items_new (id, kind, title, source_url, file_asset_id, tags, status, created_at, updated_at)
SELECT ci.id, ci.kind, ci.title, ci.source_url,
       CASE WHEN ci.kind = 'file' THEN map.new_asset_id ELSE NULL END,
       ci.tags, ci.status, ci.created_at, ci.updated_at
FROM content_items ci
LEFT JOIN file_asset_migration_map map ON map.content_id = ci.id;

CREATE TABLE action_content_items_new (
  action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  content_item_id TEXT NOT NULL REFERENCES content_items_new(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (action_id, content_item_id)
) STRICT;

INSERT INTO action_content_items_new SELECT action_id, content_item_id, created_at FROM action_content_items;

DROP TABLE action_content_items;
DROP TABLE content_items;
DROP TABLE file_assets;
ALTER TABLE file_assets_new RENAME TO file_assets;
ALTER TABLE content_items_new RENAME TO content_items;
ALTER TABLE action_content_items_new RENAME TO action_content_items;

CREATE INDEX content_items_status_idx ON content_items(status, created_at DESC);
CREATE INDEX file_versions_asset_idx ON file_versions(asset_id, version_number DESC);
CREATE INDEX file_versions_blob_idx ON file_versions(blob_id);

CREATE TABLE file_write_operations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('upload', 'replace', 'text_edit', 'restore')),
  state TEXT NOT NULL CHECK (state IN ('created', 'staged', 'published', 'committed', 'failed', 'reconciled')),
  content_id TEXT REFERENCES content_items(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES file_assets(id) ON DELETE SET NULL,
  expected_version_id TEXT REFERENCES file_versions(id) ON DELETE SET NULL,
  staged_path TEXT,
  blob_id TEXT REFERENCES file_blobs(id) ON DELETE SET NULL,
  version_id TEXT REFERENCES file_versions(id) ON DELETE SET NULL,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  committed_at TEXT
) STRICT;

CREATE INDEX file_write_operations_state_idx ON file_write_operations(state, updated_at);

CREATE TABLE blob_gc_queue (
  blob_id TEXT PRIMARY KEY REFERENCES file_blobs(id) ON DELETE CASCADE,
  not_before TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL
) STRICT;
