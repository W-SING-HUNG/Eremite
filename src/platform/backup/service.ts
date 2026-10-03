import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { backupsDirectory, db } from "@/platform/db/database";
import { copyManagedFile, inspectManagedFile } from "@/platform/files/service";
import { withBlobGcBlocked } from "@/platform/files/maintenance";
import { withDataWriterLease } from "@/platform/files/writer-lease";
import { uuidv7 } from "@/platform/shared/ids";

type BlobRow = { storage_key: string; sha256: string; byte_size: number };
type MigrationRow = { version: string; checksum: string };

export async function createBackup() {
  return withDataWriterLease(() => withBlobGcBlocked(async () => {
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const incompleteDirectory = path.join(backupsDirectory, `.${stamp}.incomplete`);
    const directory = path.join(backupsDirectory, stamp);
    const filesTarget = path.join(incompleteDirectory, "files");
    const databaseTarget = path.join(incompleteDirectory, "app.sqlite");
    await mkdir(filesTarget, { recursive: true });
    try {
      await backup(db(), databaseTarget);
      const snapshot = new DatabaseSync(databaseTarget, { readOnly: true });
      let blobs: BlobRow[];
      let migrations: MigrationRow[];
      try {
        assertSnapshotIntegrity(snapshot);
        blobs = snapshot.prepare(
          `SELECT DISTINCT fb.storage_key, fb.sha256, fb.byte_size
             FROM file_versions fv
             JOIN file_blobs fb ON fb.id = fv.blob_id
            ORDER BY fb.storage_key`,
        ).all() as BlobRow[];
        migrations = snapshot.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version").all() as MigrationRow[];
      } finally {
        snapshot.close();
      }
      for (const blob of blobs) {
        const integrity = await inspectManagedFile(blob.storage_key, blob.byte_size, blob.sha256);
        if (integrity.status !== "ready") throw new Error(`Backup source failed verification: ${blob.storage_key}`);
        await copyManagedFile(blob.storage_key, filesTarget);
      }
      for (const blob of blobs) {
        const copiedHash = await hashFile(path.join(filesTarget, blob.storage_key));
        if (copiedHash !== blob.sha256) throw new Error(`Backup copy failed verification: ${blob.storage_key}`);
      }
      const manifest = {
        formatVersion: 2,
        appVersion: "1.3.0",
        createdAt: new Date().toISOString(),
        database: "app.sqlite",
        migrations,
        blobs,
      };
      await writeFile(path.join(incompleteDirectory, "manifest.json"), JSON.stringify(manifest, null, 2));
      await writeFile(path.join(incompleteDirectory, "complete"), "ok\n");
      await rename(incompleteDirectory, directory);
      return { directory, fileCount: blobs.length };
    } catch (error) {
      await rm(incompleteDirectory, { recursive: true, force: true });
      throw error;
    }
  }));
}

export async function verifyCurrentFiles() {
  const blobs = db().prepare(
    `SELECT DISTINCT fb.storage_key, fb.sha256, fb.byte_size
       FROM file_versions fv JOIN file_blobs fb ON fb.id = fv.blob_id`,
  ).all() as BlobRow[];
  const problems: string[] = [];
  for (const blob of blobs) {
    const integrity = await inspectManagedFile(blob.storage_key, blob.byte_size, blob.sha256);
    if (integrity.status !== "ready") problems.push(blob.storage_key);
  }
  return problems;
}

export async function verifyBackup(directory: string) {
  const manifest = await readManifest(directory);
  if ((await readFile(path.join(directory, "complete"), "utf8")).trim() !== "ok") throw new Error("Backup is incomplete.");
  const snapshot = new DatabaseSync(path.join(directory, manifest.database), { readOnly: true });
  try { assertSnapshotIntegrity(snapshot); }
  finally { snapshot.close(); }
  for (const blob of manifest.blobs) {
    assertBlobManifestEntry(blob);
    const candidate = path.join(directory, "files", blob.storage_key);
    if ((await stat(candidate).catch(() => null))?.size !== blob.byte_size || await hashFile(candidate).catch(() => "") !== blob.sha256) return false;
  }
  return true;
}

/** Restore is deliberately offline-only and never overwrites an existing data directory. */
export async function restoreBackupToNewDataDirectory(directory: string, targetDataDirectory: string) {
  const source = path.resolve(directory);
  const target = path.resolve(targetDataDirectory);
  if (source === target || isInside(source, target) || isInside(target, source)) throw new Error("Backup and restore target must be separate directories.");
  if (await stat(target).then(() => true).catch(() => false)) throw new Error("Restore target already exists.");
  if (!await verifyBackup(source)) throw new Error("Backup verification failed.");
  const manifest = await readManifest(source);
  const parent = path.dirname(target);
  const incomplete = path.join(parent, `.${path.basename(target)}.${uuidv7()}.restore-incomplete`);
  await mkdir(path.join(incomplete, "files"), { recursive: true });
  try {
    await copyFile(path.join(source, manifest.database), path.join(incomplete, "app.sqlite"));
    for (const blob of manifest.blobs) {
      assertBlobManifestEntry(blob);
      await copyFile(path.join(source, "files", blob.storage_key), path.join(incomplete, "files", blob.storage_key));
    }
    const restored = new DatabaseSync(path.join(incomplete, "app.sqlite"), { readOnly: true });
    try { assertSnapshotIntegrity(restored); } finally { restored.close(); }
    for (const blob of manifest.blobs) {
      if (await hashFile(path.join(incomplete, "files", blob.storage_key)) !== blob.sha256) throw new Error(`Restored blob verification failed: ${blob.storage_key}`);
    }
    await writeFile(path.join(incomplete, "restored-from.json"), JSON.stringify({ source, restoredAt: new Date().toISOString(), formatVersion: manifest.formatVersion }, null, 2));
    await rename(incomplete, target);
    return { directory: target, fileCount: manifest.blobs.length };
  } catch (error) {
    await rm(incomplete, { recursive: true, force: true });
    throw error;
  }
}

async function readManifest(directory: string) {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as {
    formatVersion?: number; database?: string; blobs?: BlobRow[];
  };
  if (manifest.formatVersion !== 2 || manifest.database !== "app.sqlite" || !Array.isArray(manifest.blobs)) throw new Error("Unsupported backup manifest.");
  return manifest as { formatVersion: 2; database: "app.sqlite"; blobs: BlobRow[] };
}

function assertBlobManifestEntry(blob: BlobRow) {
  if (!/^[a-f0-9]{64}$/.test(blob.storage_key) || blob.storage_key !== blob.sha256 || !Number.isSafeInteger(blob.byte_size) || blob.byte_size < 0) throw new Error("Unsafe backup blob manifest entry.");
}

function isInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertSnapshotIntegrity(snapshot: DatabaseSync) {
  const integrity = snapshot.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  if (integrity.integrity_check !== "ok") throw new Error("Backup database integrity check failed.");
  if (snapshot.prepare("PRAGMA foreign_key_check").all().length > 0) throw new Error("Backup database foreign-key check failed.");
}

async function hashFile(filename: string) {
  const handle = await open(filename, "r");
  const hash = createHash("sha256");
  try { for await (const chunk of handle.createReadStream()) hash.update(chunk); }
  finally { await handle.close(); }
  return hash.digest("hex");
}
