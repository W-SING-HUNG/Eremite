CREATE TABLE ai_threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX ai_threads_recent ON ai_threads(updated_at DESC, id DESC);

CREATE TABLE ai_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(thread_id, ordinal)
) STRICT;

CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE REFERENCES ai_messages(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL CHECK(task_id = 'ask-eremite.v1'),
  provider TEXT NOT NULL CHECK(provider = 'openai-compatible'),
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'cancelled', 'failed')),
  error_code TEXT CHECK(error_code IS NULL OR error_code IN ('ai_generation_failed', 'ai_cancelled', 'ai_timeout', 'ai_interrupted', 'ai_tool_call_invalid', 'ai_step_limit')),
  input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  deadline_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX ai_runs_one_active ON ai_runs(thread_id) WHERE status = 'running';
CREATE INDEX ai_runs_thread ON ai_runs(thread_id, created_at);

CREATE TABLE ai_message_sources (
  message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  module TEXT NOT NULL CHECK(module IN ('inbox', 'projects', 'actions')),
  entity TEXT NOT NULL CHECK(entity IN ('content', 'project', 'action')),
  entity_id TEXT NOT NULL,
  revision INTEGER CHECK(revision IS NULL OR revision >= 0),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 240),
  href TEXT NOT NULL CHECK(substr(href, 1, 1) = '/' AND length(href) <= 1000),
  PRIMARY KEY(message_id, source_key)
) STRICT;
CREATE INDEX ai_message_sources_entity ON ai_message_sources(module, entity, entity_id);
