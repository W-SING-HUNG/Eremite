import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const directory = await mkdtemp(path.join(tmpdir(), "eremite-flow-"));
try {
  const db = new DatabaseSync(path.join(directory, "app.sqlite"));
  db.exec(await readFile(path.join(process.cwd(), "db", "migrations", "0001_initial.sql"), "utf8"));
  const stamp = "2026-01-01T00:00:00.000Z";
  const sourceBytes = Buffer.from("source material");
  const hash = createHash("sha256").update(sourceBytes).digest("hex");
  await writeFile(path.join(directory, hash), sourceBytes);
  db.prepare("INSERT INTO file_assets VALUES (?, ?, ?, ?, ?, ?, ?)").run("asset-1", hash, "source.pdf", "application/pdf", sourceBytes.length, hash, stamp);
  db.prepare("INSERT INTO content_items (id, kind, title, file_asset_id, tags, status, created_at, updated_at) VALUES (?, 'file', ?, ?, '', 'inbox', ?, ?)").run("content-1", "Course outline", "asset-1", stamp, stamp);
  db.prepare("INSERT INTO actions (id, title, status, priority, sort_order, created_at, updated_at) VALUES (?, ?, 'draft', 'normal', 0, ?, ?)").run("action-1", "Course outline", stamp, stamp);
  db.prepare("INSERT INTO action_content_items VALUES (?, ?, ?)").run("action-1", "content-1", stamp);
  assert.throws(() => db.prepare("INSERT INTO action_content_items VALUES (?, ?, ?)").run("action-1", "content-1", stamp));
  assert.equal(db.prepare("SELECT status FROM actions WHERE id = ?").get("action-1").status, "draft");
  db.prepare("INSERT INTO automation_runs (id, automation_key, status, input_summary, output_summary, created_at, completed_at) VALUES (?, ?, 'completed', ?, ?, ?, ?)").run("run-1", "inbox-to-drafts", "1 selected item(s)", "Created 1 draft(s); skipped 0.", stamp, stamp);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_runs").get().count, 1);
  await backup(db, path.join(directory, "backup.sqlite"));
  const restored = new DatabaseSync(path.join(directory, "backup.sqlite"), { readOnly: true });
  assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM action_content_items").get().count, 1);
  await copyFile(path.join(directory, hash), path.join(directory, `${hash}.restored`));
  const restoredBytes = await readFile(path.join(directory, `${hash}.restored`));
  assert.equal(createHash("sha256").update(restoredBytes).digest("hex"), hash);
  restored.close();
  db.close();
  console.log("Core flow and backup test passed.");
} finally { await rm(directory, { recursive: true, force: true }); }
