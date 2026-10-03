import assert from "node:assert/strict";
import { File } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-faults-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let databaseModule;
try {
  databaseModule = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  databaseModule.db();
  const wrongTargetBytes = Buffer.from("wrong existing destination");
  const incoming = Buffer.from("incoming bytes");
  const key = createHash("sha256").update(incoming).digest("hex");
  await writeFile(path.join(temporaryRoot, "files", key), wrongTargetBytes);
  const before = Number(databaseModule.one("SELECT COUNT(*) AS count FROM content_items").count);
  await assert.rejects(() => inbox.createFileContentItem(new File([incoming], "collision.bin", { type: "application/octet-stream" })), (error) => error?.code === "integrity_error");
  assert.equal(Number(databaseModule.one("SELECT COUNT(*) AS count FROM content_items").count), before);
  assert.deepEqual(await readFile(path.join(temporaryRoot, "files", key)), wrongTargetBytes, "unknown pre-existing bytes are never deleted on a failed publish");

  const external = path.join(temporaryRoot, "outside.part");
  await writeFile(external, "must survive");
  const timestamp = new Date().toISOString();
  databaseModule.run("INSERT INTO file_write_operations (id, operation_type, state, staged_path, created_at, updated_at) VALUES (?, 'upload', 'staged', ?, ?, ?)", "fault-operation", external, timestamp, timestamp);
  assert.equal(await inbox.reconcilePendingFileWrites(), 1);
  assert.equal(await readFile(external, "utf8"), "must survive", "journal reconciliation cannot delete outside the managed staging directory");
  assert.equal(databaseModule.one("SELECT state FROM file_write_operations WHERE id = ?", "fault-operation").state, "reconciled");
  assert.equal(databaseModule.db().prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(databaseModule.db().prepare("PRAGMA foreign_key_check").all(), []);
  console.log("Fault injection test passed: corrupt publish destination and hostile journal path preserve DB and external files.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
