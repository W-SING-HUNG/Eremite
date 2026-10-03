PRAGMA foreign_keys = ON;

CREATE VIRTUAL TABLE content_search_fts USING fts5(
  object_id UNINDEXED,
  title,
  metadata,
  tokenize = 'trigram case_sensitive 0'
);

CREATE VIRTUAL TABLE action_search_fts USING fts5(
  object_id UNINDEXED,
  title,
  metadata,
  tokenize = 'trigram case_sensitive 0'
);

CREATE VIRTUAL TABLE automation_search_fts USING fts5(
  object_id UNINDEXED,
  title,
  metadata,
  tokenize = 'trigram case_sensitive 0'
);

CREATE VIRTUAL TABLE project_search_fts USING fts5(
  object_id UNINDEXED,
  title,
  metadata,
  tokenize = 'trigram case_sensitive 0'
);

CREATE VIRTUAL TABLE folder_search_fts USING fts5(
  object_id UNINDEXED,
  title,
  metadata,
  tokenize = 'trigram case_sensitive 0'
);

INSERT INTO content_search_fts (object_id, title, metadata)
SELECT id, title, coalesce(tags, '') || ' ' || coalesce(source_url, '') || ' ' || status || ' ' || kind FROM content_items;
INSERT INTO action_search_fts (object_id, title, metadata)
SELECT id, title, status || ' ' || priority || ' ' || coalesce(due_date, '') FROM actions;
INSERT INTO automation_search_fts (object_id, title, metadata)
SELECT id, input_summary, automation_key || ' ' || status || ' ' || coalesce(output_summary, '') || ' ' || coalesce(error_message, '') FROM automation_runs;
INSERT INTO project_search_fts (object_id, title, metadata)
SELECT id, name, description FROM projects;
INSERT INTO folder_search_fts (object_id, title, metadata)
SELECT id, name, '' FROM folders;

CREATE TRIGGER content_search_insert AFTER INSERT ON content_items BEGIN
  INSERT INTO content_search_fts (object_id, title, metadata)
  VALUES (new.id, new.title, coalesce(new.tags, '') || ' ' || coalesce(new.source_url, '') || ' ' || new.status || ' ' || new.kind);
END;
CREATE TRIGGER content_search_update AFTER UPDATE OF title, tags, source_url, status, kind ON content_items BEGIN
  DELETE FROM content_search_fts WHERE object_id = old.id;
  INSERT INTO content_search_fts (object_id, title, metadata)
  VALUES (new.id, new.title, coalesce(new.tags, '') || ' ' || coalesce(new.source_url, '') || ' ' || new.status || ' ' || new.kind);
END;
CREATE TRIGGER content_search_delete AFTER DELETE ON content_items BEGIN
  DELETE FROM content_search_fts WHERE object_id = old.id;
END;

CREATE TRIGGER action_search_insert AFTER INSERT ON actions BEGIN
  INSERT INTO action_search_fts (object_id, title, metadata)
  VALUES (new.id, new.title, new.status || ' ' || new.priority || ' ' || coalesce(new.due_date, ''));
END;
CREATE TRIGGER action_search_update AFTER UPDATE OF title, status, priority, due_date ON actions BEGIN
  DELETE FROM action_search_fts WHERE object_id = old.id;
  INSERT INTO action_search_fts (object_id, title, metadata)
  VALUES (new.id, new.title, new.status || ' ' || new.priority || ' ' || coalesce(new.due_date, ''));
END;
CREATE TRIGGER action_search_delete AFTER DELETE ON actions BEGIN
  DELETE FROM action_search_fts WHERE object_id = old.id;
END;

CREATE TRIGGER automation_search_insert AFTER INSERT ON automation_runs BEGIN
  INSERT INTO automation_search_fts (object_id, title, metadata)
  VALUES (new.id, new.input_summary, new.automation_key || ' ' || new.status || ' ' || coalesce(new.output_summary, '') || ' ' || coalesce(new.error_message, ''));
END;
CREATE TRIGGER automation_search_update AFTER UPDATE OF input_summary, automation_key, status, output_summary, error_message ON automation_runs BEGIN
  DELETE FROM automation_search_fts WHERE object_id = old.id;
  INSERT INTO automation_search_fts (object_id, title, metadata)
  VALUES (new.id, new.input_summary, new.automation_key || ' ' || new.status || ' ' || coalesce(new.output_summary, '') || ' ' || coalesce(new.error_message, ''));
END;
CREATE TRIGGER automation_search_delete AFTER DELETE ON automation_runs BEGIN
  DELETE FROM automation_search_fts WHERE object_id = old.id;
END;

CREATE TRIGGER project_search_insert AFTER INSERT ON projects BEGIN
  INSERT INTO project_search_fts (object_id, title, metadata) VALUES (new.id, new.name, new.description);
END;
CREATE TRIGGER project_search_update AFTER UPDATE OF name, description ON projects BEGIN
  DELETE FROM project_search_fts WHERE object_id = old.id;
  INSERT INTO project_search_fts (object_id, title, metadata) VALUES (new.id, new.name, new.description);
END;
CREATE TRIGGER project_search_delete AFTER DELETE ON projects BEGIN
  DELETE FROM project_search_fts WHERE object_id = old.id;
END;

CREATE TRIGGER folder_search_insert AFTER INSERT ON folders BEGIN
  INSERT INTO folder_search_fts (object_id, title, metadata) VALUES (new.id, new.name, '');
END;
CREATE TRIGGER folder_search_update AFTER UPDATE OF name ON folders BEGIN
  DELETE FROM folder_search_fts WHERE object_id = old.id;
  INSERT INTO folder_search_fts (object_id, title, metadata) VALUES (new.id, new.name, '');
END;
CREATE TRIGGER folder_search_delete AFTER DELETE ON folders BEGIN
  DELETE FROM folder_search_fts WHERE object_id = old.id;
END;

CREATE INDEX content_items_updated_keyset_idx ON content_items(trashed_at, updated_at DESC, id DESC);
CREATE INDEX actions_updated_keyset_idx ON actions(trashed_at, updated_at DESC, id DESC);
