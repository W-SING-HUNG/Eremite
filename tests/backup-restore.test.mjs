import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-backup-restore-"));
const live = path.join(temporaryRoot, "live");
process.env.EREMITE_DATA_DIR = live;
let databaseModule;
try {
  databaseModule = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const backup = await import("@/platform/backup/service");
  const contentId = await inbox.createFileContentItem(new File([Buffer.from("backup bytes")], "backup.txt", { type: "text/plain" }));
  const asset = inbox.getFileAssetForViewing(contentId);
  const created = await backup.createBackup();
  assert.equal(await backup.verifyBackup(created.directory), true);
  const target = path.join(temporaryRoot, "restored");
  const restored = await backup.restoreBackupToNewDataDirectory(created.directory, target);
  assert.equal(restored.fileCount, 1);
  assert.deepEqual(await readFile(path.join(target, "files", asset.storageKey)), Buffer.from("backup bytes"));
  const snapshot = new DatabaseSync(path.join(target, "app.sqlite"), { readOnly: true });
  try {
    assert.equal(snapshot.prepare("SELECT id FROM content_items WHERE id = ?").get(contentId).id, contentId);
    assert.equal(snapshot.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(snapshot.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { snapshot.close(); }
  await assert.rejects(() => backup.restoreBackupToNewDataDirectory(created.directory, target), /already exists/);
  await writeFile(path.join(created.directory, "files", asset.storageKey), "corrupt");
  assert.equal(await backup.verifyBackup(created.directory), false);
  await assert.rejects(() => backup.restoreBackupToNewDataDirectory(created.directory, path.join(temporaryRoot, "rejected")), /verification failed/);
  console.log("Backup restore test passed: complete-marker validation, hash verification, new-directory restore and corruption rejection.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
