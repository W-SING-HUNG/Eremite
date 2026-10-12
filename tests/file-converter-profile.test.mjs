import assert from "node:assert/strict";
import { File } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const root = await mkdtemp(path.join(tmpdir(), "eremite-profile-"));
process.env.EREMITE_DATA_DIR = path.join(root, "data");
let database;
try {
  database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const automations = await import("@/modules/automations/service");
  const { withFileConverterOutput } = await import("@/modules/automations/tools/file-converter/host-adapter");
  const { acceptedFileConversions, getAcceptedFileConversion, fileConverterCanonicalContract } = await import("@/modules/automations/tools/file-converter/authority");
  const { policyFingerprint } = await import("@/modules/automations/tools/retry-snapshot");
  const { managedFilePath } = await import("@/platform/files/service");
  const { uuidv7 } = await import("@/platform/shared/ids");
  const pixels = Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) => (i * 73 + Math.floor(i / 19) * 29) % 256));
  const png = await sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
  const id = await inbox.createFileContentItem(new File([png], "profile.png", { type: "image/png" }));
  const source = inbox.getFileAssetForViewing(id);
  const originalVersions = database.all("SELECT * FROM file_versions ORDER BY id");
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  const input = { contentItemId: id, conversionId: "png-to-webp" };
  for (const profile of ["high_quality", "lossless"]) {
    await assert.rejects(() => automations.executeExternalTool({ operationId: uuidv7(), toolId: "core.file-converter", rawInput: { ...input, profile } }), error => error.code === "input_unavailable");
    await assert.rejects(() => withFileConverterOutput({ invocationId: uuidv7(), sourcePath: managedFilePath(source.storageKey), displayName: source.originalName, declaredMediaType: source.declaredMimeType, expectedSize: source.byteSize, expectedSha256: source.sha256, sourceFormat: "png", conversionId: "png-to-webp", profile }, () => { throw new Error("Non-default profile must never execute"); }), error => error.code === "host_profile_not_accepted");
  }
  assert.equal(database.one("SELECT COUNT(*) n FROM automation_runs").n, 0);
  assert.deepEqual(database.all("SELECT * FROM file_versions ORDER BY id"), originalVersions);
  const outputs = [];
  for (const profile of [undefined, "balanced"]) {
    const result = await automations.executeExternalTool({ operationId: uuidv7(), toolId: "core.file-converter", rawInput: { ...input, ...(profile ? { profile } : {}) } });
    assert.equal(result.status, "completed");
    const run = automations.getAutomationRun(result.runId);
    assert.equal(JSON.parse(run.input_payload_json).profile, "balanced");
    const output = JSON.parse(run.output_payload_json);
    const bytes = await readFile(managedFilePath(inbox.getFileAssetForViewing(output.contentId).storageKey));
    assert.equal((await sharp(bytes).metadata()).format, "webp");
    assert.equal(digest(bytes), output.sha256);
    assert.equal(database.one("SELECT state FROM file_write_operations WHERE idempotency_key = ?", `automation:${result.runId}:output:0`).state, "committed");
    outputs.push(output.sha256);
  }
  assert.equal(outputs[0], outputs[1], "omitted and explicit default have the same real engine behavior");
  for (const conversion of acceptedFileConversions) assert.deepEqual(conversion.profiles, [conversion.defaultProfile]);

  // Seed isolated historical snapshots; production history is never rewritten.
  const brokenId = await inbox.createFileContentItem(new File([Buffer.from("broken image")], "broken.png", { type: "image/png" }));
  for (const legacy of ["non-default", "old-default-policy"]) {
    const failed = await automations.executeExternalTool({ operationId: uuidv7(), toolId: "core.file-converter", rawInput: { contentItemId: brokenId, conversionId: "png-to-webp" } });
    assert.equal(failed.status, "failed");
    const parent = database.one("SELECT * FROM automation_runs WHERE id = ?", failed.runId);
    const payload = JSON.parse(parent.input_payload_json);
    if (legacy === "non-default") payload.profile = "lossless";
    payload.retryEvidence.policy = policyFingerprint({ capability: { ...getAcceptedFileConversion("png-to-webp"), profiles: ["balanced", "high_quality", "lossless"] }, contract: fileConverterCanonicalContract, limits: { maxInputBytes: 512 * 1024 * 1024, maxOutputBytes: 512 * 1024 * 1024, maxWorkspaceBytes: 1024 * 1024 * 1024, timeoutMs: 60_000 } });
    const historicalId = uuidv7();
    const historical = { ...parent, id: historicalId, operation_id: uuidv7(), input_payload_json: JSON.stringify(payload) };
    const columns = Object.keys(historical);
    database.run(`INSERT INTO automation_runs (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`, ...Object.values(historical));
    for (const snapshot of database.all("SELECT * FROM automation_run_inputs WHERE run_id = ?", failed.runId)) {
      const seeded = { ...snapshot, run_id: historicalId }; const keys = Object.keys(seeded);
      database.run(`INSERT INTO automation_run_inputs (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...Object.values(seeded));
    }
    const before = database.one("SELECT * FROM automation_runs WHERE id = ?", historicalId);
    await assert.rejects(() => automations.retryExternalTool(historicalId), error => ["retry_snapshot_incomplete", "retry_stale_tool"].includes(error.code));
    assert.deepEqual(database.one("SELECT * FROM automation_runs WHERE id = ?", historicalId), before);
    assert.equal(database.one("SELECT COUNT(*) n FROM automation_runs WHERE retry_of_run_id = ?", historicalId).n, 0);
    assert.equal(database.one("SELECT COUNT(*) n FROM file_write_operations WHERE idempotency_key LIKE ?", `automation:${historicalId}:output:%`).n, 0);
  }
  assert.equal(digest(await readFile(managedFilePath(source.storageKey))), digest(png));
  assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
  console.log("Profile gate passed: non-default rejected before Run/engine/write, real default WebP/receipts, immutable history and strict legacy Retry policy.");
} finally { database?.db().close(); await rm(root, { recursive: true, force: true }); }
