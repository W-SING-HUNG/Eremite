CREATE TABLE ai_tool_run_proposals (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  ai_run_id TEXT NOT NULL UNIQUE REFERENCES ai_runs(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE,
  tool_id TEXT NOT NULL CHECK(tool_id IN ('core.file-converter', 'core.pdf-tools')),
  tool_version INTEGER NOT NULL CHECK(tool_version > 0),
  input_json TEXT NOT NULL CHECK(json_valid(input_json) AND length(input_json) BETWEEN 2 AND 32768),
  lifecycle TEXT NOT NULL DEFAULT 'pending' CHECK(lifecycle IN ('pending', 'rejected', 'stale', 'accepted')),
  automation_run_id TEXT UNIQUE REFERENCES automation_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK (automation_run_id IS NULL OR lifecycle = 'accepted'),
  CHECK ((lifecycle = 'pending') = (resolved_at IS NULL))
) STRICT;

CREATE INDEX ai_tool_run_proposals_message ON ai_tool_run_proposals(message_id, created_at);

CREATE TRIGGER ai_tool_run_proposals_require_pending_insert
BEFORE INSERT ON ai_tool_run_proposals
WHEN NEW.lifecycle <> 'pending' OR NEW.automation_run_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'ai_tool_run_proposal_pending_required'); END;

CREATE TRIGGER ai_tool_run_proposals_protect_identity
BEFORE UPDATE OF thread_id, message_id, ai_run_id, operation_id, tool_id, tool_version, input_json, created_at
ON ai_tool_run_proposals
BEGIN SELECT RAISE(ABORT, 'ai_tool_run_proposal_immutable'); END;

CREATE TRIGGER ai_tool_run_proposals_restrict_lifecycle
BEFORE UPDATE OF lifecycle ON ai_tool_run_proposals
WHEN NEW.lifecycle <> OLD.lifecycle AND NOT (OLD.lifecycle = 'pending' AND NEW.lifecycle IN ('rejected', 'stale', 'accepted'))
BEGIN SELECT RAISE(ABORT, 'ai_tool_run_proposal_invalid_transition'); END;

CREATE TRIGGER ai_tool_run_proposals_require_accepted_run
BEFORE UPDATE OF lifecycle ON ai_tool_run_proposals
WHEN NEW.lifecycle = 'accepted' AND NEW.automation_run_id IS NULL
BEGIN SELECT RAISE(ABORT, 'ai_tool_run_proposal_run_required'); END;
