import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const directory = await mkdtemp(path.join(tmpdir(), "eremite-test-"));
try {
  const db = new DatabaseSync(path.join(directory, "app.sqlite"));
  db.exec("PRAGMA foreign_keys = ON");
  db.function("eremite_uuidv7", (() => { let value = 0; return () => `generated-${++value}`; })());
  db.function("eremite_normalize_key", (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase());
  const initial = await readFile(path.join(process.cwd(), "db", "migrations", "0001_initial.sql"), "utf8");
  const lifecycle = await readFile(path.join(process.cwd(), "db", "migrations", "0002_file_lifecycle.sql"), "utf8");
  const organization = await readFile(path.join(process.cwd(), "db", "migrations", "0003_projects_tags_trash.sql"), "utf8");
  const search = await readFile(path.join(process.cwd(), "db", "migrations", "0004_metadata_search.sql"), "utf8");
  const compatibility = await readFile(path.join(process.cwd(), "db", "migrations", "0005_compatibility_pagination.sql"), "utf8");
  const automation = await readFile(path.join(process.cwd(), "db", "migrations", "0006_automation_tool_registry.sql"), "utf8");
  const conversations = await readFile(path.join(process.cwd(), "db", "migrations", "0007_ai_conversations.sql"), "utf8");
  const aiActionDrafts = await readFile(path.join(process.cwd(), "db", "migrations", "0008_ai_action_drafts.sql"), "utf8");
  const aiActionUpdates = await readFile(path.join(process.cwd(), "db", "migrations", "0009_ai_action_update_proposals.sql"), "utf8");
  const aiActionDisambiguation = await readFile(path.join(process.cwd(), "db", "migrations", "0010_ai_action_disambiguation.sql"), "utf8");
  const aiToolRunProposals = await readFile(path.join(process.cwd(), "db", "migrations", "0011_ai_tool_run_proposals.sql"), "utf8");
  const aiMessageActivities = await readFile(path.join(process.cwd(), "db", "migrations", "0012_ai_message_activities.sql"), "utf8");
  db.exec(initial);
  const stamp = "2026-01-01T00:00:00.000Z";
  db.prepare("INSERT INTO file_assets VALUES (?, ?, ?, ?, ?, ?, ?)").run("shared-asset", "a".repeat(64), "original.txt", "text/plain", 7, "a".repeat(64), stamp);
  db.prepare("INSERT INTO content_items VALUES (?, 'file', ?, NULL, ?, '', 'inbox', ?, ?)").run("content-a", "A", "shared-asset", stamp, stamp);
  db.prepare("INSERT INTO content_items VALUES (?, 'file', ?, NULL, ?, '', 'processed', ?, ?)").run("content-b", "B", "shared-asset", stamp, stamp);
  db.prepare("INSERT INTO actions (id, title, status, priority, sort_order, created_at, updated_at) VALUES ('action-a', 'A', 'draft', 'normal', 0, ?, ?)").run(stamp, stamp);
  db.prepare("INSERT INTO action_content_items VALUES ('action-a', 'content-a', ?)").run(stamp);
  db.prepare("INSERT INTO automation_runs (id, automation_key, status, input_summary, output_summary, created_at, completed_at) VALUES ('legacy-run', 'inbox-to-drafts', 'completed', '1 selected item(s)', 'Created 1 draft(s); skipped 0.', ?, ?)").run(stamp, stamp);
  db.exec("BEGIN IMMEDIATE");
  try { db.exec(lifecycle); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
  db.prepare("UPDATE content_items SET tags = '学习， 资料,学习' WHERE id = 'content-a'").run();
  db.exec("BEGIN IMMEDIATE");
  try { db.exec(organization); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
  db.exec("BEGIN IMMEDIATE");
  try { db.exec(search); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
  db.exec("BEGIN IMMEDIATE");
  try { db.exec(compatibility); db.exec(automation); db.exec(conversations); db.exec(aiActionDrafts); db.exec(aiActionUpdates); db.exec(aiActionDisambiguation); db.exec(aiToolRunProposals); db.exec(aiMessageActivities); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  for (const table of ['ai_threads', 'ai_messages', 'ai_runs', 'ai_message_sources', 'ai_message_action_drafts', 'ai_action_update_proposals', 'ai_action_disambiguations', 'ai_action_disambiguation_candidates']) assert.ok(tables.includes(table));
  for (const table of ["ai_tool_run_proposals", "ai_message_activities"]) assert.ok(tables.includes(table));
  const schema = new Map(db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger')").all().map((row) => [row.name, row]));
  for (const name of [
    "ai_tool_run_proposals_message", "ai_tool_run_proposals_require_pending_insert",
    "ai_tool_run_proposals_protect_identity", "ai_tool_run_proposals_restrict_lifecycle",
    "ai_tool_run_proposals_require_accepted_run", "ai_message_activities_message",
    "ai_message_activities_require_run_message", "ai_message_activities_immutable",
  ]) assert.ok(schema.has(name), `${name} must exist`);
  assert.equal(schema.get("ai_tool_run_proposals_message").type, "index");
  assert.equal(schema.get("ai_message_activities_message").type, "index");
  for (const name of ["ai_tool_run_proposals_require_pending_insert", "ai_tool_run_proposals_protect_identity", "ai_tool_run_proposals_restrict_lifecycle", "ai_tool_run_proposals_require_accepted_run", "ai_message_activities_require_run_message", "ai_message_activities_immutable"]) {
    assert.equal(schema.get(name).type, "trigger");
  }
  assert.match(schema.get("ai_tool_run_proposals").sql, /CHECK\(tool_id IN \('core\.file-converter', 'core\.pdf-tools'\)\)/u);
  assert.match(schema.get("ai_tool_run_proposals").sql, /CHECK\(lifecycle IN \('pending', 'rejected', 'stale', 'accepted'\)\)/u);
  assert.match(schema.get("ai_message_activities").sql, /UNIQUE\(run_id, ordinal\)/u);
  assert.match(schema.get("ai_message_activities").sql, /CHECK\(\(state = 'failed'\) = \(code IS NOT NULL\)\)/u);
  assert.equal(db.prepare("PRAGMA foreign_key_list(ai_tool_run_proposals)").all().length, 4);
  assert.equal(db.prepare("PRAGMA foreign_key_list(ai_message_activities)").all().length, 2);
  for (const table of ["projects", "folders", "tags", "content_item_tags", "automation_run_inputs", "automation_run_outputs", "content_search_fts", "folder_search_fts", "content_items", "file_assets", "file_blobs", "file_versions", "file_write_operations", "blob_gc_queue", "actions", "action_content_items", "automation_runs", "sessions", "app_settings"]) assert.ok(tables.includes(table));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM content_items").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM file_assets").get().count, 2, "each content item receives a stable logical asset");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM file_versions").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM file_blobs").get().count, 1, "identical bytes remain one shared CAS blob");
  assert.equal(db.prepare("SELECT content_item_id FROM action_content_items").get().content_item_id, "content-a");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tags").get().count, 2, "legacy comma variants are normalized and deduplicated");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM content_item_tags").get().count, 2);
  const migratedRun = db.prepare("SELECT * FROM automation_runs WHERE id = 'legacy-run'").get();
  assert.equal(migratedRun.target_id, "core.content-to-action-drafts");
  assert.equal(migratedRun.target_version, 1);
  assert.equal(migratedRun.target_name_snapshot, "从资料生成行动草稿");
  assert.equal(migratedRun.operation_id, "legacy-run");
  assert.equal(migratedRun.automation_key, "inbox-to-drafts", "legacy shadow preserves released data");
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.throws(() => db.prepare("INSERT INTO action_content_items (action_id, content_item_id, created_at) VALUES ('missing', 'missing', 'now')").run());
  assert.throws(() => db.prepare("INSERT INTO content_items (id, kind, title, tags, status, created_at, updated_at) VALUES ('x', 'file', 'broken', '', 'inbox', 'now', 'now')").run());
  db.close();
  console.log("Migration test passed: populated v1 data upgrades through 0012, including AI tool proposals and durable activities.");
} finally { await rm(directory, { recursive: true, force: true }); }
