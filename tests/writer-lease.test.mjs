import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-lease-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
try {
  const lease = await import("@/platform/files/writer-lease");
  const events = [];
  await Promise.all([
    lease.withDataWriterLease(async () => { events.push("first:start"); await new Promise((resolve) => setTimeout(resolve, 150)); events.push("first:end"); }),
    lease.withDataWriterLease(async () => { events.push("second:start"); events.push("second:end"); }),
  ]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
  console.log("Writer lease test passed: concurrent callers serialize without weakening the single-writer boundary.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
