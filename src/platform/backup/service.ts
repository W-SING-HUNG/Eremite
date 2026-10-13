import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { backupsDirectory, db } from "@/platform/db/database";
import { copyManagedFile, inspectManagedFile } from "@/platform/files/service";
import { withBlobGcBlocked } from "@/platform/files/maintenance";
import { withDataWriterLease } from "@/platform/files/writer-lease";
import { uuidv7 } from "@/platform/shared/ids";

type BlobRow = { storage_key: string; sha256: string; byte_size: number };
type MigrationRow = { version: string; checksum: string };
type BackupManifest = { formatVersion: 2; database: "app.sqlite"; blobs: BlobRow[]; migrations: MigrationRow[] };

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
      if (!await readVerifiedBackup(incompleteDirectory)) throw new Error("Backup verification failed.");
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
  return Boolean(await readVerifiedBackup(directory));
}

/** Restore is deliberately offline-only and never overwrites an existing data directory. */
export async function restoreBackupToNewDataDirectory(directory: string, targetDataDirectory: string) {
  const source = path.resolve(directory);
  const target = path.resolve(targetDataDirectory);
  if (source === target || isInside(source, target) || isInside(target, source)) throw new Error("Backup and restore target must be separate directories.");
  if (await pathExists(target)) throw new Error("Restore target already exists.");
  const verified = await readVerifiedBackup(source);
  if (!verified) throw new Error("Backup verification failed.");
  const { manifest, manifestText, databaseSha256 } = verified;
  const parent = path.dirname(target);
  const incomplete = path.join(parent, `.${path.basename(target)}.${uuidv7()}.restore-incomplete`);
  try {
    await mkdir(path.join(incomplete, "files"), { recursive: true });
    await copyFile(path.join(source, manifest.database), path.join(incomplete, "app.sqlite"));
    for (const blob of manifest.blobs) {
      assertBlobManifestEntry(blob);
      await copyFile(path.join(source, "files", blob.storage_key), path.join(incomplete, "files", blob.storage_key));
    }
    if (await hasUncopiedWal(path.join(incomplete, "app.sqlite"))
      || !snapshotMatchesManifest(path.join(incomplete, "app.sqlite"), manifest)
      || await hashFile(path.join(incomplete, "app.sqlite")) !== databaseSha256
      || !await filesMatchManifest(incomplete, manifest)) throw new Error("Restored backup verification failed.");
    // The source must stay unchanged during copying. Never trust a second, different manifest.
    if (await hasUncopiedWal(path.join(source, "app.sqlite"))
      || await readFile(path.join(source, "manifest.json"), "utf8") !== manifestText
      || await hashFile(path.join(source, "app.sqlite")) !== databaseSha256
      || (await readFile(path.join(source, "complete"), "utf8")).trim() !== "ok"
      || !await filesMatchManifest(source, manifest)) throw new Error("Backup changed during restore.");
    await writeFile(path.join(incomplete, "restored-from.json"), JSON.stringify({ source, restoredAt: new Date().toISOString(), formatVersion: manifest.formatVersion }, null, 2));
    if (await pathExists(target)) throw new Error("Restore target already exists.");
    await rename(incomplete, target);
    return { directory: target, fileCount: manifest.blobs.length };
  } catch (error) {
    await rm(incomplete, { recursive: true, force: true });
    throw error;
  }
}

async function readVerifiedBackup(directory: string) {
  for (const name of ["manifest.json", "complete", "app.sqlite"]) {
    // Backup directories are runtime data, never application source to bundle.
    const info = await lstat(path.join(/* turbopackIgnore: true */ directory, name));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe backup file.");
  }
  const manifestText = await readFile(path.join(directory, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as BackupManifest | null;
  if (!manifest || manifest.formatVersion !== 2 || manifest.database !== "app.sqlite"
    || !Array.isArray(manifest.blobs) || !Array.isArray(manifest.migrations)) throw new Error("Unsupported backup manifest.");
  for (const blob of manifest.blobs) assertBlobManifestEntry(blob);
  for (const migration of manifest.migrations) {
    if (!migration || typeof migration.version !== "string" || !migration.version
      || typeof migration.checksum !== "string" || !/^[a-f0-9]{64}$/u.test(migration.checksum)) throw new Error("Unsafe backup migration manifest entry.");
  }
  if ((await readFile(path.join(directory, "complete"), "utf8")).trim() !== "ok") throw new Error("Backup is incomplete.");
  const databasePath = path.join(directory, manifest.database);
  // An offline backup must not depend on un-copied WAL transactions.
  if (await hasUncopiedWal(databasePath)) return null;
  const databaseSha256 = await hashFile(databasePath);
  if (!snapshotMatchesManifest(databasePath, manifest) || !await filesMatchManifest(directory, manifest)) return null;
  if (await hasUncopiedWal(databasePath) || await hashFile(databasePath) !== databaseSha256
    || await readFile(path.join(directory, "manifest.json"), "utf8") !== manifestText) return null;
  return { manifest, manifestText, databaseSha256 };
}

async function hasUncopiedWal(databasePath: string) {
  try { return (await lstat(`${databasePath}-wal`)).size > 0; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; }
}

function snapshotMatchesManifest(databasePath: string, manifest: BackupManifest) {
  const snapshot = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assertSnapshotIntegrity(snapshot);
    const referenced = snapshot.prepare(`SELECT DISTINCT fb.storage_key, fb.sha256, fb.byte_size
      FROM file_versions fv JOIN file_blobs fb ON fb.id = fv.blob_id ORDER BY fb.storage_key`).all() as BlobRow[];
    const migrations = snapshot.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version").all() as MigrationRow[];
    const listed = manifest.blobs.map(({ storage_key, sha256, byte_size }) => ({ storage_key, sha256, byte_size })).sort((a, b) => a.storage_key.localeCompare(b.storage_key));
    const listedMigrations = manifest.migrations.map(({ version, checksum }) => ({ version, checksum })).sort((a, b) => a.version.localeCompare(b.version));
    return JSON.stringify(referenced) === JSON.stringify(listed) && JSON.stringify(migrations) === JSON.stringify(listedMigrations);
  } finally { snapshot.close(); }
}

async function filesMatchManifest(directory: string, manifest: BackupManifest) {
  const files = path.join(directory, "files");
  const info = await lstat(files).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) return false;
  const entries = await readdir(files);
  const expected = manifest.blobs.map(blob => blob.storage_key).sort();
  if (JSON.stringify(entries.sort()) !== JSON.stringify(expected)) return false;
  for (const blob of manifest.blobs) {
    const candidate = path.join(files, blob.storage_key);
    const details = await lstat(candidate).catch(() => null);
    if (!details?.isFile() || details.isSymbolicLink() || details.size !== blob.byte_size
      || await hashFile(candidate).catch(() => "") !== blob.sha256) return false;
  }
  return true;
}

async function pathExists(candidate: string) {
  try { await lstat(candidate); return true; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; }
}

function assertBlobManifestEntry(blob: BlobRow) {
  if (!blob || typeof blob.storage_key !== "string" || !/^[a-f0-9]{64}$/.test(blob.storage_key) || blob.storage_key !== blob.sha256 || !Number.isSafeInteger(blob.byte_size) || blob.byte_size < 0) throw new Error("Unsafe backup blob manifest entry.");
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
