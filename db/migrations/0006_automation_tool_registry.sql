PRAGMA foreign_keys = ON;

ALTER TABLE automation_runs ADD COLUMN target_id TEXT
  CHECK (target_id IS NULL OR length(trim(target_id)) > 0);
ALTER TABLE automation_runs ADD COLUMN target_version INTEGER
  CHECK (target_version IS NULL OR target_version >= 1);
ALTER TABLE automation_runs ADD COLUMN target_name_snapshot TEXT
  CHECK (target_name_snapshot IS NULL OR length(trim(target_name_snapshot)) > 0);
ALTER TABLE automation_runs ADD COLUMN operation_id TEXT
  CHECK (operation_id IS NULL OR length(trim(operation_id)) > 0);
ALTER TABLE automation_runs ADD COLUMN input_payload_json TEXT
  CHECK (input_payload_json IS NULL OR (json_valid(input_payload_json) AND length(input_payload_json) <= 65536));
ALTER TABLE automation_runs ADD COLUMN output_payload_json TEXT
  CHECK (output_payload_json IS NULL OR (json_valid(output_payload_json) AND length(output_payload_json) <= 65536));
ALTER TABLE automation_runs ADD COLUMN error_code TEXT
  CHECK (error_code IS NULL OR length(trim(error_code)) BETWEEN 1 AND 120);

UPDATE automation_runs
   SET target_id = CASE automation_key
         WHEN 'inbox-to-drafts' THEN 'core.content-to-action-drafts'
         ELSE automation_key
       END,
       target_version = 1,
       target_name_snapshot = CASE automation_key
         WHEN 'inbox-to-drafts' THEN '从资料生成行动草稿'
         ELSE automation_key
       END,
       operation_id = id,
       input_payload_json = '{}',
       output_payload_json = CASE WHEN output_summary IS NULL THEN NULL ELSE '{}' END;

UPDATE automation_runs
   SET input_summary = '已选择 ' ||
       (SELECT count(*) FROM automation_run_inputs input WHERE input.run_id = automation_runs.id) || ' 条资料',
       output_summary = CASE WHEN status = 'completed' THEN
         '创建 ' || (SELECT count(*) FROM automation_run_outputs output WHERE output.run_id = automation_runs.id) ||
         ' 个草稿；跳过 ' ||
         ((SELECT count(*) FROM automation_run_inputs input WHERE input.run_id = automation_runs.id) -
          (SELECT count(*) FROM automation_run_outputs output WHERE output.run_id = automation_runs.id)) ||
         ' 条已有行动的资料。'
       ELSE output_summary END,
       input_payload_json = json_object(
         'contentItemIds', json(COALESCE((
           SELECT json_group_array(content_id) FROM automation_run_inputs input
            WHERE input.run_id = automation_runs.id ORDER BY ordinal
         ), '[]'))
       ),
       output_payload_json = CASE WHEN status = 'completed' THEN json_object(
         'created', (SELECT count(*) FROM automation_run_outputs output WHERE output.run_id = automation_runs.id),
         'skipped', (SELECT count(*) FROM automation_run_inputs input WHERE input.run_id = automation_runs.id) -
                    (SELECT count(*) FROM automation_run_outputs output WHERE output.run_id = automation_runs.id)
       ) ELSE NULL END
 WHERE target_id = 'core.content-to-action-drafts';

CREATE UNIQUE INDEX automation_runs_operation_uq ON automation_runs(operation_id);
CREATE INDEX automation_runs_live_history_idx
  ON automation_runs(created_at DESC, id DESC) WHERE trashed_at IS NULL;
CREATE INDEX automation_runs_live_target_history_idx
  ON automation_runs(target_id, created_at DESC, id DESC) WHERE trashed_at IS NULL;
CREATE INDEX automation_runs_live_status_history_idx
  ON automation_runs(status, created_at DESC, id DESC) WHERE trashed_at IS NULL;
CREATE INDEX automation_runs_live_target_status_history_idx
  ON automation_runs(target_id, status, created_at DESC, id DESC) WHERE trashed_at IS NULL;

CREATE TRIGGER automation_runs_require_formal_identity
BEFORE INSERT ON automation_runs
WHEN NEW.operation_id IS NULL OR length(trim(NEW.operation_id)) = 0
  OR NEW.target_id IS NULL OR length(trim(NEW.target_id)) = 0
  OR NEW.target_version IS NULL OR NEW.target_version < 1
  OR NEW.target_name_snapshot IS NULL OR length(trim(NEW.target_name_snapshot)) = 0
  OR NEW.automation_key <> NEW.target_id
  OR NEW.input_payload_json IS NULL
BEGIN
  SELECT RAISE(ABORT, 'automation_run_identity_required');
END;

CREATE TRIGGER automation_runs_protect_identity
BEFORE UPDATE OF operation_id, target_id, target_version, target_name_snapshot,
  automation_key, input_payload_json, input_summary, created_at, project_id, project_name_snapshot
ON automation_runs
WHEN NEW.operation_id IS NOT OLD.operation_id
  OR NEW.target_id IS NOT OLD.target_id
  OR NEW.target_version IS NOT OLD.target_version
  OR NEW.target_name_snapshot IS NOT OLD.target_name_snapshot
  OR NEW.automation_key IS NOT OLD.automation_key
  OR NEW.input_payload_json IS NOT OLD.input_payload_json
  OR NEW.input_summary IS NOT OLD.input_summary
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.project_name_snapshot IS NOT OLD.project_name_snapshot
  OR NOT (
    NEW.project_id IS OLD.project_id
    OR (OLD.project_id IS NOT NULL AND NEW.project_id IS NULL)
  )
BEGIN
  SELECT RAISE(ABORT, 'automation_run_provenance_immutable');
END;

CREATE TRIGGER automation_runs_protect_terminal_result
BEFORE UPDATE OF status, output_payload_json, output_summary, error_code, error_message, completed_at
ON automation_runs
WHEN OLD.status IN ('completed', 'failed') AND (
  NEW.status IS NOT OLD.status
  OR NEW.output_payload_json IS NOT OLD.output_payload_json
  OR NEW.output_summary IS NOT OLD.output_summary
  OR NEW.error_code IS NOT OLD.error_code
  OR NEW.error_message IS NOT OLD.error_message
  OR NEW.completed_at IS NOT OLD.completed_at
)
BEGIN
  SELECT RAISE(ABORT, 'automation_run_result_immutable');
END;

CREATE TRIGGER automation_runs_restrict_status_transition
BEFORE UPDATE OF status ON automation_runs
WHEN NEW.status IS NOT OLD.status
  AND NOT (OLD.status = 'running' AND NEW.status IN ('completed', 'failed'))
BEGIN
  SELECT RAISE(ABORT, 'automation_run_invalid_status_transition');
END;

DROP TRIGGER automation_search_insert;
DROP TRIGGER automation_search_update;
DROP TRIGGER automation_search_delete;

DELETE FROM automation_search_fts;
INSERT INTO automation_search_fts (object_id, title, metadata)
SELECT id, target_name_snapshot,
       target_id || ' ' || status || ' ' || input_summary || ' ' ||
       coalesce(output_summary, '') || ' ' || coalesce(error_message, '')
  FROM automation_runs;

CREATE TRIGGER automation_search_insert AFTER INSERT ON automation_runs BEGIN
  INSERT INTO automation_search_fts (object_id, title, metadata)
  VALUES (new.id, new.target_name_snapshot,
          new.target_id || ' ' || new.status || ' ' || new.input_summary || ' ' ||
          coalesce(new.output_summary, '') || ' ' || coalesce(new.error_message, ''));
END;
CREATE TRIGGER automation_search_update
AFTER UPDATE OF target_name_snapshot, target_id, status, input_summary, output_summary, error_message
ON automation_runs BEGIN
  DELETE FROM automation_search_fts WHERE object_id = old.id;
  INSERT INTO automation_search_fts (object_id, title, metadata)
  VALUES (new.id, new.target_name_snapshot,
          new.target_id || ' ' || new.status || ' ' || new.input_summary || ' ' ||
          coalesce(new.output_summary, '') || ' ' || coalesce(new.error_message, ''));
END;
CREATE TRIGGER automation_search_delete AFTER DELETE ON automation_runs BEGIN
  DELETE FROM automation_search_fts WHERE object_id = old.id;
END;
