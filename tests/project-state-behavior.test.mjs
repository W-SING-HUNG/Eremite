import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writePdfFixture } from "./pdf-tools-fixture.mjs";

const root = await mkdtemp(path.join(tmpdir(), "eremite-project-state-behavior-"));
process.env.EREMITE_DATA_DIR = path.join(root, "data");
let database;
let cases = 0;
try {
  database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const { fileConverterServerTool: fc } = await import("@/modules/automations/tools/file-converter/server-tool");
  const { pdfToolsServerTool: pdf } = await import("@/modules/automations/tools/pdf-tools/server-tool");
  const projectId = projects.createProject({ name: "State capability QA" });
  const sourceFolder = folders.createFolder({ projectId, name: "Source" });
  const secondFolder = folders.createFolder({ projectId, name: "Second source" });
  const destinationFolder = folders.createFolder({ projectId, parentId: secondFolder, name: "Destination" });
  const foreignProject = projects.createProject({ name: "Foreign" });
  const foreignFolder = folders.createFolder({ projectId: foreignProject, name: "Foreign" });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=", "base64");
  const pdfPath = path.join(root, "source.pdf");
  await writePdfFixture(pdfPath, [{ width: 200, height: 300, label: "state" }]);
  const pdfBytes = await readFile(pdfPath);
  const upload = (bytes, name, mimeType, folderId) => inbox.createFileContentItemFromStream({ body: new File([bytes], name, { type: mimeType }).stream(), originalName: name, mimeType, expectedSize: bytes.length, projectId, folderId });
  const imageId = await upload(png, "source.png", "image/png", sourceFolder);
  const pdfA = await upload(pdfBytes, "first.pdf", "application/pdf", sourceFolder);
  const pdfB = await upload(pdfBytes, "second.pdf", "application/pdf", secondFolder);
  const imageBefore = inbox.getFileAssetForViewing(imageId);
  const pdfBefore = inbox.getFileAssetForViewing(pdfA);
  const operations = [
    { operation: "pdf.merge", contentItemIds: [pdfA, pdfB] },
    { operation: "pdf.split", contentItemIds: [pdfA], splitEvery: "1" },
    { operation: "pdf.extract", contentItemIds: [pdfA], pageSelector: "1" },
    { operation: "pdf.rotate", contentItemIds: [pdfA], pageSelector: "1", rotateAngle: "90", rotateMode: "relative" },
    { operation: "pdf.reorder", contentItemIds: [pdfA], pageOrder: "1" },
  ];
  for (const [tool, raw] of [[fc, { contentItemId: imageId, conversionId: "png-to-jpeg" }], ...operations.map(raw => [pdf, raw])]) {
    for (const [destination, expected] of [[{}, sourceFolder], [{ folderId: undefined }, sourceFolder], [{ folderId: null }, null], [{ folderId: "" }, null], [{ folderId: destinationFolder }, destinationFolder]]) {
      const input = tool.validateInput({ ...raw, ...destination }, { projectId });
      assert.equal(input.folderId, expected, `${tool.toolId}/${raw.operation ?? raw.conversionId}: explicit root differs from source default`);
      const snapshot = tool.encodeInputPayload(input);
      assert.equal(snapshot.destination.folderId, expected);
      assert.equal(snapshot.retryEvidence.destination.folderId, expected);
      if (expected === null) assert.equal(tool.validateRetryInput(snapshot).folderId, null, "Retry preserves frozen root");
      cases += 1;
    }
    for (const folderId of ["unavailable-folder", foreignFolder]) {
      assert.throws(() => tool.validateInput({ ...raw, folderId }, { projectId }), { code: "project_mismatch" });
      cases += 1;
    }
  }
  assert.equal(pdf.validateInput({ operation: "pdf.merge", contentItemIds: [pdfB, pdfA] }, { projectId }).folderId, secondFolder);
  assert.deepEqual(inbox.getFileAssetForViewing(imageId), imageBefore);
  assert.deepEqual(inbox.getFileAssetForViewing(pdfA), pdfBefore);
  assert.equal(database.one("SELECT count(*) AS n FROM automation_runs").n, 0, "a reading/validation gate executes no Supplier or Automation Run");
  console.log(`Project state behavior passed: ${cases} destination/rejection cases, first-source ordering, frozen root Retry and source preservation; real output writes remain covered by existing integration tests.`);
} finally {
  database?.db().close();
  await rm(root, { recursive: true, force: true });
}
