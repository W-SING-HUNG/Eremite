import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { File } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DatabaseSync } from "node:sqlite";
import { pdfSignatures, writePdfFixture } from "./pdf-tools-fixture.mjs";

const root = await mkdtemp(path.join(tmpdir(), "eremite-retry-real-"));
process.env.EREMITE_DATA_DIR = root;
let database;
try {
  database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const service = await import("@/modules/automations/service");
  const { serverToolRegistry } = await import("@/modules/automations/registry");
  const { resolveInstalledPdfTools } = await import("@/modules/automations/tools/pdf-tools/runtime");
  const { managedFilePath } = await import("@/platform/files/service");
  const projectId = projects.createProject({ name: "Real Retry" });
  const sourceFolder = folders.createFolder({ projectId, name: "Source" });
  const destinationFolder = folders.createFolder({ projectId, name: "Output" });
  async function upload(bytes, name, mimeType) {
    return inbox.createFileContentItemFromStream({ body: new File([bytes], name, { type: mimeType }).stream(), originalName: name, mimeType, expectedSize: bytes.length, projectId, folderId: sourceFolder });
  }
  async function retryWithRealEngine(toolId, rawInput) {
    const tool = serverToolRegistry[toolId]; const original = tool.executeExternal;
    tool.executeExternal = async () => { throw new Error("injected transient failure before Supplier invocation"); };
    let failed;
    try { failed = await service.executeExternalTool({ operationId: randomUUID(), toolId, rawInput, projectId }); }
    finally { tool.executeExternal = original; }
    assert.equal(failed.status, "failed");
    const parent = service.getAutomationRun(failed.runId);
    assert.equal(service.getAutomationRetryEligibility(parent.id).allowed, true);
    let invocations = 0;
    tool.executeExternal = async (...args) => { invocations += 1; try { return await original(...args); } catch (error) { console.error("Real engine failure:", error); throw error; } };
    let result;
    try {
      result = await service.retryExternalTool(parent.id);
      assert.equal(result.status, "completed", JSON.stringify(service.getAutomationRun(result.runId)));
      assert.equal((await service.retryExternalTool(parent.id)).runId, result.runId);
    } finally { tool.executeExternal = original; }
    assert.equal(invocations, 1);
    assert.deepEqual(service.getAutomationRun(parent.id), parent, "old failed Run remains byte-equivalent");
    const child = service.getAutomationRun(result.runId);
    assert.equal(child.retry_of_run_id, parent.id);
    assert.equal(child.input_payload_json, parent.input_payload_json);
    assert.notEqual(child.operation_id, parent.operation_id);
    return JSON.parse(child.output_payload_json);
  }
  const png = await sharp({ create: { width: 8, height: 6, channels: 4, background: "#468ac4" } }).png().toBuffer();
  const imageId = await upload(png, "retry.png", "image/png");
  const image = inbox.getFileAssetForViewing(imageId);
  const converted = await retryWithRealEngine("core.file-converter", { contentItemId: imageId, conversionId: "png-to-jpeg", profile: "balanced", folderId: destinationFolder });
  assert.equal(converted.supplier.engine.id, "sharp");
  const metadata = await sharp(await readFile(managedFilePath(inbox.getFileAssetForViewing(converted.contentId).storageKey))).metadata();
  assert.equal(metadata.format, "jpeg"); assert.equal(metadata.width, 8); assert.equal(metadata.height, 6);
  assert.deepEqual(inbox.getFileAssetForViewing(imageId), image);
  assert.notEqual(converted.assetId, image.assetId); assert.notEqual(converted.versionId, image.versionId);
  assert.equal(inbox.getContentItemSummary(converted.contentId).folder_id, destinationFolder);

  const pdfFile = path.join(root, "fixture.pdf");
  await writePdfFixture(pdfFile, [{ width: 200, height: 300, label: "A" }, { width: 300, height: 400, label: "B" }, { width: 400, height: 500, label: "C" }]);
  const pdfId = await upload(await readFile(pdfFile), "retry.pdf", "application/pdf");
  const sourcePdf = inbox.getFileAssetForViewing(pdfId);
  const extracted = await retryWithRealEngine("core.pdf-tools", { operation: "pdf.extract", contentItemIds: [pdfId], pageSelector: "3,1", folderId: destinationFolder });
  const installed = await resolveInstalledPdfTools(true);
  assert.equal(extracted.supplier.qpdfVersion, "12.4.0");
  assert.deepEqual(pdfSignatures(installed.qpdfPath, managedFilePath(inbox.getFileAssetForViewing(extracted.outputs[0].contentId).storageKey)), ["400x500@0", "200x300@0"]);
  assert.equal(extracted.outputs[0].pageCount, 2);
  assert.deepEqual(inbox.getFileAssetForViewing(pdfId), sourcePdf);
  assert.notEqual(extracted.outputs[0].assetId, sourcePdf.assetId);
  assert.equal(inbox.getContentItemSummary(extracted.outputs[0].contentId).folder_id, destinationFolder);
  for (const output of [converted, ...extracted.outputs]) {
    const run = service.listAutomationRunsPage({ limit: 100 }).items.find(item => item.status === "completed" && item.output_payload_json.includes(output.contentId));
    const receipt = inbox.getFileCreationByIdempotencyKey(`automation:${run.id}:output:0`);
    assert.equal(receipt.state, "committed"); assert.equal(receipt.contentId, output.contentId); assert.equal(receipt.versionId, output.versionId);
    assert.equal(inbox.getFileAssetForViewing(output.contentId).sha256, output.sha256);
  }
  // Genuine Supplier business failures may safely fail again; Retry never edits inputs.
  const brokenImage = await upload(Buffer.from("not a PNG"), "broken.png", "image/png");
  for (const [toolId, rawInput] of [
    ["core.file-converter", { contentItemId: brokenImage, conversionId: "png-to-jpeg", profile: "balanced" }],
    ["core.pdf-tools", { operation: "pdf.extract", contentItemIds: [pdfId], pageSelector: "99" }],
  ]) {
    const initial = await service.executeExternalTool({ operationId: randomUUID(), toolId, rawInput, projectId });
    assert.equal(initial.status, "failed");
    const parent = service.getAutomationRun(initial.runId);
    assert.match(parent.error_code, toolId === "core.file-converter" ? /^FC_/u : /^parameter\./u, "failure came from the real Supplier contract");
    const before = database.one("SELECT count(*) AS n FROM content_items").n;
    const child = await service.retryExternalTool(parent.id);
    assert.equal(child.status, "failed");
    assert.equal(service.getAutomationRun(child.runId).error_code, parent.error_code);
    assert.deepEqual(service.getAutomationRun(parent.id), parent);
    assert.equal(database.one("SELECT count(*) AS n FROM content_items").n, before);
    assert.equal(inbox.hasFileCreationReceiptWithPrefix(`automation:${child.runId}:output:`), false);
  }
  const reopened = new DatabaseSync(path.join(root, "app.sqlite"), { readOnly: true });
  try {
    assert.equal(reopened.prepare("SELECT count(*) AS n FROM automation_runs child JOIN automation_runs parent ON parent.id = child.retry_of_run_id WHERE parent.status = 'failed'").get().n, 4);
    assert.equal(reopened.prepare("SELECT count(*) AS n FROM automation_runs WHERE retry_of_run_id IS NOT NULL AND status = 'completed'").get().n, 2);
  } finally { reopened.close(); }
  assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
  console.log("Real Retry engine gate PASS: injected pre-invocation failures -> new completed Runs through real Sharp PNG/JPEG and qpdf ordered page extraction; genuine FC/PDF Supplier failures -> new failed Runs without output; reopened database lineage, Host validation, receipts, fixed sources/destination and duplicate replay. No browser acceptance claimed.");
} finally { database?.db().close(); await rm(root, { recursive: true, force: true }); }
