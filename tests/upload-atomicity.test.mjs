import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, readdir, rm } from "node:fs/promises";
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
  assert.equal(storedFiles.length, 1, "database failure leaves a safe unreferenced CAS blob for later grace-period GC");
  const stagingFiles = await readdir(path.join(temporaryRoot, "files", ".upload-staging"), { withFileTypes: true });
  assert.equal(stagingFiles.filter((entry) => entry.isFile()).length, 0, "database failure must remove staging files");

  databaseModule.db().exec("DROP TRIGGER force_content_insert_failure");
  const duplicateBytes = Buffer.from("concurrent duplicate fixture");
  const [firstId, secondId] = await Promise.all([
    inbox.createFileContentItem(new File([duplicateBytes], "first.txt", { type: "text/plain" })),
    inbox.createFileContentItem(new File([duplicateBytes], "second.txt", { type: "text/plain" })),
  ]);
  assert.notEqual(firstId, secondId);
  assert.equal(databaseModule.db().prepare("SELECT COUNT(*) AS count FROM content_items").get().count, 2);
  assert.equal(databaseModule.db().prepare("SELECT COUNT(*) AS count FROM file_assets").get().count, 2, "duplicate bytes still receive separate logical assets");
  assert.equal(databaseModule.db().prepare("SELECT COUNT(*) AS count FROM file_versions").get().count, 2);
  assert.equal(databaseModule.db().prepare("SELECT COUNT(*) AS count FROM file_blobs").get().count, 1);
  assert.equal((await readdir(path.join(temporaryRoot, "files"), { withFileTypes: true })).filter((entry) => entry.isFile()).length, 2, "one referenced blob plus the earlier safe orphan remain");
  console.log("Upload atomicity test passed: rollback preserves database integrity and duplicate bytes share one immutable blob.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
