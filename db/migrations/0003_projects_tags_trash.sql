PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  name_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  color TEXT,
  pinned_at TEXT,
  archived_at TEXT,
  trashed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (name_key = eremite_normalize_key(name))
) STRICT;

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  parent_id TEXT,
  restore_parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  name_key TEXT NOT NULL,
  trashed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, id),
  CHECK (name_key = eremite_normalize_key(name)),
  CHECK (parent_id IS NULL OR parent_id <> id),
  FOREIGN KEY (project_id, parent_id) REFERENCES folders(project_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE UNIQUE INDEX folders_live_root_name_uq
  ON folders(project_id, name_key)
  WHERE parent_id IS NULL AND trashed_at IS NULL;
CREATE UNIQUE INDEX folders_live_child_name_uq
  ON folders(project_id, parent_id, name_key)
  WHERE parent_id IS NOT NULL AND trashed_at IS NULL;
CREATE INDEX folders_children_idx ON folders(project_id, parent_id, trashed_at, name_key, id);
CREATE INDEX folders_restore_parent_idx ON folders(restore_parent_id) WHERE restore_parent_id IS NOT NULL;

CREATE TRIGGER folders_reject_insert_cycle
BEFORE INSERT ON folders
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT NEW.parent_id
      UNION
      SELECT folders.parent_id FROM folders JOIN ancestors ON folders.id = ancestors.id WHERE folders.parent_id IS NOT NULL
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN RAISE(ABORT, 'folder_cycle') END;
END;

CREATE TRIGGER folders_reject_update_cycle
BEFORE UPDATE OF parent_id ON folders
WHEN NEW.parent_id IS NOT NULL AND NEW.parent_id IS NOT OLD.parent_id
BEGIN
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT NEW.parent_id
      UNION
      SELECT folders.parent_id FROM folders JOIN ancestors ON folders.id = ancestors.id WHERE folders.parent_id IS NOT NULL
    )
    SELECT 1 FROM ancestors WHERE id = OLD.id
  ) THEN RAISE(ABORT, 'folder_cycle') END;
END;

CREATE TABLE content_items_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'link')),
  title TEXT NOT NULL,
  source_url TEXT,
  file_asset_id TEXT UNIQUE REFERENCES file_assets(id) ON DELETE RESTRICT,
  tags TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'processed', 'archived')),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  folder_id TEXT,
  restore_folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  trashed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((kind = 'file' AND file_asset_id IS NOT NULL AND source_url IS NULL) OR (kind = 'link' AND source_url IS NOT NULL AND file_asset_id IS NULL)),
  CHECK (folder_id IS NULL OR project_id IS NOT NULL),
  FOREIGN KEY (project_id, folder_id) REFERENCES folders(project_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
) STRICT;

INSERT INTO content_items_new (
  id, kind, title, source_url, file_asset_id, tags, status, created_at, updated_at
)
SELECT id, kind, title, source_url, file_asset_id, tags, status, created_at, updated_at
FROM content_items;

CREATE TABLE action_content_items_new (
  action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  content_item_id TEXT NOT NULL REFERENCES content_items_new(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (action_id, content_item_id)
) STRICT;

INSERT INTO action_content_items_new SELECT action_id, content_item_id, created_at FROM action_content_items;
DROP TABLE action_content_items;
DROP TABLE content_items;
ALTER TABLE content_items_new RENAME TO content_items;
ALTER TABLE action_content_items_new RENAME TO action_content_items;

ALTER TABLE actions ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE actions ADD COLUMN trashed_at TEXT;
ALTER TABLE actions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);

ALTER TABLE automation_runs ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE automation_runs ADD COLUMN project_name_snapshot TEXT;
ALTER TABLE automation_runs ADD COLUMN output_action_id TEXT REFERENCES actions(id) ON DELETE SET NULL;
ALTER TABLE automation_runs ADD COLUMN trashed_at TEXT;
ALTER TABLE automation_runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);

CREATE TABLE automation_run_inputs (
  run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  content_id TEXT REFERENCES content_items(id) ON DELETE SET NULL,
  content_title_snapshot TEXT NOT NULL,
  file_version_id TEXT REFERENCES file_versions(id) ON DELETE SET NULL,
  file_name_snapshot TEXT,
  file_sha256_snapshot TEXT,
  file_byte_size_snapshot INTEGER CHECK (file_byte_size_snapshot IS NULL OR file_byte_size_snapshot >= 0),
  PRIMARY KEY (run_id, ordinal)
) STRICT;

CREATE TABLE automation_run_outputs (
  run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  action_id TEXT REFERENCES actions(id) ON DELETE SET NULL,
  action_title_snapshot TEXT NOT NULL,
  PRIMARY KEY (run_id, ordinal)
) STRICT;

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  name_key TEXT NOT NULL UNIQUE,
  color TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (name_key = eremite_normalize_key(name))
) STRICT;

CREATE TABLE content_item_tags (
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (content_item_id, tag_id)
) STRICT;

CREATE TABLE action_tags (
  action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (action_id, tag_id)
) STRICT;

CREATE TABLE automation_run_tags (
  automation_run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (automation_run_id, tag_id)
) STRICT;

CREATE TEMP TABLE legacy_tag_tokens (
  content_item_id TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  tag_key TEXT NOT NULL
) STRICT;

INSERT INTO legacy_tag_tokens (content_item_id, tag_name, tag_key)
WITH RECURSIVE split(content_item_id, token, rest) AS (
  SELECT id, '', replace(tags, '，', ',') || ',' FROM content_items WHERE trim(tags) <> ''
  UNION ALL
  SELECT content_item_id, trim(substr(rest, 1, instr(rest, ',') - 1)), substr(rest, instr(rest, ',') + 1)
  FROM split WHERE rest <> ''
)
SELECT content_item_id, token, eremite_normalize_key(token)
FROM split
WHERE token <> '' AND length(token) <= 64 AND eremite_normalize_key(token) <> '';

INSERT INTO tags (id, name, name_key, created_at, updated_at)
SELECT eremite_uuidv7(), MIN(tag_name), tag_key, MIN(ci.created_at), MAX(ci.updated_at)
FROM legacy_tag_tokens token
JOIN content_items ci ON ci.id = token.content_item_id
GROUP BY tag_key;

INSERT OR IGNORE INTO content_item_tags (content_item_id, tag_id, created_at)
SELECT token.content_item_id, tag.id, ci.updated_at
FROM legacy_tag_tokens token
JOIN tags tag ON tag.name_key = token.tag_key
JOIN content_items ci ON ci.id = token.content_item_id;

CREATE INDEX projects_lifecycle_idx ON projects(trashed_at, archived_at, pinned_at DESC, updated_at DESC);
CREATE INDEX content_items_status_idx ON content_items(status, trashed_at, created_at DESC);
CREATE INDEX content_items_project_folder_idx ON content_items(project_id, folder_id, trashed_at, updated_at DESC, id DESC);
CREATE INDEX actions_project_idx ON actions(project_id, trashed_at, updated_at DESC, id DESC);
CREATE INDEX automation_runs_project_idx ON automation_runs(project_id, trashed_at, created_at DESC, id DESC);
CREATE INDEX content_item_tags_tag_idx ON content_item_tags(tag_id, content_item_id);
CREATE INDEX action_tags_tag_idx ON action_tags(tag_id, action_id);
CREATE INDEX automation_run_tags_tag_idx ON automation_run_tags(tag_id, automation_run_id);
