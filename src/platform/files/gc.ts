import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { all, one, run, transaction } from "@/platform/db/database";
import { filesDirectory } from "@/platform/db/database";
import { isBlobGcBlocked } from "@/platform/files/maintenance";
import { managedFilePath } from "@/platform/files/service";
import { withDataWriterLease } from "@/platform/files/writer-lease";
import { now } from "@/platform/shared/ids";

export const blobGcGraceMs = 24 * 60 * 60 * 1000;

type QueueRow = { blob_id: string; storage_key: string; attempt_count: number };

export function enqueueUnreferencedBlobs(referenceTime = new Date()) {
  const timestamp = referenceTime.toISOString();
  const notBefore = new Date(referenceTime.getTime() + blobGcGraceMs).toISOString();
  run(
    `INSERT OR IGNORE INTO blob_gc_queue (blob_id, not_before, attempt_count, next_attempt_at, created_at)
     SELECT fb.id, ?, 0, ?, ?
       FROM file_blobs fb
      WHERE NOT EXISTS (SELECT 1 FROM file_versions fv WHERE fv.blob_id = fb.id)`,
    notBefore, notBefore, timestamp,
  );
}

export async function runBlobMaintenance(limit = 25) {
  if (isBlobGcBlocked()) return { deleted: 0, retried: 0, orphanFilesDeleted: 0, blocked: true };
  return withDataWriterLease(async () => {
    if (isBlobGcBlocked()) return { deleted: 0, retried: 0, orphanFilesDeleted: 0, blocked: true };
    enqueueUnreferencedBlobs();
    const due = all<QueueRow>(
      `SELECT q.blob_id, fb.storage_key, q.attempt_count
         FROM blob_gc_queue q JOIN file_blobs fb ON fb.id = q.blob_id
        WHERE q.not_before <= ? AND q.next_attempt_at <= ?
        ORDER BY q.next_attempt_at, q.created_at LIMIT ?`,
      now(), now(), Math.max(1, Math.min(limit, 100)),
    );
    let deleted = 0;
    let retried = 0;
    for (const candidate of due) {
      if (one("SELECT 1 FROM file_versions WHERE blob_id = ? LIMIT 1", candidate.blob_id)) {
        run("DELETE FROM blob_gc_queue WHERE blob_id = ?", candidate.blob_id);
        continue;
      }
      try {
        await unlink(managedFilePath(candidate.storage_key)).catch((error) => {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        });
        transaction(() => {
          if (one("SELECT 1 FROM file_versions WHERE blob_id = ? LIMIT 1", candidate.blob_id)) throw new Error("Blob became reachable during garbage collection.");
          run("DELETE FROM file_blobs WHERE id = ?", candidate.blob_id);
        });
        deleted += 1;
      } catch (error) {
        const attempts = candidate.attempt_count + 1;
        const backoffMs = Math.min(24 * 60 * 60 * 1000, 60_000 * (2 ** Math.min(attempts, 10)));
        run(
          "UPDATE blob_gc_queue SET attempt_count = ?, next_attempt_at = ?, last_error = ? WHERE blob_id = ?",
          attempts, new Date(Date.now() + backoffMs).toISOString(), error instanceof Error ? error.message.slice(0, 500) : "unlink_failed", candidate.blob_id,
        );
        retried += 1;
      }
    }
    const orphanFilesDeleted = await removeAgedFilesystemOrphans(Math.max(1, Math.min(limit, 100)));
    return { deleted, retried, orphanFilesDeleted, blocked: false };
  });
}

async function removeAgedFilesystemOrphans(limit: number) {
  const entries = await readdir(filesDirectory, { withFileTypes: true }).catch(() => []);
  let deleted = 0;
  for (const entry of entries) {
    if (deleted >= limit || !entry.isFile() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    if (one("SELECT 1 FROM file_blobs WHERE storage_key = ?", entry.name)) continue;
    const candidate = path.join(filesDirectory, entry.name);
    const details = await stat(candidate).catch(() => null);
    if (!details || Date.now() - details.mtimeMs < blobGcGraceMs) continue;
    await unlink(candidate).then(() => { deleted += 1; }).catch(() => undefined);
  }
  return deleted;
}
