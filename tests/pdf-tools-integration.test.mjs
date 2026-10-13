import assert from "node:assert/strict";
import { File } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pdfSignatures, writePdfFixture } from "./pdf-tools-fixture.mjs";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-pdf-tools-integration-"));
process.env.EREMITE_DATA_DIR = path.join(temporaryRoot, "data");
let database;
try {
  database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const automations = await import("@/modules/automations/service");
  const { PDF_TOOLS_TOOL_ID } = await import("@/modules/automations/tools/catalog");
  const { managedFilePath } = await import("@/platform/files/service");
  const { resolveInstalledPdfTools } = await import("@/modules/automations/tools/pdf-tools/runtime");
  const { pdfToolsServerTool: tool } = await import("@/modules/automations/tools/pdf-tools/server-tool");
  const installed = await resolveInstalledPdfTools();

  const abPath = path.join(temporaryRoot, "ab.pdf");
  const cPath = path.join(temporaryRoot, "c.pdf");
  const abcPath = path.join(temporaryRoot, "abc.pdf");
  await writePdfFixture(abPath, [{ label: "A", width: 200, height: 300 }, { label: "B", width: 300, height: 400 }]);
  await writePdfFixture(cPath, [{ label: "C", width: 400, height: 500 }]);
  await writePdfFixture(abcPath, [{ label: "A", width: 200, height: 300 }, { label: "B", width: 300, height: 400 }, { label: "C", width: 400, height: 500 }]);
  const upload = async (filePath, name, projectId, folderId) => {
    const bytes = await readFile(filePath);
    return inbox.createFileContentItemFromStream({ body: new File([bytes], name, { type: "application/pdf" }).stream(), originalName: name, mimeType: "application/pdf", expectedSize: bytes.length, projectId, folderId });
  };

  const projectId = projects.createProject({ name: "PDF 专案" });
  const sourceFolder = folders.createFolder({ projectId, name: "来源" });
  const destinationFolder = folders.createFolder({ projectId, name: "结果" });
  const abId = await upload(abPath, "甲乙.pdf", projectId, sourceFolder);
  const cId = await upload(cPath, "丙.pdf", projectId, destinationFolder);
  const abcId = await upload(abcPath, "三页.pdf", projectId, sourceFolder);
  const original = inbox.getFileAssetForViewing(abcId);
  const sources = await Promise.all([abId, cId, abcId].map(async id => ({
    id, summary: inbox.getContentItemSummary(id), asset: inbox.getFileAssetForViewing(id),
    versions: database.all("SELECT * FROM file_versions WHERE asset_id = ? ORDER BY id", inbox.getFileAssetForViewing(id).assetId),
    bytes: await readFile(managedFilePath(inbox.getFileAssetForViewing(id).storageKey)),
  })));
  const execute = (rawInput, operationId = randomUUID(), context = { projectId }) => automations.executeExternalTool({ operationId, toolId: PDF_TOOLS_TOOL_ID, rawInput, ...context });
  const outputOf = result => JSON.parse(automations.getAutomationRun(result.runId).output_payload_json);
  const state = async () => ({
    counts: ["content_items", "file_assets", "file_versions", "file_blobs", "file_write_operations"].map(table => database.one(`SELECT count(*) AS n FROM ${table}`).n),
    files: (await readdir(path.join(temporaryRoot, "data", "files"), { recursive: true })).sort(),
  });
  const assertOutputs = (result, expectedProject, expectedFolder, expectedSignatures) => {
    const payload = outputOf(result);
    assert.equal(payload.supplier.qpdfVersion, "12.4.0");
    assert.equal(payload.outputs.length, expectedSignatures.length);
    payload.outputs.forEach((output, index) => {
      const summary = inbox.getContentItemSummary(output.contentId);
      const asset = inbox.getFileAssetForViewing(output.contentId);
      assert.equal(summary.project_id, expectedProject);
      assert.equal(summary.folder_id, expectedFolder, "every output uses the same resolved destination");
      assert.equal(asset.sha256, output.sha256);
      assert.equal(output.pageCount, expectedSignatures[index].length);
      assert.deepEqual(pdfSignatures(installed.qpdfPath, managedFilePath(asset.storageKey)), expectedSignatures[index]);
      assert.deepEqual(inbox.getFileCreationByIdempotencyKey(`automation:${result.runId}:output:${index}`), { state: "committed", contentId: output.contentId, versionId: output.versionId });
    });
    assert.equal(database.one("SELECT count(*) AS n FROM file_write_operations WHERE idempotency_key LIKE ? AND state = 'committed'", `automation:${result.runId}:output:%`).n, payload.outputs.length);
    return payload;
  };

  const mergeOperationId = "11111111-1111-7111-8111-111111111111";
  const merge = await automations.executeExternalTool({ operationId: mergeOperationId, toolId: PDF_TOOLS_TOOL_ID, rawInput: { operation: "pdf.merge", contentItemIds: [abId, cId], folderId: destinationFolder }, projectId });
  assert.equal(merge.status, "completed", JSON.stringify(database.one("SELECT error_code, error_message, output_payload_json FROM automation_runs WHERE id = ?", merge.runId)));
  const mergeRun = database.one("SELECT * FROM automation_runs WHERE id = ?", merge.runId);
  const mergePayload = JSON.parse(mergeRun.output_payload_json);
  assert.equal(mergePayload.operation, "pdf.merge");
  assert.equal(mergePayload.outputs.length, 1);
  const merged = inbox.getFileAssetForViewing(mergePayload.outputs[0].contentId);
  const mergedSummary = inbox.getContentItemSummary(mergePayload.outputs[0].contentId);
  assert.ok(mergeRun.output_summary.startsWith(`已创建 ${mergedSummary.title}（`), "single-output Run summary names the generated Content title");
  assert.equal(mergedSummary.project_id, projectId);
  assert.equal(mergedSummary.folder_id, destinationFolder);
  assert.deepEqual(pdfSignatures(installed.qpdfPath, managedFilePath(merged.storageKey)), ["200x300@0", "300x400@0", "400x500@0"]);
  const snapshots = database.all("SELECT ordinal, content_id FROM automation_run_inputs WHERE run_id = ? ORDER BY ordinal", merge.runId);
  assert.deepEqual(snapshots.map((entry) => entry.content_id), [abId, cId]);
  const replay = await automations.executeExternalTool({ operationId: mergeOperationId, toolId: PDF_TOOLS_TOOL_ID, rawInput: { operation: "pdf.merge", contentItemIds: [abId, cId], folderId: destinationFolder }, projectId });
  assert.deepEqual(replay, { runId: merge.runId, reused: true, status: "completed" });

  const split = await automations.executeExternalTool({ operationId: "22222222-2222-7222-8222-222222222222", toolId: PDF_TOOLS_TOOL_ID, rawInput: { operation: "pdf.split", contentItemIds: [abcId], splitEvery: "1", folderId: destinationFolder }, projectId });
  assert.equal(split.status, "completed");
  const splitRun = database.one("SELECT output_summary, output_payload_json FROM automation_runs WHERE id = ?", split.runId);
  const splitPayload = JSON.parse(splitRun.output_payload_json);
  assert.equal(splitPayload.outputs.length, 3);
  assert.match(splitRun.output_summary, /^已创建 3 条资料 · 拆分 PDF（/u, "batch Run summary uses the operation wording in generated Content titles");
  const splitSignatures = splitPayload.outputs.map((output, index) => {
    const summary = inbox.getContentItemSummary(output.contentId);
    assert.ok(summary.title.includes("拆分 PDF"));
    assert.equal(summary.project_id, projectId);
    assert.equal(summary.folder_id, destinationFolder);
    assert.deepEqual(inbox.getFileCreationByIdempotencyKey(`automation:${split.runId}:output:${index}`).contentId, output.contentId);
    return pdfSignatures(installed.qpdfPath, managedFilePath(inbox.getFileAssetForViewing(output.contentId).storageKey))[0];
  });
  assert.deepEqual(splitSignatures, ["200x300@0", "300x400@0", "400x500@0"]);

  const nestedFolder = folders.createFolder({ projectId, parentId: destinationFolder, name: "下层" });
  const operations = [
    [{ operation: "pdf.merge", contentItemIds: [abId, cId] }, [["200x300@0", "300x400@0", "400x500@0"]]],
    [{ operation: "pdf.split", contentItemIds: [abcId], splitEvery: "1" }, [["200x300@0"], ["300x400@0"], ["400x500@0"]]],
    [{ operation: "pdf.extract", contentItemIds: [abcId], pageSelector: "3,1" }, [["400x500@0", "200x300@0"]]],
    [{ operation: "pdf.rotate", contentItemIds: [abcId], pageSelector: "2", rotateAngle: "90", rotateMode: "relative" }, [["200x300@0", "300x400@90", "400x500@0"]]],
    [{ operation: "pdf.reorder", contentItemIds: [abcId], pageOrder: "3,1,2" }, [["400x500@0", "200x300@0", "300x400@0"]]],
  ];
  // Real qpdf + formal Host writes cover the destination matrix for all five operations.
  for (const [raw, signatures] of operations) {
    for (const [destination, expectedFolder] of [[{}, sourceFolder], [{ folderId: undefined }, sourceFolder], [{ folderId: null }, null], [{ folderId: "" }, null], [{ folderId: nestedFolder }, nestedFolder]]) {
      const input = { ...raw, ...destination };
      const operationId = randomUUID();
      const result = await execute(input, operationId);
      assert.equal(result.status, "completed", JSON.stringify(automations.getAutomationRun(result.runId)));
      assertOutputs(result, projectId, expectedFolder, signatures);
      const snapshot = JSON.parse(automations.getAutomationRun(result.runId).input_payload_json);
      assert.equal(snapshot.destination.folderId, expectedFolder);
      assert.equal(snapshot.retryEvidence.destination.folderId, expectedFolder);
      const beforeReplay = await state();
      assert.deepEqual(await execute(input, operationId), { ...result, reused: true });
      assert.deepEqual(await state(), beforeReplay, "duplicate Run adds no formal files, versions or Receipts");
      if (expectedFolder === null) {
        await assert.rejects(execute(raw, operationId), { code: "idempotency_conflict" }, "root and omitted/source destinations remain distinct requests");
        assert.deepEqual(await state(), beforeReplay);
      }
    }
  }

  const reversedMerge = await execute({ operation: "pdf.merge", contentItemIds: [cId, abId] });
  assert.equal(reversedMerge.status, "completed");
  assertOutputs(reversedMerge, projectId, destinationFolder, [["400x500@0", "200x300@0", "300x400@0"]]);

  // A failed split freezes null; concurrent/repeated Retry publishes the whole batch at root once.
  const originalExecute = tool.executeExternal;
  const splitInput = { operation: "pdf.split", contentItemIds: [abcId], splitEvery: "1", folderId: null };
  const beforeFailure = await state();
  let failedRoot;
  tool.executeExternal = async () => { throw new Error("injected pre-Supplier failure"); };
  try { failedRoot = await execute(splitInput); }
  finally { tool.executeExternal = originalExecute; }
  assert.equal(failedRoot.status, "failed");
  assert.deepEqual(await state(), beforeFailure);
  assert.equal(inbox.hasFileCreationReceiptWithPrefix(`automation:${failedRoot.runId}:output:`), false);
  const parent = automations.getAutomationRun(failedRoot.runId);
  assert.equal(parent.output_payload_json, null);
  assert.equal(JSON.parse(parent.input_payload_json).destination.folderId, null);
  assert.equal(automations.getAutomationRetryEligibility(parent.id).allowed, true);
  let invocations = 0;
  let retried, duplicateRetry;
  tool.executeExternal = async (...args) => { invocations += 1; return originalExecute(...args); };
  try { [retried, duplicateRetry] = await Promise.all([automations.retryExternalTool(parent.id), automations.retryExternalTool(parent.id)]); }
  finally { tool.executeExternal = originalExecute; }
  assert.equal(retried.status, "completed");
  assert.equal(duplicateRetry.runId, retried.runId);
  assert.equal(duplicateRetry.reused, true);
  assert.equal(invocations, 1);
  const child = automations.getAutomationRun(retried.runId);
  assert.equal(child.retry_of_run_id, parent.id);
  assert.notEqual(child.operation_id, parent.operation_id);
  assert.equal(child.input_payload_json, parent.input_payload_json);
  assert.deepEqual(automations.getAutomationRun(parent.id), parent, "failed parent Run History is immutable");
  assertOutputs(retried, projectId, null, operations[1][1]);
  const beforeRetryReplay = await state();
  assert.deepEqual(await automations.retryExternalTool(parent.id), { ...retried, reused: true });
  assert.deepEqual(await state(), beforeRetryReplay);

  // Genuine qpdf parameter failure and its Retry leave no outputs, formal files or Receipts.
  const beforeBadPages = await state();
  const badPages = await execute({ operation: "pdf.extract", contentItemIds: [abcId], pageSelector: "99", folderId: null });
  assert.equal(badPages.status, "failed");
  const badParent = automations.getAutomationRun(badPages.runId);
  assert.equal(badParent.error_code, "parameter.out_of_range");
  const badRetry = await automations.retryExternalTool(badParent.id);
  assert.equal(badRetry.status, "failed");
  assert.deepEqual(await state(), beforeBadPages);
  assert.deepEqual(automations.getAutomationRun(badParent.id), badParent);
  for (const result of [badPages, badRetry]) {
    const run = automations.getAutomationRun(result.runId);
    assert.equal(run.error_code, badParent.error_code);
    assert.equal(run.output_payload_json, null);
    assert.equal(run.output_summary, null);
    assert.equal(JSON.parse(run.input_payload_json).destination.folderId, null);
    assert.equal(inbox.hasFileCreationReceiptWithPrefix(`automation:${run.id}:output:`), false);
    assert.equal(database.one("SELECT count(*) AS n FROM automation_run_outputs WHERE run_id = ?", run.id).n, 0);
  }

  const unassignedId = await upload(abcPath, "未归入.pdf", null, null);
  const unassigned = await automations.executeExternalTool({ operationId: "33333333-3333-7333-8333-333333333333", toolId: PDF_TOOLS_TOOL_ID, rawInput: { operation: "pdf.rotate", contentItemIds: [unassignedId], pageSelector: "2", rotateAngle: "90", rotateMode: "relative", folderId: null } });
  assert.equal(unassigned.status, "completed");
  const unassignedPayload = JSON.parse(database.one("SELECT output_payload_json FROM automation_runs WHERE id = ?", unassigned.runId).output_payload_json);
  const unassignedSummary = inbox.getContentItemSummary(unassignedPayload.outputs[0].contentId);
  assert.equal(unassignedSummary.project_id, null);
  assert.equal(unassignedSummary.folder_id, null);

  const otherProject = projects.createProject({ name: "其他专案" });
  const otherId = await upload(cPath, "其他.pdf", otherProject, null);
  const foreignFolder = folders.createFolder({ projectId: otherProject, name: "跨专案" });
  const unavailableParent = folders.createFolder({ projectId, name: "不可用" });
  const unavailableFolder = folders.createFolder({ projectId, parentId: unavailableParent, name: "不可用下层" });
  folders.trashFolder(unavailableParent, folders.getFolder(unavailableParent).revision);
  for (const [raw] of operations) {
    for (const folderId of ["missing-folder", foreignFolder, unavailableFolder]) {
      const before = await state();
      const runsBefore = database.one("SELECT count(*) AS n FROM automation_runs").n;
      await assert.rejects(execute({ ...raw, folderId }), { code: "project_mismatch" });
      assert.deepEqual(await state(), before);
      assert.equal(database.one("SELECT count(*) AS n FROM automation_runs").n, runsBefore);
    }
  }
  const beforeRejected = await state();
  const runsBeforeRejected = database.one("SELECT count(*) AS n FROM automation_runs").n;
  for (const raw of [
    { operation: "pdf.merge", contentItemIds: [abId, otherId], folderId: null },
    { operation: "pdf.merge", contentItemIds: [abId, unassignedId], folderId: null },
    { operation: "pdf.extract", contentItemIds: [unassignedId], pageSelector: "1", folderId: destinationFolder },
  ]) await assert.rejects(execute(raw, randomUUID(), {}), { code: "project_mismatch" });
  await assert.rejects(execute(operations[0][0], randomUUID(), { projectId: otherProject }), { code: "project_mismatch" });
  assert.deepEqual(await state(), beforeRejected);
  assert.equal(database.one("SELECT count(*) AS n FROM automation_runs").n, runsBeforeRejected);
  for (const destination of [{}, { folderId: "" }]) {
    const result = await execute({ operation: "pdf.extract", contentItemIds: [unassignedId], pageSelector: "1", ...destination }, randomUUID(), {});
    assert.equal(result.status, "completed");
    assertOutputs(result, null, null, [["200x300@0"]]);
  }
  for (const source of sources) {
    assert.deepEqual(inbox.getContentItemSummary(source.id), source.summary);
    assert.deepEqual(inbox.getFileAssetForViewing(source.id), source.asset, "all destination/Retry paths preserve the original version");
    assert.deepEqual(database.all("SELECT * FROM file_versions WHERE asset_id = ? ORDER BY id", source.asset.assetId), source.versions, "source version rows are neither added nor changed");
    assert.deepEqual(await readFile(managedFilePath(source.asset.storageKey)), source.bytes, "original source bytes remain immutable");
  }
  assert.deepEqual(inbox.getFileAssetForViewing(abcId), original);
  assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
  console.log("PDF Tools integration gate passed: real qpdf five-operation root/default/explicit Folder matrix, split batch destinations, Project/Folder rejection, frozen root Retry/concurrent replay, receipts, immutable Run History/source versions/bytes and genuine failure cleanup.");
} finally {
  database?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
