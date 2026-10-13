import assert from "node:assert/strict";
import { File } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-file-converter-integration-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let database;
try {
  database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const automations = await import("@/modules/automations/service");
  const { FILE_CONVERTER_TOOL_ID } = await import("@/modules/automations/tools/catalog");
  const { fileConverterServerTool: tool } = await import("@/modules/automations/tools/file-converter/server-tool");

  const projectId = projects.createProject({ name: "转换专案" });
  const sourceFolder = folders.createFolder({ projectId, name: "来源" });
  const destinationFolder = folders.createFolder({ projectId, name: "输出" });
  const png = await sharp({ create: { width: 5, height: 4, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.6 } } }).png().toBuffer();
  const sourceId = await inbox.createFileContentItemFromStream({ body: new File([png], "原图.png", { type: "image/png" }).stream(), originalName: "原图.png", mimeType: "image/png", expectedSize: png.length, projectId, folderId: sourceFolder });
  const source = inbox.getFileAssetForViewing(sourceId);
  const operationId = "11111111-1111-7111-8111-111111111111";
  const first = await automations.executeExternalTool({ operationId, toolId: FILE_CONVERTER_TOOL_ID, rawInput: { contentItemId: sourceId, conversionId: "png-to-jpeg", profile: "balanced", folderId: destinationFolder }, projectId });
  assert.equal(first.status, "completed", JSON.stringify(database.one("SELECT error_code, error_message, output_payload_json FROM automation_runs WHERE id = ?", first.runId)));
  const duplicate = await automations.executeExternalTool({ operationId, toolId: FILE_CONVERTER_TOOL_ID, rawInput: { contentItemId: sourceId, conversionId: "png-to-jpeg", profile: "balanced", folderId: destinationFolder }, projectId });
  assert.deepEqual(duplicate, { runId: first.runId, reused: true, status: "completed" });
  const run = database.one("SELECT * FROM automation_runs WHERE id = ?", first.runId);
  const payload = JSON.parse(run.output_payload_json);
  assert.equal(payload.schemaVersion, 1); assert.equal(payload.previewable, true); assert.equal(payload.supplier.engine.id, "sharp");
  const outputSummary = inbox.getContentItemSummary(payload.contentId); const output = inbox.getFileAssetForViewing(payload.contentId);
  assert.ok(run.output_summary.startsWith(`已创建 ${outputSummary.title}（`), "Run summary names the generated Content title");
  assert.equal(inbox.getContentItemSummary(sourceId).title, "原图.png", "source Content title stays unchanged");
  assert.equal(outputSummary.project_id, projectId); assert.equal(outputSummary.folder_id, destinationFolder);
  assert.equal(output.originalName, "原图.jpg"); assert.equal(output.declaredMimeType, "image/jpeg"); assert.equal(output.sha256, payload.sha256);
  assert.equal(inbox.getFileAssetForViewing(sourceId).sha256, source.sha256, "conversion never mutates the source version");
  assert.deepEqual(inbox.getFileCreationByIdempotencyKey(`automation:${first.runId}:output:0`), { state: "committed", contentId: payload.contentId, versionId: payload.versionId });

  const raw = { contentItemId: sourceId, conversionId: "png-to-jpeg", profile: "balanced" };
  const execute = (rawInput, operationId = randomUUID()) => automations.executeExternalTool({ operationId, toolId: FILE_CONVERTER_TOOL_ID, rawInput, projectId });
  const outputOf = result => JSON.parse(automations.getAutomationRun(result.runId).output_payload_json);
  const state = async () => ({
    counts: ["content_items", "file_assets", "file_versions", "file_blobs", "file_write_operations"].map(table => database.one(`SELECT count(*) AS n FROM ${table}`).n),
    files: (await readdir(path.join(temporaryRoot, "files"), { recursive: true })).sort(),
  });
  // Real Sharp + formal Host writes prove the resolved destination, not just the validator.
  for (const [destination, expectedFolder] of [[{ folderId: null }, null], [{ folderId: "" }, null], [{}, sourceFolder], [{ folderId: undefined }, sourceFolder]]) {
    const input = { ...raw, ...destination };
    const op = randomUUID();
    const result = await execute(input, op);
    assert.equal(result.status, "completed");
    const output = outputOf(result);
    const summary = inbox.getContentItemSummary(output.contentId);
    assert.equal(summary.project_id, projectId);
    assert.equal(summary.folder_id, expectedFolder);
    const snapshot = JSON.parse(automations.getAutomationRun(result.runId).input_payload_json);
    assert.equal(snapshot.destination.folderId, expectedFolder);
    assert.equal(snapshot.retryEvidence.destination.folderId, expectedFolder);
    const beforeReplay = await state();
    assert.deepEqual(await execute(input, op), { ...result, reused: true });
    assert.deepEqual(await state(), beforeReplay, "duplicate Run creates no extra files or versions");
    assert.deepEqual(inbox.getFileCreationByIdempotencyKey(`automation:${result.runId}:output:0`), { state: "committed", contentId: output.contentId, versionId: output.versionId });
    if (expectedFolder === null) {
      await assert.rejects(execute(raw, op), { code: "idempotency_conflict" }, "root and omitted/source destinations are distinct requests");
      assert.deepEqual(await state(), beforeReplay);
    }
  }

  const otherProject = projects.createProject({ name: "另一专案" });
  const foreignFolder = folders.createFolder({ projectId: otherProject, name: "跨专案" });
  for (const folderId of ["missing-folder", foreignFolder]) {
    const before = await state();
    const runsBefore = database.one("SELECT count(*) AS n FROM automation_runs").n;
    await assert.rejects(execute({ ...raw, folderId }), { code: "project_mismatch" });
    assert.deepEqual(await state(), before);
    assert.equal(database.one("SELECT count(*) AS n FROM automation_runs").n, runsBefore, "invalid destinations are rejected before persisting a Run");
  }

  // A failed root request freezes null; concurrent/repeated Retry executes once through real Sharp.
  const originalExecute = tool.executeExternal;
  let failedRoot;
  const beforeFailure = await state();
  tool.executeExternal = async () => { throw new Error("injected pre-Supplier failure"); };
  try { failedRoot = await execute({ ...raw, folderId: null }); }
  finally { tool.executeExternal = originalExecute; }
  assert.equal(failedRoot.status, "failed");
  assert.deepEqual(await state(), beforeFailure);
  assert.equal(inbox.hasFileCreationReceiptWithPrefix(`automation:${failedRoot.runId}:output:`), false);
  const parent = automations.getAutomationRun(failedRoot.runId);
  assert.equal(parent.output_payload_json, null);
  assert.equal(JSON.parse(parent.input_payload_json).destination.folderId, null);
  assert.equal(automations.getAutomationRetryEligibility(parent.id).allowed, true);
  let invocations = 0;
  tool.executeExternal = async (...args) => { invocations += 1; return originalExecute(...args); };
  let retried, duplicateRetry;
  try { [retried, duplicateRetry] = await Promise.all([automations.retryExternalTool(parent.id), automations.retryExternalTool(parent.id)]); }
  finally { tool.executeExternal = originalExecute; }
  assert.equal(retried.status, "completed");
  assert.equal(duplicateRetry.runId, retried.runId); assert.equal(duplicateRetry.reused, true); assert.equal(invocations, 1);
  const child = automations.getAutomationRun(retried.runId);
  assert.equal(child.retry_of_run_id, parent.id); assert.notEqual(child.operation_id, parent.operation_id);
  assert.equal(child.input_payload_json, parent.input_payload_json);
  assert.deepEqual(automations.getAutomationRun(parent.id), parent, "failed Run History remains unchanged");
  const retryOutput = outputOf(retried);
  assert.equal(inbox.getContentItemSummary(retryOutput.contentId).folder_id, null);
  assert.equal(inbox.getContentItemSummary(retryOutput.contentId).project_id, projectId);
  assert.deepEqual(inbox.getFileCreationByIdempotencyKey(`automation:${child.id}:output:0`), { state: "committed", contentId: retryOutput.contentId, versionId: retryOutput.versionId });
  const beforeRetryReplay = await state();
  assert.deepEqual(await automations.retryExternalTool(parent.id), { ...retried, reused: true });
  assert.deepEqual(await state(), beforeRetryReplay);

  // Genuine Supplier failure and its Retry must leave no output, receipt or extra file rows/bytes.
  const broken = Buffer.from("not a PNG");
  const brokenId = await inbox.createFileContentItemFromStream({ body: new File([broken], "broken.png").stream(), originalName: "broken.png", mimeType: "image/png", expectedSize: broken.length, projectId, folderId: sourceFolder });
  const beforeBroken = await state();
  const brokenResult = await execute({ ...raw, contentItemId: brokenId, folderId: null });
  assert.equal(brokenResult.status, "failed");
  const brokenParent = automations.getAutomationRun(brokenResult.runId);
  assert.match(brokenParent.error_code, /^FC_/u);
  const brokenRetry = await automations.retryExternalTool(brokenParent.id);
  assert.equal(brokenRetry.status, "failed");
  assert.deepEqual(await state(), beforeBroken);
  assert.deepEqual(automations.getAutomationRun(brokenParent.id), brokenParent);
  for (const result of [brokenResult, brokenRetry]) {
    const run = automations.getAutomationRun(result.runId);
    assert.equal(run.error_code, brokenParent.error_code);
    assert.equal(run.output_payload_json, null); assert.equal(run.output_summary, null);
    assert.equal(JSON.parse(run.input_payload_json).destination.folderId, null);
    assert.equal(inbox.hasFileCreationReceiptWithPrefix(`automation:${run.id}:output:`), false);
    assert.equal(database.one("SELECT count(*) AS n FROM automation_run_outputs WHERE run_id = ?", run.id).n, 0);
  }
  assert.deepEqual(inbox.getFileAssetForViewing(sourceId), source, "all destination/Retry paths preserve the immutable source version");
  assert.equal(inbox.getContentItemSummary(sourceId).folder_id, sourceFolder);

  const unassignedId = await inbox.createFileContentItemFromStream({ body: new File([png], "未归入.png", { type: "image/png" }).stream(), originalName: "未归入.png", mimeType: "image/png", expectedSize: png.length });
  const unassigned = await automations.executeExternalTool({ operationId: "22222222-2222-7222-8222-222222222222", toolId: FILE_CONVERTER_TOOL_ID, rawInput: { contentItemId: unassignedId, conversionId: "png-to-webp", folderId: null } });
  assert.equal(unassigned.status, "completed");
  const unassignedPayload = JSON.parse(database.one("SELECT output_payload_json FROM automation_runs WHERE id = ?", unassigned.runId).output_payload_json);
  const unassignedOutput = inbox.getContentItemSummary(unassignedPayload.contentId);
  assert.equal(unassignedOutput.project_id, null); assert.equal(unassignedOutput.folder_id, null);
  const beforeUnassigned = await state();
  await assert.rejects(automations.executeExternalTool({ operationId: randomUUID(), toolId: FILE_CONVERTER_TOOL_ID, rawInput: { contentItemId: unassignedId, conversionId: "png-to-webp", folderId: destinationFolder } }), { code: "project_mismatch" });
  assert.deepEqual(await state(), beforeUnassigned);
  assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok"); assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
  console.log("File Converter integration gate passed: real Sharp root/default/explicit Folder destinations, invalid/cross-Project rejection, root Retry/replay, failed conversion cleanup, receipts, Run History, Unassigned and source immutability.");
} finally {
  database?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
