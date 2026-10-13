import assert from "node:assert/strict";
import { File } from "node:buffer";
import fsPromises, { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
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
  const replacement = Buffer.from("replacement bytes");
  await inbox.replaceFileContentItemFromStream({ contentId, expectedVersionId: asset.versionId, idempotencyKey: "backup-history", body: new File([replacement], "backup.txt").stream(), originalName: "backup.txt", mimeType: "text/plain", expectedSize: replacement.length });
  const created = await backup.createBackup();
  const originalManifest = JSON.parse(await readFile(path.join(created.directory, "manifest.json"), "utf8"));
  const sourceVersions = databaseModule.all("SELECT * FROM file_versions ORDER BY id");
  assert.equal(originalManifest.blobs.length, 2, "backups retain current and historical bytes");
  assert.equal(await backup.verifyBackup(created.directory), true);
  const target = path.join(temporaryRoot, "restored");
  const restored = await backup.restoreBackupToNewDataDirectory(created.directory, target);
  assert.equal(restored.fileCount, 2);
  assert.deepEqual(await readFile(path.join(target, "files", asset.storageKey)), Buffer.from("backup bytes"));
  const snapshot = new DatabaseSync(path.join(target, "app.sqlite"), { readOnly: true });
  try {
    assert.equal(snapshot.prepare("SELECT id FROM content_items WHERE id = ?").get(contentId).id, contentId);
    assert.equal(snapshot.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(snapshot.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(snapshot.prepare("SELECT COUNT(*) n FROM file_versions").get().n, 2);
    assert.equal(JSON.stringify(snapshot.prepare("SELECT * FROM file_versions ORDER BY id").all()), JSON.stringify(sourceVersions));
  } finally { snapshot.close(); }
  await assert.rejects(() => backup.restoreBackupToNewDataDirectory(created.directory, target), /already exists/);

  let rejectedCases = 0;
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  async function rejectBackup(name, change) {
    const source = path.join(temporaryRoot, `bad-${name}`);
    await cp(created.directory, source, { recursive: true });
    const manifest = structuredClone(originalManifest);
    await change(source, manifest);
    await writeFile(path.join(source, "manifest.json"), JSON.stringify(manifest));
    let valid = false;
    try { valid = await backup.verifyBackup(source); } catch { /* malformed backups also fail closed */ }
    assert.equal(valid, false, `${name}: an inconsistent backup must not verify`);
    const rejected = path.join(temporaryRoot, `rejected-${name}`);
    await assert.rejects(() => backup.restoreBackupToNewDataDirectory(source, rejected), `${name}: restore must reject`);
    await assert.rejects(() => access(rejected), `${name}: no formal restore directory`);
    assert.equal((await readdir(temporaryRoot)).some(entry => entry.startsWith(`.rejected-${name}.`)), false, `${name}: staging is cleaned`);
    rejectedCases++;
  }
  await rejectBackup("omitted-all", async (_source, manifest) => { manifest.blobs = []; });
  await rejectBackup("omitted-history", async (_source, manifest) => { manifest.blobs = manifest.blobs.filter(blob => blob.storage_key !== asset.storageKey); });
  await rejectBackup("duplicate", async (_source, manifest) => { manifest.blobs.push(manifest.blobs[0]); });
  await rejectBackup("wrong-size", async (_source, manifest) => { manifest.blobs[0].byte_size++; });
  await rejectBackup("extra-listed", async (source, manifest) => {
    const bytes = Buffer.from("unreferenced blob"); const sha = hash(bytes);
    manifest.blobs.push({ storage_key: sha, sha256: sha, byte_size: bytes.length });
    await writeFile(path.join(source, "files", sha), bytes);
  });
  await rejectBackup("extra-disk", async source => { await writeFile(path.join(source, "files", hash("extra")), "extra"); });
  await rejectBackup("missing-file", async source => { await rm(path.join(source, "files", asset.storageKey)); });
  await rejectBackup("corrupt-file", async source => { await writeFile(path.join(source, "files", asset.storageKey), "corrupt bytes"); });
  await rejectBackup("missing-marker", async source => { await rm(path.join(source, "complete")); });
  await rejectBackup("migration-mismatch", async (_source, manifest) => { manifest.migrations[0].checksum = "0".repeat(64); });
  await rejectBackup("missing-migrations", async (_source, manifest) => { delete manifest.migrations; });
  await rejectBackup("database-reference", async source => {
    const changed = new DatabaseSync(path.join(source, "app.sqlite"));
    try { changed.exec("PRAGMA journal_mode = DELETE"); changed.prepare("UPDATE file_blobs SET byte_size = byte_size + 1 WHERE storage_key = ?").run(asset.storageKey); }
    finally { changed.close(); }
  });

  // Inject real IO failures/changes after source validation, without production test hooks.
  const originalCopyFile = fsPromises.copyFile;
  for (const failure of ["copy-failure", "changed-target-file", "changed-target-database", "changed-source-manifest", "changed-source-database", "changed-source-file", "extra-target-file", "target-wal-change", "source-wal-change"]) {
    const source = path.join(temporaryRoot, `race-${failure}`); await cp(created.directory, source, { recursive: true });
    if (["target-wal-change", "source-wal-change"].includes(failure)) {
      const walBackup = new DatabaseSync(path.join(source, "app.sqlite"));
      try { walBackup.exec("PRAGMA journal_mode = WAL; PRAGMA wal_checkpoint(TRUNCATE)"); }
      finally { walBackup.close(); }
    }
    const rejected = path.join(temporaryRoot, `rejected-${failure}`);
    let walWriter;
    fsPromises.copyFile = async (from, to, ...args) => {
      if (failure === "copy-failure" && path.basename(from) !== "app.sqlite") throw new Error("injected_copy_failure");
      await originalCopyFile(from, to, ...args);
      if (failure === "changed-target-file" && path.basename(from) !== "app.sqlite") await writeFile(to, "damaged copy");
      if (failure === "extra-target-file" && path.basename(from) !== "app.sqlite") await writeFile(path.join(path.dirname(to), "unexpected"), "extra");
      if (failure === "changed-target-database" && path.basename(from) === "app.sqlite") {
        const altered = new DatabaseSync(to);
        try { altered.exec("PRAGMA journal_mode = DELETE"); altered.prepare("INSERT INTO app_settings VALUES (?, ?, ?)").run("injected", "changed", new Date().toISOString()); }
        finally { altered.close(); }
      }
      if (failure === "changed-source-manifest" && path.basename(from) === "app.sqlite") {
        const altered = structuredClone(originalManifest); altered.blobs = [];
        await writeFile(path.join(source, "manifest.json"), JSON.stringify(altered));
      }
      if (failure === "changed-source-database" && path.basename(from) === "app.sqlite") {
        const altered = new DatabaseSync(from);
        try { altered.exec("PRAGMA journal_mode = DELETE"); altered.prepare("INSERT INTO app_settings VALUES (?, ?, ?)").run("injected", "changed", new Date().toISOString()); }
        finally { altered.close(); }
      }
      if (failure === "changed-source-file" && path.basename(from) !== "app.sqlite") await writeFile(from, "changed source");
      if (["target-wal-change", "source-wal-change"].includes(failure) && path.basename(from) === "app.sqlite") {
        const writable = failure === "target-wal-change" ? path.join(temporaryRoot, "live-wal.sqlite") : from;
        if (failure === "target-wal-change") await originalCopyFile(from, writable);
        walWriter = new DatabaseSync(writable);
        walWriter.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
        walWriter.prepare("INSERT INTO app_settings VALUES (?, ?, ?)").run("wal-injected", "changed", new Date().toISOString());
        if (failure === "target-wal-change") await originalCopyFile(`${writable}-wal`, `${to}-wal`);
      }
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(() => backup.restoreBackupToNewDataDirectory(source, rejected));
      await assert.rejects(() => access(rejected));
      assert.equal((await readdir(temporaryRoot)).some(entry => entry.startsWith(`.rejected-${failure}.`)), false);
    } finally { walWriter?.close(); fsPromises.copyFile = originalCopyFile; syncBuiltinESMExports(); }
  }
  await writeFile(path.join(created.directory, "files", asset.storageKey), "corrupt");
  assert.equal(await backup.verifyBackup(created.directory), false);
  await assert.rejects(() => backup.restoreBackupToNewDataDirectory(created.directory, path.join(temporaryRoot, "rejected")), /verification failed/);
  assert.deepEqual(databaseModule.all("SELECT * FROM file_versions ORDER BY id"), sourceVersions);
  assert.equal(databaseModule.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(databaseModule.all("PRAGMA foreign_key_check"), []);
  console.log(`Backup restore test passed: current/historical versions, ${rejectedCases} inconsistent backups, copy failure/corruption/SQLite change, pinned manifest and no incomplete published target.`);
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
