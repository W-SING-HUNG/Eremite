ALTER TABLE automation_runs ADD COLUMN retry_of_run_id TEXT
  REFERENCES automation_runs(id) ON DELETE RESTRICT
  CHECK (retry_of_run_id IS NULL OR retry_of_run_id <> id);

CREATE UNIQUE INDEX automation_runs_retry_parent_uq
  ON automation_runs(retry_of_run_id) WHERE retry_of_run_id IS NOT NULL;

CREATE TRIGGER automation_runs_retry_identity_immutable
BEFORE UPDATE OF retry_of_run_id ON automation_runs
WHEN NEW.retry_of_run_id IS NOT OLD.retry_of_run_id
BEGIN SELECT RAISE(ABORT, 'automation_retry_identity_immutable'); END;

CREATE TRIGGER automation_runs_retry_require_failed_parent
BEFORE INSERT ON automation_runs
WHEN NEW.retry_of_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM automation_runs parent
  WHERE parent.id = NEW.retry_of_run_id AND parent.status = 'failed'
    AND parent.trashed_at IS NULL AND parent.output_payload_json IS NULL
    AND parent.target_id IN ('core.file-converter', 'core.pdf-tools')
    AND parent.target_id = NEW.target_id AND parent.target_version = NEW.target_version
    AND parent.input_payload_json = NEW.input_payload_json
    AND NEW.status = 'running' AND NEW.output_payload_json IS NULL
)
BEGIN SELECT RAISE(ABORT, 'automation_retry_parent_invalid'); END;

-- Preserve both lineage and its deduplication receipt. Trash remains available.
CREATE TRIGGER automation_runs_retry_preserve_history
BEFORE DELETE ON automation_runs
WHEN OLD.retry_of_run_id IS NOT NULL OR EXISTS (
  SELECT 1 FROM automation_runs child WHERE child.retry_of_run_id = OLD.id
)
BEGIN SELECT RAISE(ABORT, 'automation_retry_history_required'); END;
