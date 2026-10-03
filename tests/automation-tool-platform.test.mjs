import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-automation-platform-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let databaseModule;
try {
  databaseModule = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const projects = await import("@/modules/projects/service");
  const actions = await import("@/modules/actions/service");
  const automations = await import("@/modules/automations/service");
  const registry = await import("@/modules/automations/registry");
  const reconciliation = await import("@/modules/automations/reconciliation");
  const { CONTENT_TO_ACTION_DRAFTS_TOOL_ID } = await import("@/modules/automations/tools/catalog");
  registry.assertServerRegistryParity();
  const uiRegistrySource = await readFile(new URL("../src/app/_components/automations/tool-ui-registry.tsx", import.meta.url), "utf8");
  const workspaceShellSource = await readFile(new URL("../src/app/_components/workspace-shell.tsx", import.meta.url), "utf8");
  const searchServiceSource = await readFile(new URL("../src/modules/search/service.ts", import.meta.url), "utf8");
  assert.match(uiRegistrySource, /\[CONTENT_TO_ACTION_DRAFTS_TOOL_ID\]: \{ Launcher: ContentToActionDraftsLauncher \}/);
  assert.match(uiRegistrySource, /catalogIds[\s\S]*clientIds[\s\S]*automation_client_registry_drift/);
  assert.match(workspaceShellSource, /matchingToolCommands/);
  assert.match(workspaceShellSource, /运行：\$\{tool\.name\}/);
  assert.doesNotMatch(searchServiceSource, /toolCatalog|searchToolCommands/, "full data Search must not return capability definitions");

  const projectId = projects.createProject({ name: "自动化验收" });
  const sourceA = inbox.createLinkContentItem({ title: "资料 A", url: "https://example.com/a", projectId });
  const operationId = "11111111-1111-7111-8111-111111111111";
  const first = automations.executeTool({ operationId, toolId: CONTENT_TO_ACTION_DRAFTS_TOOL_ID, rawInput: { contentItemIds: [sourceA] }, projectId });
  assert.equal(first.status, "completed");
  const firstRun = databaseModule.one("SELECT * FROM automation_runs WHERE id = ?", first.runId);
  assert.equal(firstRun.target_id, CONTENT_TO_ACTION_DRAFTS_TOOL_ID);
  assert.equal(firstRun.automation_key, firstRun.target_id, "legacy shadow is written only as the formal target ID");
  assert.equal(firstRun.operation_id, operationId);
  assert.equal(firstRun.output_action_id, null, "deprecated convenience output stays unused");
  assert.equal(databaseModule.one("SELECT count(*) AS count FROM automation_run_outputs WHERE run_id = ?", first.runId).count, 1);

  const duplicate = automations.executeTool({ operationId, toolId: CONTENT_TO_ACTION_DRAFTS_TOOL_ID, rawInput: { contentItemIds: [sourceA] }, projectId });
  assert.deepEqual(duplicate, { runId: first.runId, reused: true, status: "completed" });
  assert.equal(databaseModule.one("SELECT count(*) AS count FROM automation_runs WHERE operation_id = ?", operationId).count, 1);
  assert.throws(() => automations.executeTool({ operationId, toolId: CONTENT_TO_ACTION_DRAFTS_TOOL_ID, rawInput: { contentItemIds: [] }, projectId }), /no_inputs/);

  assert.throws(() => databaseModule.run(
    `INSERT INTO automation_runs (id, automation_key, status, input_summary, created_at) VALUES ('bad', 'legacy', 'running', 'bad', ?)` ,
    new Date().toISOString(),
  ), /automation_run_identity_required/);
  assert.throws(() => databaseModule.run("UPDATE automation_runs SET target_id = 'changed' WHERE id = ?", first.runId), /automation_run_provenance_immutable/);

  const sourceB = inbox.createLinkContentItem({ title: "资料 B", url: "https://example.com/b", projectId });
  const sourceC = inbox.createLinkContentItem({ title: "资料 C", url: "https://example.com/c", projectId });
  assert.throws(() => automations.executeTool({ operationId, toolId: CONTENT_TO_ACTION_DRAFTS_TOOL_ID, rawInput: { contentItemIds: [sourceB] }, projectId }), /idempotency_conflict/);
  databaseModule.db().exec("CREATE TRIGGER automation_platform_force_second_failure BEFORE INSERT ON actions WHEN NEW.title = '资料 C' BEGIN SELECT RAISE(ABORT, 'forced_batch_failure'); END;");
  const failed = automations.executeTool({
    operationId: "22222222-2222-7222-8222-222222222222",
    toolId: CONTENT_TO_ACTION_DRAFTS_TOOL_ID,
    rawInput: { contentItemIds: [sourceB, sourceC] }, projectId,
  });
  databaseModule.db().exec("DROP TRIGGER automation_platform_force_second_failure");
  assert.equal(failed.status, "failed");
  assert.equal(actions.hasActionForContentItem(sourceB), false, "the first Action rolls back when the second Action fails");
  assert.equal(actions.hasActionForContentItem(sourceC), false);
  assert.equal(databaseModule.one("SELECT count(*) AS count FROM automation_run_outputs WHERE run_id = ?", failed.runId).count, 0);

  const staleCreatedAt = "2026-08-20T00:00:00.000Z";
  databaseModule.run(
    `INSERT INTO automation_runs (
       id, automation_key, target_id, target_version, target_name_snapshot, operation_id,
       status, input_summary, input_payload_json, created_at
     ) VALUES (?, ?, ?, 1, '从资料生成行动草稿', ?, 'running', '已选择 1 条资料', '{}', ?)`,
    "stale-request", CONTENT_TO_ACTION_DRAFTS_TOOL_ID, CONTENT_TO_ACTION_DRAFTS_TOOL_ID,
    "33333333-3333-7333-8333-333333333333", staleCreatedAt,
  );
  databaseModule.run(
    `INSERT INTO automation_runs (
       id, automation_key, target_id, target_version, target_name_snapshot, operation_id,
       status, input_summary, input_payload_json, created_at
     ) VALUES (?, 'future.background', 'future.background', 1, '未来后台工具', ?, 'running', '测试', '{}', ?)`,
    "future-background", "44444444-4444-7444-8444-444444444444", staleCreatedAt,
  );
  const report = reconciliation.reconcileInterruptedAutomationRuns({ now: new Date("2026-08-22T00:00:00.000Z") });
  assert.equal(report.reconciled, 1);
  assert.equal(databaseModule.one("SELECT status FROM automation_runs WHERE id = 'stale-request'").status, "failed");
  assert.equal(databaseModule.one("SELECT status FROM automation_runs WHERE id = 'future-background'").status, "running", "unknown/future execution contracts are never subject to the request timeout");
  assert.equal(reconciliation.reconcileInterruptedAutomationRuns({ now: new Date("2026-08-22T00:00:00.000Z") }).reconciled, 0, "reconciliation is idempotent");

  const plans = {
    operation: databaseModule.all("EXPLAIN QUERY PLAN SELECT * FROM automation_runs WHERE operation_id = ?", operationId),
    global: databaseModule.all("EXPLAIN QUERY PLAN SELECT * FROM automation_runs WHERE trashed_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 50"),
    target: databaseModule.all("EXPLAIN QUERY PLAN SELECT * FROM automation_runs WHERE trashed_at IS NULL AND target_id = ? ORDER BY created_at DESC, id DESC LIMIT 50", CONTENT_TO_ACTION_DRAFTS_TOOL_ID),
    status: databaseModule.all("EXPLAIN QUERY PLAN SELECT * FROM automation_runs WHERE trashed_at IS NULL AND status = 'completed' ORDER BY created_at DESC, id DESC LIMIT 50"),
    combined: databaseModule.all("EXPLAIN QUERY PLAN SELECT * FROM automation_runs WHERE trashed_at IS NULL AND target_id = ? AND status = 'completed' ORDER BY created_at DESC, id DESC LIMIT 50", CONTENT_TO_ACTION_DRAFTS_TOOL_ID),
    reconciliation: databaseModule.all("EXPLAIN QUERY PLAN SELECT id FROM automation_runs WHERE trashed_at IS NULL AND target_id = ? AND status = 'running' AND created_at < ? ORDER BY created_at ASC, id ASC LIMIT 100", CONTENT_TO_ACTION_DRAFTS_TOOL_ID, "2026-08-22T00:00:00.000Z"),
  };
  for (const [name, rows] of Object.entries(plans)) {
    const detail = rows.map((row) => String(row.detail)).join(" ");
    assert.match(detail, /USING (?:COVERING )?INDEX/, `${name} query must use an index: ${detail}`);
    assert.doesNotMatch(detail, /USE TEMP B-TREE/, `${name} query must preserve index order: ${detail}`);
  }
  assert.equal(databaseModule.all("PRAGMA table_info(automation_runs)").some((column) => String(column.name).startsWith("progress_")), false);
  assert.equal(databaseModule.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(databaseModule.all("PRAGMA foreign_key_check"), []);
  console.log("Automation tool platform test passed: registry parity, idempotent Run identity, atomic cross-module output, immutable provenance, scoped reconciliation and indexed history.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
