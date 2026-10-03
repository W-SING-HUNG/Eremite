import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-file-lifecycle-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let databaseModule;
try {
  const inbox = await import("@/modules/inbox/service");
  databaseModule = await import("@/platform/db/database");
  const original = Buffer.from("version one");
  const contentId = await inbox.createFileContentItem(new File([original], "notes.txt", { type: "text/plain" }), "Notes");
  const first = inbox.getFileAssetForViewing(contentId);
  assert.ok(first);
  assert.equal(first.versionNumber, 1);

  const secondBytes = Buffer.from("version two");
  const second = await inbox.replaceFileContentItemFromStream({
    contentId,
    expectedVersionId: first.versionId,
    idempotencyKey: "replace-1",
    body: new File([secondBytes], "notes.md", { type: "text/markdown" }).stream(),
    originalName: "notes.md",
    mimeType: "text/markdown",
    expectedSize: secondBytes.length,
  });
  assert.equal(second.noOp, false);
  assert.notEqual(second.versionId, first.versionId);
  assert.equal(inbox.getFileAssetForViewing(contentId, first.versionId).originalName, "notes.txt", "historical version remains addressable");

  const replay = await inbox.replaceFileContentItemFromStream({
    contentId,
    expectedVersionId: first.versionId,
    idempotencyKey: "replace-1",
    body: new File([Buffer.from("ignored")], "ignored.txt", { type: "text/plain" }).stream(),
    originalName: "ignored.txt",
    mimeType: "text/plain",
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.versionId, second.versionId);

  await assert.rejects(() => inbox.replaceFileContentItemFromStream({
    contentId,
    expectedVersionId: first.versionId,
    idempotencyKey: "replace-conflict",
    body: new File([Buffer.from("conflict")], "conflict.txt", { type: "text/plain" }).stream(),
    originalName: "conflict.txt",
    mimeType: "text/plain",
  }), (error) => error instanceof inbox.FileVersionConflictError && error.currentVersionId === second.versionId);

  const noOp = await inbox.replaceFileContentItemFromStream({
    contentId,
    expectedVersionId: second.versionId,
    idempotencyKey: "replace-no-op",
    body: new File([secondBytes], "notes.md", { type: "text/markdown" }).stream(),
    originalName: "notes.md",
    mimeType: "text/markdown",
    expectedSize: secondBytes.length,
  });
  assert.equal(noOp.noOp, true);
  assert.equal(inbox.listFileVersions(contentId).length, 2);

  const restored = await inbox.restoreFileVersion({ contentId, versionId: first.versionId, expectedVersionId: second.versionId, idempotencyKey: "restore-1" });
  assert.notEqual(restored.versionId, first.versionId);
  assert.equal(inbox.getFileAssetForViewing(contentId).sha256, first.sha256);
  const versions = inbox.listFileVersions(contentId);
  assert.equal(versions.length, 3);
  assert.equal(versions[0].change_source, "restore");
  assert.equal(versions[0].source_version_id, first.versionId);
  assert.equal(versions.filter((version) => version.is_current === 1).length, 1);
  assert.equal(databaseModule.db().prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(databaseModule.db().prepare("PRAGMA foreign_key_check").all(), []);
  console.log("File lifecycle test passed: CAS replacement, conflict, idempotency, immutable history and restore-as-new-head.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
