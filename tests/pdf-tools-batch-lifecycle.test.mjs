import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-pdf-batch-lifecycle-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let database;
try {
  database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const projectId = projects.createProject({ name: "PDF 批量专案" });
  const folderId = folders.createFolder({ projectId, name: "输出" });
  const files = [Buffer.from("pdf-one"), Buffer.from("pdf-two"), Buffer.from("pdf-three")];
  const keys = files.map((_, index) => `automation:11111111-1111-7111-8111-111111111111:output:${index}`);
  const inputs = files.map((bytes, index) => ({
    body: new File([bytes], `part-${index + 1}.pdf`, { type: "application/pdf" }).stream(),
    originalName: `part-${index + 1}.pdf`,
    mimeType: "application/pdf",
    expectedSize: bytes.length,
    title: `Part ${index + 1}`,
    projectId,
    folderId,
    idempotencyKey: keys[index],
  }));
  const contentIds = await inbox.createFileContentItemsFromStreams(inputs);
  assert.equal(contentIds.length, 3);
  contentIds.forEach((contentId) => {
    const summary = inbox.getContentItemSummary(contentId);
    assert.equal(summary.project_id, projectId);
    assert.equal(summary.folder_id, folderId);
  });
  const replayed = await inbox.createFileContentItemsFromStreams(files.map((bytes, index) => ({
    body: new File([bytes], `replay-${index}.pdf`, { type: "application/pdf" }).stream(),
    originalName: `replay-${index}.pdf`,
    mimeType: "application/pdf",
    expectedSize: bytes.length,
    idempotencyKey: keys[index],
  })));
  assert.deepEqual(replayed, contentIds);

  const before = {
    content: database.one("SELECT COUNT(*) AS count FROM content_items").count,
    assets: database.one("SELECT COUNT(*) AS count FROM file_assets").count,
    versions: database.one("SELECT COUNT(*) AS count FROM file_versions").count,
    blobs: database.one("SELECT COUNT(*) AS count FROM file_blobs").count,
  };
  const broken = new ReadableStream({ start(controller) { controller.error(new Error("forced second stream failure")); } });
  await assert.rejects(() => inbox.createFileContentItemsFromStreams([
    { body: new File([Buffer.from("stage-one")], "stage-one.pdf", { type: "application/pdf" }).stream(), originalName: "stage-one.pdf", mimeType: "application/pdf", idempotencyKey: "batch-stage:0" },
    { body: broken, originalName: "stage-two.pdf", mimeType: "application/pdf", idempotencyKey: "batch-stage:1" },
  ]));
  assert.equal(database.one("SELECT COUNT(*) AS count FROM content_items").count, before.content);

  database.db().exec(`CREATE TRIGGER force_second_pdf_batch_commit
    BEFORE INSERT ON content_items WHEN NEW.title = 'FAIL SECOND'
    BEGIN SELECT RAISE(ABORT, 'forced second batch commit failure'); END;`);
  await assert.rejects(() => inbox.createFileContentItemsFromStreams([
    { body: new File([Buffer.from("commit-one-unique")], "commit-one.pdf", { type: "application/pdf" }).stream(), originalName: "commit-one.pdf", mimeType: "application/pdf", title: "COMMIT FIRST", idempotencyKey: "batch-commit:0" },
    { body: new File([Buffer.from("commit-two-unique")], "commit-two.pdf", { type: "application/pdf" }).stream(), originalName: "commit-two.pdf", mimeType: "application/pdf", title: "FAIL SECOND", idempotencyKey: "batch-commit:1" },
  ]), /forced second batch commit failure/u);
  database.db().exec("DROP TRIGGER force_second_pdf_batch_commit");
  assert.equal(database.one("SELECT COUNT(*) AS count FROM content_items").count, before.content, "second commit failure rolls back the first Content");
  assert.equal(database.one("SELECT COUNT(*) AS count FROM file_assets").count, before.assets);
  assert.equal(database.one("SELECT COUNT(*) AS count FROM file_versions").count, before.versions);
  assert.equal(database.one("SELECT COUNT(*) AS count FROM file_blobs").count, before.blobs);
  assert.equal(inbox.getFileCreationByIdempotencyKey("batch-commit:0").state, "failed");
  assert.equal(inbox.getFileCreationByIdempotencyKey("batch-commit:1").state, "failed");
  const staging = await readdir(path.join(temporaryRoot, "files", ".upload-staging"), { withFileTypes: true });
  assert.equal(staging.filter((entry) => entry.isFile()).length, 0);
  assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
  console.log("PDF Tools batch File Lifecycle gate passed: atomic visibility, deterministic replay, staging failure and second-commit rollback.");
} finally {
  database?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
