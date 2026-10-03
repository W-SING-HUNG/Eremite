CREATE TABLE ai_message_activities (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 32),
  kind TEXT NOT NULL CHECK(kind IN ('search', 'content', 'project', 'actions', 'draft', 'update', 'tool-run')),
  state TEXT NOT NULL CHECK(state IN ('succeeded', 'failed', 'needs_input')),
  code TEXT CHECK(code IS NULL OR code IN ('ai_tool_invalid_arguments', 'ai_tool_unobserved_content', 'ai_tool_unobserved_project', 'ai_tool_host_rejected', 'ai_tool_ambiguous_target', 'ai_tool_execution_failed', 'ai_tool_run_unobserved_source', 'ai_tool_run_source_unavailable', 'ai_tool_run_unsupported_capability', 'ai_tool_run_invalid_parameters', 'ai_tool_run_unavailable')),
  created_at TEXT NOT NULL,
  UNIQUE(run_id, ordinal),
  CHECK((state = 'failed') = (code IS NOT NULL))
) STRICT;

CREATE INDEX ai_message_activities_message ON ai_message_activities(message_id, ordinal);

CREATE TRIGGER ai_message_activities_require_run_message BEFORE INSERT ON ai_message_activities
WHEN NOT EXISTS (SELECT 1 FROM ai_runs WHERE id = NEW.run_id AND message_id = NEW.message_id)
BEGIN SELECT RAISE(ABORT, 'ai_activity_run_message_mismatch'); END;

CREATE TRIGGER ai_message_activities_immutable BEFORE UPDATE ON ai_message_activities
BEGIN SELECT RAISE(ABORT, 'ai_activity_immutable'); END;
