CREATE TABLE ai_message_action_drafts (
  message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  action_revision_at_creation INTEGER NOT NULL CHECK(action_revision_at_creation > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(message_id, action_id),
  UNIQUE(run_id, action_id)
) STRICT;

CREATE INDEX ai_message_action_drafts_action ON ai_message_action_drafts(action_id);
