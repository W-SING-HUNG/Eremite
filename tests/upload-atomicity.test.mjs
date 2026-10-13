import assert from "node:assert/strict";
import { File } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-upload-atomicity-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;

let databaseModule;
try {
  const inbox = await import("@/modules/inbox/service");
  databaseModule = await import("@/platform/db/database");

  const collisionBytes = Buffer.from("database rollback collision fixture");
  databaseModule.db().exec("CREATE TRIGGER force_content_insert_failure BEFORE INSERT ON content_items BEGIN SELECT RAISE(ABORT, 'forced database failure'); END;");

  await assert.rejects(
    () => inbox.createFileContentItem(new File([collisionBytes], "collision.txt", { type: "text/plain" })),
    /forced database failure/,
  );
  assert.equal(databaseModule.db().prepare("SELECT COUNT(*) AS count FROM content_items").get().count, 0);
  const storedFiles = (await readdir(path.join(temporaryRoot, "files"), { withFileTypes: true })).filter((entry) => entry.isFile());
  assert.equal(storedFiles.length, 0, "database failure must remove only the newly promoted, unreferenced blob");
  for (const table of ["file_assets", "file_versions", "file_blobs"]) assert.equal(databaseModule.one(`SELECT COUNT(*) AS count FROM ${table}`).count, 0, `${table} rolls back`);
  assert.equal(databaseModule.one("SELECT state FROM file_write_operations").state, "failed");
  const stagingFiles = await readdir(path.join(temporaryRoot, "files", ".upload-staging"), { withFileTypes: true });
  assert.equal(stagingFiles.filter((entry) => entry.isFile()).length, 0, "database failure must remove staging files");

  databaseModule.db().exec("DROP TRIGGER force_content_insert_failure");
  const recoveredId = await inbox.createFileContentItem(new File([collisionBytes], "recovered.txt", { type: "text/plain" }));
  const recovered = inbox.getFileAssetForViewing(recoveredId);
  assert.deepEqual(await readFile(path.join(temporaryRoot, "files", recovered.storageKey)), collisionBytes, "a new request can recover after rollback");
  const bytesHash = bytes => createHash("sha256").update(bytes).digest("hex");
  const diskFiles = async () => (await readdir(path.join(temporaryRoot, "files"), { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort();
  const snapshot = () => Object.fromEntries(["content_items", "file_assets", "file_versions", "file_blobs"].map(table => [table, databaseModule.all(`SELECT * FROM ${table} ORDER BY id`)]));
  // The deferred FK rejects the outer SQLite COMMIT, after all logical-file rows have been inserted.
  databaseModule.db().exec("CREATE TABLE qa_commit_failure_guard (content_id TEXT REFERENCES content_items(id) DEFERRABLE INITIALLY DEFERRED) STRICT;");
  const commitBytes = Buffer.from("deferred commit failure output");
  const beforeCommitRows = snapshot(); const beforeCommitFiles = await diskFiles();
  await assert.rejects(inbox.createFileContentItemFromStream({
    body: new File([commitBytes], "commit.txt").stream(), originalName: "commit.txt", mimeType: "text/plain", idempotencyKey: "deferred-commit-failure",
    beforeCommit() { databaseModule.run("INSERT INTO qa_commit_failure_guard (content_id) VALUES ('missing-commit-target')"); },
  }), /FOREIGN KEY constraint failed/);
  assert.deepEqual(snapshot(), beforeCommitRows);
  assert.deepEqual(await diskFiles(), beforeCommitFiles, "actual COMMIT rejection removes the new unreferenced blob");
  assert.equal(databaseModule.one("SELECT count(*) AS count FROM qa_commit_failure_guard").count, 0);
  assert.equal(inbox.getFileCreationByIdempotencyKey("deferred-commit-failure").state, "failed");
  databaseModule.db().exec("DROP TABLE qa_commit_failure_guard");
  async function rejectedFence(bytes, key) {
    const before = snapshot();
    const hash = bytesHash(bytes);
    let promoted = false;
    await assert.rejects(inbox.createFileContentItemFromStream({
      body: new File([bytes], "fenced.txt").stream(), originalName: "fenced.txt", mimeType: "text/plain", expectedSize: bytes.length, idempotencyKey: key,
      beforeCommit() { promoted = true; throw new Error("terminal Run commit fence"); },
    }), /terminal Run commit fence/);
    assert.equal(promoted, true, "failure is injected inside the real commit transaction, after blob promotion");
    assert.deepEqual(snapshot(), before, "the transaction preserves all pre-existing rows");
    assert.equal(inbox.getFileCreationByIdempotencyKey(key).state, "failed");
    assert.deepEqual(await readdir(path.join(temporaryRoot, "files", ".upload-staging")), []);
    return hash;
  }
  const fenceBytes = Buffer.from("new fenced output");
  const beforeFenceFiles = await diskFiles();
  await rejectedFence(fenceBytes, "fenced-new");
  assert.deepEqual(await diskFiles(), beforeFenceFiles, "terminal Run rejection leaves no new orphan");
  await rejectedFence(collisionBytes, "fenced-shared");
  assert.deepEqual(await readFile(path.join(temporaryRoot, "files", recovered.storageKey)), collisionBytes, "shared referenced bytes survive failed publication");
  const existingBytes = Buffer.from("pre-existing unreferenced bytes");
  const existingHash = bytesHash(existingBytes);
  await writeFile(path.join(temporaryRoot, "files", existingHash), existingBytes);
  await rejectedFence(existingBytes, "fenced-existing");
  assert.deepEqual(await readFile(path.join(temporaryRoot, "files", existingHash)), existingBytes, "even unreferenced pre-existing files are never owned by this failed promotion");
  // A previously referenced blob can be missing on disk; recreating it must not delete shared metadata's bytes.
  await unlink(path.join(temporaryRoot, "files", recovered.storageKey));
  await rejectedFence(collisionBytes, "fenced-recreated-reference");
  assert.deepEqual(await readFile(path.join(temporaryRoot, "files", recovered.storageKey)), collisionBytes);
  assert.deepEqual(inbox.getFileAssetForViewing(recoveredId), recovered);
  // If the failure marker itself cannot be written, startup reconciliation still recovers the published journal.
  databaseModule.db().exec("CREATE TRIGGER force_failed_journal_error BEFORE UPDATE OF state ON file_write_operations WHEN NEW.state = 'failed' BEGIN SELECT RAISE(ABORT, 'journal failure'); END;");
  const journalBytes = Buffer.from("unfinished journal output");
  const beforeJournalFiles = await diskFiles();
  await assert.rejects(inbox.createFileContentItemFromStream({ body: new File([journalBytes], "journal.txt").stream(), originalName: "journal.txt", mimeType: "text/plain", idempotencyKey: "fenced-journal", beforeCommit() { throw new Error("original fence failure"); } }), /original fence failure/);
  assert.equal(inbox.getFileCreationByIdempotencyKey("fenced-journal").state, "published");
  assert.deepEqual(await diskFiles(), beforeJournalFiles);
  databaseModule.db().exec("DROP TRIGGER force_failed_journal_error");
  assert.equal(await inbox.reconcilePendingFileWrites(), 1);
  assert.equal(inbox.getFileCreationByIdempotencyKey("fenced-journal").state, "reconciled");
  assert.equal(await inbox.reconcilePendingFileWrites(), 0, "recovery is idempotent");
  const duplicateBytes = Buffer.from("concurrent duplicate fixture");
  const [firstId, secondId] = await Promise.all([
    inbox.createFileContentItem(new File([duplicateBytes], "first.txt", { type: "text/plain" })),
    inbox.createFileContentItem(new File([duplicateBytes], "second.txt", { type: "text/plain" })),
  ]);
  assert.notEqual(firstId, secondId);
  assert.equal(databaseModule.db().prepare("SELECT COUNT(*) AS count FROM content_items").get().count, 3);
  assert.equal(databaseModule.db().prepare("SELECT COUNT(*) AS count FROM file_assets").get().count, 3, "duplicate bytes still receive separate logical assets");
  assert.equal(databaseModule.db().prepare("SELECT COUNT(*) AS count FROM file_versions").get().count, 3);
  assert.equal(databaseModule.db().prepare("SELECT COUNT(*) AS count FROM file_blobs").get().count, 2);
  assert.deepEqual(await diskFiles(), [recovered.storageKey, existingHash, bytesHash(duplicateBytes)].sort(), "only two referenced blobs and the deliberately pre-existing file remain");
  assert.equal(databaseModule.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(databaseModule.all("PRAGMA foreign_key_check"), []);
  console.log("Upload atomicity test passed: rollback preserves database integrity and duplicate bytes share one immutable blob.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
