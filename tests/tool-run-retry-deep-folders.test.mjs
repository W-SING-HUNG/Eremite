import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { File } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export async function checkDeepFolderRetry(root, realEngines = false) {
  const database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const folders = await import("@/modules/projects/folders");
  const projects = await import("@/modules/projects/service");
  const operations = await import("@/app/_services/resource-operations");
  const service = await import("@/modules/automations/service");
  const { serverToolRegistry } = await import("@/modules/automations/registry");
  const { writePdfFixture } = await import("./pdf-tools-fixture.mjs");
  const sharp = (await import("sharp")).default;
  const projectId = projects.createProject({ name: "Bounded deep Retry" });
  const chain = [];
  for (let depth = 0; depth < 320; depth++) chain.push(folders.createFolder({ projectId, parentId: chain.at(-1) ?? null, name: String(depth).padStart(4, "0") + "x".repeat(251) }));
  const folderId = chain.at(-1);
  assert.equal(folders.getFolderBreadcrumbs(folderId).length, 320);
  assert.ok(folders.isFolderAvailable(folderId, projectId));
  const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#386d95" } }).png().toBuffer();
  const pdfPath = path.join(root, "deep-source.pdf");
  await writePdfFixture(pdfPath, [{ width: 200, height: 300, label: "deep A" }, { width: 300, height: 400, label: "deep B" }]);
  const pdfBytes = await readFile(pdfPath);
  const upload = (bytes, name, mimeType) => inbox.createFileContentItemFromStream({ body: new File([bytes], name, { type: mimeType }).stream(), originalName: name, mimeType, projectId });
  const imageId = await upload(png, "deep.png", "image/png"), pdfId = await upload(pdfBytes, "deep.pdf", "application/pdf");
  const sourcesBefore = [inbox.getFileAssetForViewing(imageId), inbox.getFileAssetForViewing(pdfId)];
  const specs = [
    [serverToolRegistry["core.file-converter"], destination => ({ contentItemId: imageId, conversionId: "png-to-jpeg", folderId: destination })],
    [serverToolRegistry["core.pdf-tools"], destination => ({ operation: "pdf.extract", contentItemIds: [pdfId], pageSelector: "2,1", folderId: destination })],
  ];
  const originalExecutors = specs.map(([tool]) => tool.executeExternal);
  const sizes = [];
  const encode = (tool, raw) => tool.encodeInputPayload(tool.validateInput(raw, { projectId }));
  const legacy = payload => ({ ...payload, retryEvidence: { schemaVersion: 1, sources: payload.retryEvidence.sources, destination: {
    projectId: payload.retryEvidence.destination.projectId, folderId: payload.retryEvidence.destination.folderId, projectName: payload.retryEvidence.destination.projectName,
    folders: payload.destination.folderId ? folders.getFolderBreadcrumbs(payload.destination.folderId).map(f => ({ id: f.id, name: f.name, parentId: f.parent_id, projectId: f.project_id })) : [],
  }, policy: payload.retryEvidence.policy } });
  async function failed(tool, raw, oldSchema = false) {
    const originalEncoder = tool.encodeInputPayload;
    if (oldSchema) tool.encodeInputPayload = input => legacy(originalEncoder(input));
    try { const result = await service.executeExternalTool({ operationId: randomUUID(), toolId: tool.toolId, rawInput: raw, projectId }); assert.equal(result.status, "failed"); return service.getAutomationRun(result.runId); }
    finally { tool.encodeInputPayload = originalEncoder; }
  }
  async function rejectUnchanged(parent) {
    const before = database.one("SELECT count(*) AS n FROM automation_runs").n;
    await assert.rejects(service.retryExternalTool(parent.id), e => e.code === "retry_stale_destination");
    assert.equal(database.one("SELECT count(*) AS n FROM automation_runs").n, before);
    assert.deepEqual(service.getAutomationRun(parent.id), parent);
  }
  async function childKeepsHistory(parent) {
    assert.equal(service.getAutomationRetryEligibility(parent.id).allowed, true);
    const result = await service.retryExternalTool(parent.id);assert.equal(result.status, "failed");
    assert.equal(service.getAutomationRun(result.runId).input_payload_json, parent.input_payload_json, "v1/v2 child keeps the exact frozen parent bytes");
    assert.equal(service.getAutomationRun(result.runId).retry_of_run_id, parent.id);
    assert.deepEqual(service.getAutomationRun(parent.id), parent);
    assert.equal((await service.retryExternalTool(parent.id)).runId, result.runId);
  }
  try {
    for (const [tool, raw] of specs) {
      const payload = encode(tool, raw(folderId));const size = JSON.stringify(payload).length;
      console.log(`${tool.toolId}: 320 legal ancestors, encoded input ${size} characters`);
      assert.ok(size < 65_536, "legal Folder depth must not exhaust the unchanged payload limit");
      assert.equal(payload.retryEvidence.schemaVersion, 2);assert.equal("folders" in payload.retryEvidence.destination, false);
      assert.match(payload.retryEvidence.destination.folderPathSha256, /^[a-f0-9]{64}$/u);
      assert.deepEqual(encode(tool, raw(folderId)), payload, "path digest is deterministic");sizes.push({ tool: tool.toolId, depth: 320, characters: size });
      if (realEngines) {
        const result = await service.executeExternalTool({ operationId: randomUUID(), toolId: tool.toolId, rawInput: raw(folderId), projectId });
        assert.equal(result.status, "completed", JSON.stringify(service.getAutomationRun(result.runId)));
        const outputs = JSON.parse(service.getAutomationRun(result.runId).output_payload_json);
        for (const output of outputs.outputs ?? [outputs]) {
          assert.equal(inbox.getContentItemSummary(output.contentId).folder_id, folderId);
          assert.equal(inbox.getFileAssetForViewing(output.contentId).sha256, output.sha256);
          assert.equal(inbox.getFileCreationByIdempotencyKey(`automation:${result.runId}:output:0`).state, "committed");
        }
      }
      tool.executeExternal = async () => { throw new Error("injected pre-Supplier failure"); };
      const parent = await failed(tool, raw(folderId));await childKeepsHistory(parent);
      const shallow = folders.createFolder({ projectId, name: `Legacy ${tool.toolId}` });
      const oldParent = await failed(tool, raw(shallow), true);assert.equal(JSON.parse(oldParent.input_payload_json).retryEvidence.schemaVersion, 1);await childKeepsHistory(oldParent);
      for (const destination of [null, shallow]) {
        const rootParent = await failed(tool, raw(destination), true);await childKeepsHistory(rootParent);
      }
      for (const schema of [1, 2]) {
        const rawDestination = schema === 1 ? shallow : folderId;
        const parent = await failed(tool, raw(rawDestination), schema === 1);
        const ancestorId = schema === 1 ? shallow : chain[150];const before = folders.getFolder(ancestorId);
        folders.renameFolder({ id: ancestorId, name: `changed ancestor ${schema} ${tool.toolId}`, expectedRevision: before.revision });await rejectUnchanged(parent);
        folders.renameFolder({ id: ancestorId, name: before.name, expectedRevision: folders.getFolder(ancestorId).revision });assert.equal(service.getAutomationRetryEligibility(parent.id).allowed, true);
        const sibling = folders.createFolder({ projectId, name: `Move target ${schema} ${tool.toolId}` });
        operations.moveFolderTree({ id: ancestorId, expectedRevision: folders.getFolder(ancestorId).revision, targetProjectId: projectId, targetParentId: sibling });await rejectUnchanged(parent);
        operations.moveFolderTree({ id: ancestorId, expectedRevision: folders.getFolder(ancestorId).revision, targetProjectId: projectId, targetParentId: before.parent_id });
        const foreignProject = projects.createProject({ name: `Foreign ${schema} ${tool.toolId}` });
        operations.moveFolderTree({ id: ancestorId, expectedRevision: folders.getFolder(ancestorId).revision, targetProjectId: foreignProject, targetParentId: null });await rejectUnchanged(parent);
        operations.moveFolderTree({ id: ancestorId, expectedRevision: folders.getFolder(ancestorId).revision, targetProjectId: projectId, targetParentId: before.parent_id });
        assert.equal(service.getAutomationRetryEligibility(parent.id).allowed, true);
        folders.trashFolder(ancestorId, folders.getFolder(ancestorId).revision);await rejectUnchanged(parent);
        folders.restoreFolder(ancestorId, folders.getFolder(ancestorId).revision);assert.equal(service.getAutomationRetryEligibility(parent.id).allowed, true);
        const bad = JSON.parse(parent.input_payload_json);bad.retryEvidence.unapproved = true;assert.throws(() => tool.validateRetryInput(bad), e => e.code === "retry_snapshot_incomplete");
        const stale = JSON.parse(parent.input_payload_json);if(schema===1)stale.retryEvidence.destination.folders[0].name += "tampered";else stale.retryEvidence.destination.folderPathSha256="0".repeat(64);
        assert.throws(() => tool.validateRetryInput(stale), e => e.code === "retry_stale_destination");
      }
      const originalEncoder = tool.encodeInputPayload;const before = database.one("SELECT count(*) AS n FROM automation_runs").n;
      tool.encodeInputPayload = input => ({ ...originalEncoder(input), overflow: "x".repeat(65_536) });
      try { await assert.rejects(service.executeExternalTool({ operationId: randomUUID(), toolId: tool.toolId, rawInput: raw(folderId), projectId }), e => e.code === "input_unavailable"); }
      finally { tool.encodeInputPayload = originalEncoder; }
      assert.equal(database.one("SELECT count(*) AS n FROM automation_runs").n, before, "65536 remains a hard acceptance boundary");
    }
    // Permanent deletion uses the owning app operation; both historical evidence versions remain guarded.
    for (const [tool, raw] of specs) for (const schema of [1, 2]) {
      const target = folders.createFolder({ projectId, name: `Delete ${schema} ${tool.toolId}` });const parent = await failed(tool, raw(target), schema === 1);
      folders.trashFolder(target, folders.getFolder(target).revision);
      operations.permanentlyDeleteFolderTree({ folderId: target, expectedFolders: 1, expectedContent: 0 });await rejectUnchanged(parent);
    }
    assert.deepEqual([inbox.getFileAssetForViewing(imageId), inbox.getFileAssetForViewing(pdfId)], sourcesBefore);
    assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok");assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
    const state = await readFile("docs/PUBLIC-STATE.md", "utf8");
    assert.ok(state.includes("aa1c95edf1eef3c30154c56b2342c50716275e73f18363f5f224710408abc74e") && state.includes("Independent candidate acceptance | PASS"));
    assert.match(state, /bounded.*candidate.*NOT VERIFIED/u, "new code must not inherit historical independent PASS");
    console.log(`Deep Folder Retry PASS: ${JSON.stringify(sizes)}; both Tools, v1/v2 exact history, rename/move/trash/delete, deterministic bounded digests, tampering and unchanged limit; realEngines=${realEngines}`);
  } finally { specs.forEach(([tool], index) => { tool.executeExternal = originalExecutors[index]; }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = await mkdtemp(path.join(tmpdir(), "eremite-deep-retry-"));process.env.EREMITE_DATA_DIR=root;let database;
  try { database=await import("@/platform/db/database");await checkDeepFolderRetry(root,process.argv.includes("--real")); }
  finally { database?.db().close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
}
