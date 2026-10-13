import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { File } from "node:buffer";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import "./automation-retry-confirmation.test.mjs";

const root = await mkdtemp(path.join(tmpdir(), "eremite-tool-retry-"));
process.env.EREMITE_DATA_DIR = root;
let database;
try {
  database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const service = await import("@/modules/automations/service");
  const { serverToolRegistry } = await import("@/modules/automations/registry");
  const { reconcileInterruptedAutomationRuns } = await import("@/modules/automations/reconciliation");
  const { validateSupplierOutput } = await import("@/modules/automations/tools/file-converter/output-validation");
  const { ToolRetryError } = await import("@/modules/automations/tools/retry-snapshot");
  const { mutationFailure } = await import("@/app/_lib/server-mutation-error");
  const fc = serverToolRegistry["core.file-converter"];
  const pdf = serverToolRegistry["core.pdf-tools"];
  const fcExecute = fc.executeExternal;
  const pdfExecute = pdf.executeExternal;
  const bytes = Buffer.from("immutable test input");
  const upload = (name = "source.png", location = {}) => inbox.createFileContentItemFromStream({ body: new File([bytes], name).stream(), originalName: name, mimeType: name.endsWith(".pdf") ? "application/pdf" : "image/png", expectedSize: bytes.length, ...location });
  const raw = contentItemId => ({ contentItemId, conversionId: "png-to-jpeg", profile: "balanced" });
  const countRuns = () => database.one("SELECT count(*) AS n FROM automation_runs").n;
  async function failed(tool = fc, input = raw(sourceId)) {
    const original = tool.executeExternal;
    tool.executeExternal = async () => { throw new Error("injected pre-Supplier failure"); };
    try {
      const result = await service.executeExternalTool({ operationId: randomUUID(), toolId: tool.toolId, rawInput: input });
      assert.equal(result.status, "failed");
      return result.runId;
    } finally { tool.executeExternal = original; }
  }
  const sourceId = await upload();
  async function rejected(id, code) {
    const before = countRuns();
    assert.equal(service.getAutomationRetryEligibility(id).allowed, false);
    assert.equal(service.getAutomationRetryEligibility(id).reason, code);
    await assert.rejects(service.retryExternalTool(id), { code });
    assert.equal(countRuns(), before);
  }
  try {
    const parentId = await failed();
    const parentBefore = service.getAutomationRun(parentId);
    assert.equal(service.getAutomationRetryEligibility(parentId).allowed, true);
    let calls = 0;
    let resume;
    const waiting = new Promise(resolve => { resume = resolve; });
    fc.executeExternal = async () => { calls += 1; await waiting; throw new Error("Supplier failed again"); };
    const firstPromise = service.retryExternalTool(parentId);
    const duplicate = await service.retryExternalTool(parentId);
    assert.equal(duplicate.status, "running");
    assert.equal(duplicate.reused, true);
    resume();
    const first = await firstPromise;
    assert.equal(calls, 1);
    assert.equal(first.runId, duplicate.runId);
    assert.equal(first.status, "failed");
    const child = service.getAutomationRun(first.runId);
    assert.throws(() => database.run(`INSERT INTO automation_runs (id, automation_key, target_id, target_version, target_name_snapshot, operation_id, status, input_summary, input_payload_json, project_id, project_name_snapshot, created_at, retry_of_run_id) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`, randomUUID(), child.automation_key, child.target_id, child.target_version, child.target_name_snapshot, randomUUID(), child.input_summary, child.input_payload_json, child.project_id, child.project_name_snapshot, new Date().toISOString(), parentId), /UNIQUE constraint failed/);
    assert.notEqual(first.runId, parentId);
    assert.equal(service.getAutomationRun(first.runId).retry_of_run_id, parentId);
    assert.notEqual(service.getAutomationRun(first.runId).operation_id, parentBefore.operation_id);
    assert.deepEqual(service.getAutomationRun(parentId), parentBefore);
    assert.equal(service.getAutomationRun(first.runId).input_payload_json, parentBefore.input_payload_json);
    assert.deepEqual(await service.retryExternalTool(parentId), { runId: first.runId, reused: true, status: "failed" });
    assert.equal(service.getAutomationRetryEligibility(first.runId).allowed, true);
    assert.throws(() => database.run("UPDATE automation_runs SET retry_of_run_id = NULL WHERE id = ?", first.runId), /automation_retry_identity_immutable/);
    assert.throws(() => database.run("DELETE FROM automation_runs WHERE id = ?", first.runId), /automation_retry_history_required/);
    assert.throws(() => service.permanentlyDeleteAutomationRun(parentId), { code: "retry_history_required" });
    assert.match(mutationFailure(new ToolRetryError("retry_history_required")).message, /不能永久删除/u);
    service.trashAutomationRun(first.runId, service.getAutomationRun(first.runId).revision);
    assert.equal(service.getAutomationRunView(parentId).retry.childTrashed, true);
    assert.equal((await service.retryExternalTool(parentId)).runId, first.runId, "Trash never drops the deduplication receipt");
    service.restoreAutomationRun(first.runId, service.getAutomationRun(first.runId).revision);
    service.trashAutomationRun(parentId, service.getAutomationRun(parentId).revision);
    assert.equal(service.getAutomationRunView(first.runId).retry.parentTrashed, true);
    service.restoreAutomationRun(parentId, service.getAutomationRun(parentId).revision);

    const renamed = await upload("rename.png");
    const renameRun = await failed(fc, raw(renamed));
    inbox.updateContentItem({ id: renamed, title: "changed", status: "inbox", expectedRevision: inbox.getContentItemSummary(renamed).revision });
    await rejected(renameRun, "retry_stale_source");
    const replaced = await upload("replace.png");
    const replaceRun = await failed(fc, raw(replaced));
    const old = inbox.getFileAssetForViewing(replaced);
    await inbox.replaceFileContentItemFromStream({ contentId: replaced, expectedVersionId: old.versionId, idempotencyKey: randomUUID(), body: new File([Buffer.from("new")], "new.png").stream(), originalName: "new.png", mimeType: "image/png" });
    assert.ok(inbox.getFileAssetForViewing(replaced, old.versionId), "old immutable version still exists");
    await rejected(replaceRun, "retry_stale_source");

    const unavailable = await upload("trash.png");
    const unavailableRun = await failed(fc, raw(unavailable));
    inbox.trashContentItem(unavailable, inbox.getContentItemSummary(unavailable).revision);
    await rejected(unavailableRun, "retry_stale_source");

    const versionRun = await failed();
    const { toolCatalog } = await import("@/modules/automations/tools/catalog");
    const meta = toolCatalog.find(tool => tool.id === fc.toolId);
    meta.version += 1;
    try { await rejected(versionRun, "retry_stale_tool"); } finally { meta.version -= 1; }
    const policyRun = await failed();
    const originalEncode = fc.encodeInputPayload;
    fc.encodeInputPayload = input => { const value = originalEncode(input); value.retryEvidence.policy = "different current capability"; return value; };
    try { await rejected(policyRun, "retry_stale_tool"); } finally { fc.encodeInputPayload = originalEncode; }

    const projectId = projects.createProject({ name: "Retry Project" });
    const folderId = folders.createFolder({ projectId, name: "Destination" });
    const located = await upload("located.png", { projectId, folderId });
    const locationRun = await failed(fc, raw(located));
    folders.renameFolder({ id: folderId, name: "Renamed", expectedRevision: folders.getFolder(folderId).revision });
    await rejected(locationRun, "retry_stale_destination");
    const rootInput = fc.validateInput({ ...raw(located), folderId: null }, {});
    assert.equal(rootInput.folderId, null, "explicit root is captured directly from the requested destination");
    const rootSnapshot = fc.encodeInputPayload(rootInput);
    assert.equal(fc.validateRetryInput(rootSnapshot).folderId, null, "explicit root does not default to source Folder");

    const pdfA = await upload("a.pdf", { projectId, folderId }); const pdfB = await upload("b.pdf", { projectId, folderId });
    for (const input of [
      { operation: "pdf.merge", contentItemIds: [pdfB, pdfA] },
      { operation: "pdf.split", contentItemIds: [pdfA], splitEvery: 2 },
      { operation: "pdf.extract", contentItemIds: [pdfA], pageSelector: "3,1,1" },
      { operation: "pdf.rotate", contentItemIds: [pdfA], pageSelector: "2,1", rotateAngle: 270, rotateMode: "absolute" },
      { operation: "pdf.reorder", contentItemIds: [pdfA], pageOrder: "3,1,2" },
    ]) {
      const id = await failed(pdf, { ...input, folderId: null });
      const payload = JSON.parse(service.getAutomationRun(id).input_payload_json);
      assert.equal(payload.destination.folderId, null, "all five PDF operations freeze explicit Project root");
      assert.equal(payload.retryEvidence.destination.folderId, null);
      assert.equal(pdf.validateRetryInput(payload).folderId, null, "PDF Retry must not recalculate the source Folder");
      assert.deepEqual(pdf.encodeInputPayload(pdf.validateRetryInput(payload)), payload, "canonical pages/order round-trip without defaults");
      assert.equal(service.getAutomationRetryEligibility(id).allowed, true);
    }

    const sourceVersion = inbox.getFileAssetForViewing(sourceId);
    const basePayload = fc.encodeInputPayload(fc.validateInput(raw(sourceId), {}));
    function insert(payload, output = null, status = "failed", toolId = fc.toolId, outputSummary = null) {
      const id = randomUUID();
      database.run(`INSERT INTO automation_runs (id, automation_key, target_id, target_version, target_name_snapshot, operation_id, status, input_summary, input_payload_json, output_payload_json, created_at, output_summary) VALUES (?, ?, ?, 1, 'Fixture', ?, ?, 'Fixture', ?, ?, ?, ?)`, id, toolId, toolId, randomUUID(), status, JSON.stringify(payload), output === null ? null : JSON.stringify(output), new Date().toISOString(), outputSummary);
      if (toolId === fc.toolId) database.run("INSERT INTO automation_run_inputs (run_id, ordinal, content_id, content_title_snapshot, file_version_id, file_name_snapshot, file_sha256_snapshot, file_byte_size_snapshot) VALUES (?, 0, ?, 'source', ?, ?, ?, ?)", id, sourceId, sourceVersion.versionId, sourceVersion.originalName, sourceVersion.sha256, sourceVersion.byteSize);
      return id;
    }
    const legacy = structuredClone(basePayload); delete legacy.retryEvidence;
    await rejected(insert(legacy), "retry_snapshot_incomplete");
    // D-1: output destination is separate from the still-available source Folder.
    for (const tool of [fc, pdf]) {
      const destinationProject = projects.createProject({ name: `D-1 ${tool.toolId}` });
      const sourceFolder = folders.createFolder({ projectId: destinationProject, name: "Source" });
      const outputFolder = folders.createFolder({ projectId: destinationProject, name: "Output" });
      const source = await upload(tool === fc ? "d1.png" : "d1.pdf", { projectId: destinationProject, folderId: sourceFolder });
      const input = tool === fc ? { ...raw(source), folderId: outputFolder }
        : { operation: "pdf.extract", contentItemIds: [source], pageSelector: "1", folderId: outputFolder };
      const id = await failed(tool, input);
      const before = service.getAutomationRun(id);
      const sourceBefore = inbox.getContentItemSummary(source);
      folders.renameFolder({ id: outputFolder, name: "Renamed Output", expectedRevision: folders.getFolder(outputFolder).revision });
      await rejected(id, "retry_stale_destination");
      folders.trashFolder(outputFolder, folders.getFolder(outputFolder).revision);
      assert.deepEqual(inbox.getContentItemSummary(source), sourceBefore, "trashing output Folder does not stale the source");
      await rejected(id, "retry_stale_destination");
      await assert.rejects(service.retryExternalTool(id), error => {
        assert.match(mutationFailure(error).message, /原输出位置已变化或不可用/u);
        return error.code === "retry_stale_destination";
      });
      assert.deepEqual(service.getAutomationRun(id), before, "rejected retries preserve the failed Run");
      assert.equal(inbox.hasFileCreationReceiptWithPrefix(`automation:${id}:output:`), false);
      const incomplete = JSON.parse(before.input_payload_json); delete incomplete.retryEvidence;
      await rejected(insert(incomplete, null, "failed", tool.toolId), "retry_snapshot_incomplete");
      const missingDestination = JSON.parse(before.input_payload_json); delete missingDestination.destination.folderId;
      await rejected(insert(missingDestination, null, "failed", tool.toolId), "retry_snapshot_incomplete");
    }
    const invalidParams = structuredClone(basePayload); invalidParams.profile = "unaccepted";
    await rejected(insert(invalidParams), "retry_snapshot_incomplete");
    await rejected(insert(basePayload, { phase: "supplier_validated" }), "retry_output_exists");
    await rejected(insert(basePayload, { contentId: randomUUID() }), "retry_output_exists");
    await rejected(insert(basePayload, null, "failed", fc.toolId, "historical output evidence"), "retry_output_exists");
    for (const state of ["created", "staged", "published", "committed", "failed", "reconciled"]) {
      const id = insert(basePayload);
      database.run("INSERT INTO file_write_operations (id, idempotency_key, operation_type, state, created_at, updated_at) VALUES (?, ?, 'upload', ?, ?, ?)", randomUUID(), `automation:${id}:output:999`, state, new Date().toISOString(), new Date().toISOString());
      await rejected(id, "retry_output_exists");
    }
    await rejected(insert(basePayload, null, "completed"), "retry_not_allowed");
    await rejected(insert(basePayload, null, "running"), "retry_not_allowed");
    await rejected(insert({}, null, "failed", "core.content-to-action-drafts"), "retry_not_allowed");

    const validationParent = await failed();
    const badPath = path.join(root, "bad.jpg"); await writeFile(badPath, Buffer.from("bad output"));
    const beforeContent = database.one("SELECT count(*) AS n FROM content_items").n;
    fc.executeExternal = async () => validateSupplierOutput({ outputPath: badPath, outputDirectory: root, maximumBytes: 512, response: { output: { byteSize: 10, sha256: "wrong" } } });
    const badChild = await service.retryExternalTool(validationParent);
    assert.equal(badChild.status, "failed");
    assert.equal(database.one("SELECT count(*) AS n FROM content_items").n, beforeContent);
    assert.equal(inbox.hasFileCreationReceiptWithPrefix(`automation:${badChild.runId}:output:`), false);

    // Old executor resumes before writePending: its terminal state must fence it.
    let resumeOld; let oldId;
    const oldWait = new Promise(resolve => { resumeOld = resolve; });
    fc.executeExternal = async (_input, context) => { oldId = context.runId; await oldWait; context.writePending({ phase: "supplier_validated" }); throw new Error("must not reach commit"); };
    const oldPromise = service.executeExternalTool({ operationId: randomUUID(), toolId: fc.toolId, rawInput: raw(sourceId) });
    const future = new Date(Date.now() + 30 * 60 * 1000);
    reconcileInterruptedAutomationRuns({ now: future });
    assert.equal(service.getAutomationRun(oldId).status, "failed");
    assert.equal(service.getAutomationRetryEligibility(oldId).allowed, true);
    fc.executeExternal = async () => { throw new Error("retry failure"); };
    await service.retryExternalTool(oldId);
    resumeOld(); await oldPromise;
    assert.equal(service.getAutomationRun(oldId).output_payload_json, null);
    assert.equal(inbox.hasFileCreationReceiptWithPrefix(`automation:${oldId}:output:`), false);

    // Pause inside File Lifecycle after pending, then reconcile. Test single AND batch.
    for (const batch of [false, true]) {
      let releaseStream; let started; let runId;
      const entered = new Promise(resolve => { started = resolve; });
      const streamWait = new Promise(resolve => { releaseStream = resolve; });
      const tool = batch ? pdf : fc;
      tool.executeExternal = async (_input, context) => {
        runId = context.runId;
        context.writePending({ schemaVersion: 1, phase: "supplier_validated" });
        const body = new ReadableStream({ async start(controller) { started(); await streamWait; controller.enqueue(Buffer.from("guarded output")); controller.close(); } });
        const file = { body, originalName: "guarded.pdf", mimeType: "application/pdf", idempotencyKey: `automation:${runId}:output:0`, beforeCommit: context.assertRunning };
        return batch ? inbox.createFileContentItemsFromStreams([file, { ...file, body: new File([bytes], "second.pdf").stream(), idempotencyKey: `automation:${runId}:output:1` }]) : inbox.createFileContentItemFromStream(file);
      };
      const input = batch ? { operation: "pdf.merge", contentItemIds: [pdfA, pdfB] } : raw(sourceId);
      const contentBefore = database.one("SELECT count(*) AS n FROM content_items").n;
      const blobsBefore = database.all("SELECT * FROM file_blobs ORDER BY id");
      const filesBefore = (await readdir(database.filesDirectory, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort();
      const oldExecution = service.executeExternalTool({ operationId: randomUUID(), toolId: tool.toolId, rawInput: input });
      await entered;
      reconcileInterruptedAutomationRuns({ now: future });
      assert.equal(service.getAutomationRun(runId).status, "failed");
      releaseStream(); await oldExecution;
      assert.equal(database.one("SELECT count(*) AS n FROM content_items").n, contentBefore, "terminal old executor cannot commit formal output");
      assert.deepEqual(database.all("SELECT * FROM file_blobs ORDER BY id"), blobsBefore, "stale single/batch executors leave blob metadata unchanged");
      assert.deepEqual((await readdir(database.filesDirectory, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort(), filesBefore, "stale single/batch executors remove only their newly published blobs");
      assert.equal(inbox.getFileCreationByIdempotencyKey(`automation:${runId}:output:0`).state, "failed");
      await rejected(runId, "retry_output_exists");
    }
    assert.equal(service.getAutomationRunView(parentId).retry.childRunId, first.runId);
    assert.equal(service.listAutomationRunsPage({ limit: 100 }).items.find(item => item.id === first.runId).retry_of_run_id, parentId);
    assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok");
    assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
    console.log("Tool Retry contract PASS: independent lineage, concurrent dedup, stale/version/policy/destination guards, canonical PDF order, legacy rejection, every receipt state, Host validation and both stale-executor commit races.");
  } finally { fc.executeExternal = fcExecute; pdf.executeExternal = pdfExecute; }
  await (await import("./tool-run-retry-deep-folders.test.mjs")).checkDeepFolderRetry(root);
} finally { database?.db().close(); await rm(root, { recursive: true, force: true }); }
