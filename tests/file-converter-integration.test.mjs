import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
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

  const unassignedId = await inbox.createFileContentItemFromStream({ body: new File([png], "未归入.png", { type: "image/png" }).stream(), originalName: "未归入.png", mimeType: "image/png", expectedSize: png.length });
  const unassigned = await automations.executeExternalTool({ operationId: "22222222-2222-7222-8222-222222222222", toolId: FILE_CONVERTER_TOOL_ID, rawInput: { contentItemId: unassignedId, conversionId: "png-to-webp", folderId: null } });
  assert.equal(unassigned.status, "completed");
  const unassignedPayload = JSON.parse(database.one("SELECT output_payload_json FROM automation_runs WHERE id = ?", unassigned.runId).output_payload_json);
  const unassignedOutput = inbox.getContentItemSummary(unassignedPayload.contentId);
  assert.equal(unassignedOutput.project_id, null); assert.equal(unassignedOutput.folder_id, null);
  assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok"); assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
  console.log("File Converter integration gate passed: async Run idempotency, formal File Lifecycle, Project/Folder freeze, Unassigned and source immutability.");
} finally {
  database?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
