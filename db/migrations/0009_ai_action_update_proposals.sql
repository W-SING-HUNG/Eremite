CREATE TABLE ai_action_update_proposals (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  action_revision INTEGER NOT NULL CHECK(action_revision > 0),
  before_title TEXT NOT NULL,
  before_priority TEXT NOT NULL CHECK(before_priority IN ('low', 'normal', 'high')),
  before_due_date TEXT,
  before_status TEXT NOT NULL CHECK(before_status = 'active'),
  patch_title TEXT,
  patch_priority TEXT CHECK(patch_priority IN ('low', 'normal', 'high')),
  patch_due_date_set INTEGER NOT NULL DEFAULT 0 CHECK(patch_due_date_set IN (0, 1)),
  patch_due_date TEXT,
  transition TEXT CHECK(transition IN ('done', 'cancelled')),
  lifecycle TEXT NOT NULL DEFAULT 'pending' CHECK(lifecycle IN ('pending', 'applying', 'applied', 'rejected', 'stale', 'unavailable', 'error')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  applied_revision INTEGER,
  CHECK(patch_title IS NOT NULL OR patch_priority IS NOT NULL OR patch_due_date_set = 1 OR transition IS NOT NULL)
) STRICT;

CREATE INDEX ai_action_update_proposals_message ON ai_action_update_proposals(message_id, created_at);
