import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-pdf-tools-recovery-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let database;
try {
  database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const reconciliation = await import("@/modules/automations/reconciliation");
  const { PDF_TOOLS_TOOL_ID } = await import("@/modules/automations/tools/catalog");
  const createdAt = "2026-08-29T00:00:00.000Z";
  const supplier = { packageVersion: "1.0.0-rc2", coreVersion: "0.1.0", protocolVersion: 1, qpdfVersion: "12.4.0", qpdfSha256: "9b3cb39a097df278b34cc1074955960e52916e7a5720b5614041b45dac132ea3", warnings: ["w.document_features_dropped"] };
  const runId = "11111111-1111-7111-8111-111111111111";
  const pending = { schemaVersion: 1, phase: "supplier_validated", operation: "pdf.split", outputs: [{ displayName: "part-0001.pdf", byteSize: 20, sha256: "a", pageCount: 1 }, { displayName: "part-0002.pdf", byteSize: 20, sha256: "b", pageCount: 1 }], supplier };
  database.run(`INSERT INTO automation_runs
    (id, automation_key, target_id, target_version, target_name_snapshot, operation_id, status, input_summary, input_payload_json, output_payload_json, created_at)
    VALUES (?, ?, ?, 1, 'PDF 工具', ?, 'running', '恢复测试', ?, ?, ?)`,
  runId, PDF_TOOLS_TOOL_ID, PDF_TOOLS_TOOL_ID, "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa", JSON.stringify({ schemaVersion: 1, operation: "pdf.split" }), JSON.stringify(pending), createdAt);
  const bytes = [Buffer.from("%PDF-1.4\nA\n%%EOF"), Buffer.from("%PDF-1.4\nB\n%%EOF")];
  const contentIds = await inbox.createFileContentItemsFromStreams(bytes.map((body, index) => ({
    body: new File([body], `part-${index + 1}.pdf`, { type: "application/pdf" }).stream(),
    originalName: `part-${index + 1}.pdf`,
    mimeType: "application/pdf",
    expectedSize: body.length,
    idempotencyKey: `automation:${runId}:output:${index}`,
  })));
  const report = reconciliation.reconcileInterruptedAutomationRuns({ now: new Date("2026-08-30T00:00:00.000Z") });
  assert.equal(report.reconciled, 1);
  const recovered = database.one("SELECT status, output_payload_json FROM automation_runs WHERE id = ?", runId);
  assert.equal(recovered.status, "completed");
  assert.deepEqual(JSON.parse(recovered.output_payload_json).outputs.map((output) => output.contentId), contentIds);

  const partialRunId = "22222222-2222-7222-8222-222222222222";
  database.run(`INSERT INTO automation_runs
    (id, automation_key, target_id, target_version, target_name_snapshot, operation_id, status, input_summary, input_payload_json, output_payload_json, created_at)
    VALUES (?, ?, ?, 1, 'PDF 工具', ?, 'running', '部分恢复测试', ?, ?, ?)`,
  partialRunId, PDF_TOOLS_TOOL_ID, PDF_TOOLS_TOOL_ID, "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb", JSON.stringify({ schemaVersion: 1, operation: "pdf.split" }), JSON.stringify(pending), createdAt);
  await inbox.createFileContentItemFromStream({
    body: new File([bytes[0]], "partial.pdf", { type: "application/pdf" }).stream(),
    originalName: "partial.pdf",
    mimeType: "application/pdf",
    expectedSize: bytes[0].length,
    idempotencyKey: `automation:${partialRunId}:output:0`,
  });
  const partial = reconciliation.reconcileInterruptedAutomationRuns({ now: new Date("2026-08-30T00:00:00.000Z") });
  assert.equal(partial.reconciled, 1);
  assert.equal(database.one("SELECT status FROM automation_runs WHERE id = ?", partialRunId).status, "failed", "an incomplete output set must never recover as completed");
  assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
  console.log("PDF Tools recovery gate passed: complete committed output set recovers in response order; partial set fails and never becomes completed.");
} finally {
  database?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
