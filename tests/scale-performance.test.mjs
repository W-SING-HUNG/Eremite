import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-scale-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let databaseModule;
try {
  databaseModule = await import("@/platform/db/database");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const inbox = await import("@/modules/inbox/service");
  const search = await import("@/modules/search/service");
  const automations = await import("@/modules/automations/service");
  const reconciliation = await import("@/modules/automations/reconciliation");
  const projectId = projects.createProject({ name: "规模基准" });
  let parentId = null;
  for (let depth = 0; depth < 64; depth += 1) parentId = folders.createFolder({ projectId, parentId, name: `深度 ${depth}` });

  const connection = databaseModule.db();
  const timestamp = new Date().toISOString();
  const insertFolder = connection.prepare("INSERT INTO folders (id, project_id, parent_id, name, name_key, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)");
  const insertContent = connection.prepare("INSERT INTO content_items (id, kind, title, source_url, tags, status, project_id, created_at, updated_at) VALUES (?, 'link', ?, ?, '', 'inbox', ?, ?, ?)");
  const insertAction = connection.prepare("INSERT INTO actions (id, title, status, priority, project_id, created_at, updated_at) VALUES (?, ?, 'active', 'normal', ?, ?, ?)");
  const scaleToolId = "scale.performance-tool";
  const insertRun = connection.prepare(
    `INSERT INTO automation_runs (
       id, automation_key, target_id, target_version, target_name_snapshot, operation_id,
       status, input_summary, input_payload_json, project_id, project_name_snapshot, created_at, completed_at
     ) VALUES (?, ?, ?, 1, '规模性能工具', ?, 'completed', ?, '{}', ?, '规模基准', ?, ?)`,
  );
  connection.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < 100_000; index += 1) {
      const id = `scale-folder-${String(index).padStart(12, "0")}`; const name = `规模目录 ${index}`;
      insertFolder.run(id, projectId, name, name.toLocaleLowerCase("und"), timestamp, timestamp);
    }
    for (let index = 0; index < 200_000; index += 1) {
      const needle = index % 20_000 === 0 ? " 性能针" : "";
      insertContent.run(`scale-content-${String(index).padStart(12, "0")}`, `规模资料 ${index}${needle}`, `https://example.com/${index}`, projectId, timestamp, timestamp);
    }
    for (let index = 0; index < 100_000; index += 1) insertAction.run(`scale-action-${String(index).padStart(12, "0")}`, `规模行动 ${index}${index % 20_000 === 0 ? " 性能针" : ""}`, projectId, timestamp, timestamp);
    for (let index = 0; index < 100_000; index += 1) {
      const id = `scale-run-${String(index).padStart(12, "0")}`;
      insertRun.run(id, scaleToolId, scaleToolId, `scale-operation-${String(index).padStart(12, "0")}`, `规模运行 ${index}${index % 20_000 === 0 ? " 性能针" : ""}`, projectId, timestamp, timestamp);
    }
    connection.exec("COMMIT");
  } catch (error) { connection.exec("ROLLBACK"); throw error; }

  assert.equal(Number(connection.prepare("SELECT (SELECT count(*) FROM content_items) + (SELECT count(*) FROM actions) + (SELECT count(*) FROM automation_runs) + (SELECT count(*) FROM folders) AS count").get().count), 500_064);
  assert.equal(folders.getFolderBreadcrumbs(parentId).length, 64, "Folder depth is not product-limited to two or three levels");
  const metrics = {
    keyset: p95(() => inbox.listContentItemsPage({ limit: 50 })),
    rootFolders: p95(() => folders.listChildFoldersPage(projectId, null, { limit: 50 })),
    projectSearch: p95(() => search.searchWorkspace({ query: "性能针", scope: "project", projectId, limit: 50 })),
    runHistory: p95(() => automations.listAutomationRunsPage({ limit: 50, targetId: scaleToolId, status: "completed" })),
    reconciliation: p95(() => reconciliation.reconcileInterruptedAutomationRuns({ now: new Date("2030-01-01T00:00:00.000Z") })),
  };
  assert.ok(metrics.keyset < 250, `keyset p95 ${metrics.keyset.toFixed(1)} ms exceeded 250 ms`);
  assert.ok(metrics.rootFolders < 250, `folder child query p95 ${metrics.rootFolders.toFixed(1)} ms exceeded 250 ms`);
  assert.ok(metrics.projectSearch < 250, `project search p95 ${metrics.projectSearch.toFixed(1)} ms exceeded 250 ms`);
  assert.ok(metrics.runHistory < 250, `Run history p95 ${metrics.runHistory.toFixed(1)} ms exceeded 250 ms`);
  assert.ok(metrics.reconciliation < 250, `reconciliation p95 ${metrics.reconciliation.toFixed(1)} ms exceeded 250 ms`);
  const runPlan = connection.prepare(
    "EXPLAIN QUERY PLAN SELECT * FROM automation_runs WHERE trashed_at IS NULL AND target_id = ? AND status = 'completed' ORDER BY created_at DESC, id DESC LIMIT 50",
  ).all(scaleToolId).map((row) => String(row.detail)).join(" ");
  assert.match(runPlan, /USING (?:COVERING )?INDEX/, `Run history must use an index: ${runPlan}`);
  assert.doesNotMatch(runPlan, /USE TEMP B-TREE/, `Run history must preserve index order: ${runPlan}`);
  assert.equal(connection.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(connection.prepare("PRAGMA foreign_key_check").all(), []);
  console.log(`Scale performance test passed at 500,064 objects: keyset ${metrics.keyset.toFixed(1)} ms, folders ${metrics.rootFolders.toFixed(1)} ms, Project search ${metrics.projectSearch.toFixed(1)} ms, Run history ${metrics.runHistory.toFixed(1)} ms and reconciliation ${metrics.reconciliation.toFixed(1)} ms p95.`);
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

function p95(operation) {
  for (let warmup = 0; warmup < 2; warmup += 1) operation();
  const samples = [];
  for (let sample = 0; sample < 9; sample += 1) { const started = performance.now(); operation(); samples.push(performance.now() - started); }
  samples.sort((a, b) => a - b);
  return samples[Math.ceil(samples.length * .95) - 1];
}
