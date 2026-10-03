const inbox = await import("@/modules/inbox/service");
const gc = await import("@/platform/files/gc");
const database = await import("@/platform/db/database");
const lease = await import("@/platform/files/writer-lease");
try {
  const reconciled = await lease.withDataWriterLease(() => inbox.reconcilePendingFileWrites(100));
  const result = await gc.runBlobMaintenance(100);
  console.log(JSON.stringify({ reconciled, ...result }, null, 2));
} finally {
  database.db().close();
}
