import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-file-converter-recovery-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let database;
try {
  database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const reconciliation = await import("@/modules/automations/reconciliation");
  const { FILE_CONVERTER_TOOL_ID } = await import("@/modules/automations/tools/catalog");
  const createdAt = "2026-08-29T00:00:00.000Z";
  const runId = "11111111-1111-7111-8111-111111111111";
  const supplier = { coreVersion: "1.1.0", engine: { id: "sharp", version: "sharp-test" }, fallback: { used: false }, durationMs: 10, warnings: [] };
  database.run(`INSERT INTO automation_runs (id, automation_key, target_id, target_version, target_name_snapshot, operation_id, status, input_summary, input_payload_json, output_payload_json, created_at) VALUES (?, ?, ?, 1, '文件格式转换器', ?, 'running', '恢复测试', ?, ?, ?)`, runId, FILE_CONVERTER_TOOL_ID, FILE_CONVERTER_TOOL_ID, "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa", JSON.stringify({ schemaVersion: 1, conversionId: "png-to-jpeg" }), JSON.stringify({ schemaVersion: 1, phase: "supplier_validated", output: { byteSize: 4, sha256: "x", format: { formatId: "jpeg" } }, supplier }), createdAt);
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const contentId = await inbox.createFileContentItemFromStream({ body: new File([bytes], "recovered.jpg", { type: "image/jpeg" }).stream(), originalName: "recovered.jpg", mimeType: "image/jpeg", expectedSize: bytes.length, idempotencyKey: `automation:${runId}:output:0` });
  const report = reconciliation.reconcileInterruptedAutomationRuns({ now: new Date("2026-08-30T00:00:00.000Z") });
  assert.equal(report.reconciled, 1);
  const recovered = database.one("SELECT status, output_payload_json FROM automation_runs WHERE id = ?", runId);
  assert.equal(recovered.status, "completed"); assert.equal(JSON.parse(recovered.output_payload_json).contentId, contentId);

  const failedId = "22222222-2222-7222-8222-222222222222";
  database.run(`INSERT INTO automation_runs (id, automation_key, target_id, target_version, target_name_snapshot, operation_id, status, input_summary, input_payload_json, output_payload_json, created_at) VALUES (?, ?, ?, 1, '文件格式转换器', ?, 'running', '失败恢复测试', ?, ?, ?)`, failedId, FILE_CONVERTER_TOOL_ID, FILE_CONVERTER_TOOL_ID, "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb", JSON.stringify({ schemaVersion: 1, conversionId: "png-to-jpeg" }), JSON.stringify({ schemaVersion: 1, phase: "supplier_validated", supplier }), createdAt);
  const second = reconciliation.reconcileInterruptedAutomationRuns({ now: new Date("2026-08-30T00:00:00.000Z") });
  assert.equal(second.reconciled, 1); assert.equal(database.one("SELECT status FROM automation_runs WHERE id = ?", failedId).status, "failed");
  assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok"); assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
  console.log("File Converter recovery gate passed: committed File Lifecycle output completes stale Run; missing output fails safely.");
} finally { database?.db().close(); await rm(temporaryRoot, { recursive: true, force: true }); }
