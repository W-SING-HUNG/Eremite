import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { maximumFileUploadBytes } from "@/modules/inbox/upload-contract";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-upload-near-limit-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let databaseModule;
try {
  const inbox = await import("@/modules/inbox/service");
  databaseModule = await import("@/platform/db/database");
  const byteSize = maximumFileUploadBytes - 1024 * 1024;
  const chunk = Buffer.alloc(1024 * 1024, 0x5a);
  const body = new ReadableStream({
    pull(controller) {
      const remaining = byteSize - (this.sent ?? 0);
      if (remaining <= 0) { controller.close(); return; }
      const next = remaining >= chunk.length ? chunk : chunk.subarray(0, remaining);
      controller.enqueue(next);
      this.sent = (this.sent ?? 0) + next.length;
    },
  });
  const contentId = await inbox.createFileContentItemFromStream({ body, originalName: "near-limit.bin", mimeType: "application/octet-stream", expectedSize: byteSize });
  const asset = inbox.getFileAssetForViewing(contentId);
  assert.equal(asset.byteSize, byteSize);
  assert.equal((await stat(path.join(temporaryRoot, "files", asset.storageKey))).size, byteSize);
  const file = await open(path.join(temporaryRoot, "files", asset.storageKey), "r");
  const hash = createHash("sha256");
  try { for await (const bytes of file.createReadStream()) hash.update(bytes); }
  finally { await file.close(); }
  assert.equal(hash.digest("hex"), asset.sha256);
  console.log(`Near-limit upload test passed: ${byteSize} bytes streamed, stored and SHA-256 verified.`);
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
