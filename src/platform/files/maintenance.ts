let blobGcBlockCount = 0;
let lastScheduledMaintenanceAt = 0;

export function isBlobGcBlocked() {
  return blobGcBlockCount > 0;
}

export async function runScheduledFileMaintenance() {
  if (Date.now() - lastScheduledMaintenanceAt < 60 * 60 * 1000) return { skipped: true };
  lastScheduledMaintenanceAt = Date.now();
  try {
    const [{ reconcilePendingFileWrites }, { runBlobMaintenance }, { withDataWriterLease }] = await Promise.all([
      import("@/modules/inbox/service"), import("@/platform/files/gc"), import("@/platform/files/writer-lease"),
    ]);
    const reconciled = await withDataWriterLease(() => reconcilePendingFileWrites(25));
    const gc = await runBlobMaintenance(25);
    return { skipped: false, reconciled, gc };
  } catch (error) {
    lastScheduledMaintenanceAt = 0;
    throw error;
  }
}

export async function withBlobGcBlocked<T>(work: () => Promise<T>) {
  blobGcBlockCount += 1;
  try {
    return await work();
  } finally {
    blobGcBlockCount -= 1;
  }
}
