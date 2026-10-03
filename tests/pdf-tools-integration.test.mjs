import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  const cId = await upload(cPath, "丙.pdf", projectId, sourceFolder);
  const abcId = await upload(abcPath, "三页.pdf", projectId, sourceFolder);
  const original = inbox.getFileAssetForViewing(abcId);

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

  const unassignedId = await upload(abcPath, "未归入.pdf", null, null);
  const unassigned = await automations.executeExternalTool({ operationId: "33333333-3333-7333-8333-333333333333", toolId: PDF_TOOLS_TOOL_ID, rawInput: { operation: "pdf.rotate", contentItemIds: [unassignedId], pageSelector: "2", rotateAngle: "90", rotateMode: "relative", folderId: null } });
  assert.equal(unassigned.status, "completed");
  const unassignedPayload = JSON.parse(database.one("SELECT output_payload_json FROM automation_runs WHERE id = ?", unassigned.runId).output_payload_json);
  const unassignedSummary = inbox.getContentItemSummary(unassignedPayload.outputs[0].contentId);
  assert.equal(unassignedSummary.project_id, null);
  assert.equal(unassignedSummary.folder_id, null);

  const otherProject = projects.createProject({ name: "其他专案" });
  const otherId = await upload(cPath, "其他.pdf", otherProject, null);
  await assert.rejects(() => automations.executeExternalTool({ operationId: "44444444-4444-7444-8444-444444444444", toolId: PDF_TOOLS_TOOL_ID, rawInput: { operation: "pdf.merge", contentItemIds: [abId, otherId] } }));
  assert.equal(inbox.getFileAssetForViewing(abcId).sha256, original.sha256, "PDF operation never mutates the source version");
  assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
  console.log("PDF Tools integration gate passed: Run idempotency, merge/split, ordered batch File Lifecycle, Project/Folder freeze, Unassigned and source immutability.");
} finally {
  database?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
