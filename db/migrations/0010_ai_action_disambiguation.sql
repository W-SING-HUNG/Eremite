CREATE TABLE ai_action_disambiguations (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE REFERENCES ai_messages(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE REFERENCES ai_runs(id) ON DELETE CASCADE,
  reference_key TEXT NOT NULL CHECK(length(reference_key) BETWEEN 1 AND 240),
  patch_title TEXT,
  patch_priority TEXT CHECK(patch_priority IN ('low', 'normal', 'high')),
  patch_due_date_set INTEGER NOT NULL DEFAULT 0 CHECK(patch_due_date_set IN (0, 1)),
  patch_due_date TEXT,
  transition TEXT CHECK(transition IN ('done', 'cancelled')),
  lifecycle TEXT NOT NULL DEFAULT 'pending' CHECK(lifecycle IN ('pending', 'resolved', 'stale')),
  selected_action_id TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK(patch_title IS NOT NULL OR patch_priority IS NOT NULL OR patch_due_date_set = 1 OR transition IS NOT NULL)
) STRICT;

CREATE INDEX ai_action_disambiguations_thread ON ai_action_disambiguations(thread_id, created_at);

CREATE TABLE ai_action_disambiguation_candidates (
  disambiguation_id TEXT NOT NULL REFERENCES ai_action_disambiguations(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  action_revision INTEGER NOT NULL CHECK(action_revision > 0),
  title_snapshot TEXT NOT NULL,
  project_id TEXT,
  project_name_snapshot TEXT,
  due_date_snapshot TEXT,
  priority_snapshot TEXT NOT NULL CHECK(priority_snapshot IN ('low', 'normal', 'high')),
  created_at_snapshot TEXT NOT NULL,
  PRIMARY KEY(disambiguation_id, action_id)
) STRICT;

CREATE INDEX ai_action_disambiguation_candidates_action ON ai_action_disambiguation_candidates(action_id);
