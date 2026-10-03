import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { File } from "node:buffer";
import { makeDocxFixture, makeOversizedPngHeader, makePdfFixture } from "./viewer-fixtures.mjs";
import { maximumFileUploadBytes } from "@/modules/inbox/upload-contract";

const repositoryRoot = process.cwd();
const temporaryDataDirectory = await mkdtemp(path.join(tmpdir(), "eremite-viewer-http-"));
process.env.EREMITE_DATA_DIR = temporaryDataDirectory;

let server;
let databaseModule;
try {
  const inbox = await import("@/modules/inbox/service");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  databaseModule = await import("@/platform/db/database");

  const pdfId = await inbox.createFileContentItem(new File([makePdfFixture("HTTP range fixture")], "中文-range.pdf", { type: "application/pdf" }));
  const projectId = projects.createProject({ name: "HTTP Project", description: "Folder route smoke" });
  const rootFolderId = folders.createFolder({ projectId, name: "Root" });
  const deepFolderId = folders.createFolder({ projectId, parentId: rootFolderId, name: "Deep" });
  inbox.moveContentItems({ ids: [{ id: pdfId, expectedRevision: inbox.getContentItemSummary(pdfId).revision }], projectId, folderId: deepFolderId });
  const unsupportedId = await inbox.createFileContentItem(new File([Buffer.from("MZ-not-an-executable")], "sample.exe", { type: "application/vnd.microsoft.portable-executable" }));
  const tooLargeId = await inbox.createFileContentItem(new File([makeOversizedPngHeader()], "unsafe-dimensions.png", { type: "image/png" }));

  const malformedDocx = await makeDocxFixture("Malformed DOCX");
  const corruptedId = await inbox.createFileContentItem(new File([malformedDocx.subarray(0, malformedDocx.length - 24)], "malformed.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));

  const missingId = await inbox.createFileContentItem(new File([Buffer.from("missing-original")], "missing.txt", { type: "text/plain" }));
  const missingAsset = inbox.getFileAssetForViewing(missingId);
  await unlink(path.join(temporaryDataDirectory, "files", missingAsset.storageKey));

  const integrityId = await inbox.createFileContentItem(new File([Buffer.from("original-integrity")], "integrity.txt", { type: "text/plain" }));
  const integrityAsset = inbox.getFileAssetForViewing(integrityId);
  await writeFile(path.join(temporaryDataDirectory, "files", integrityAsset.storageKey), "changed-integrity!");

  const loadFailedId = await inbox.createFileContentItem(new File([Buffer.from("temporary read failure")], "load-failed.txt", { type: "text/plain" }));
  const loadFailedAsset = inbox.getFileAssetForViewing(loadFailedId);
  const loadFailedPath = path.join(temporaryDataDirectory, "files", loadFailedAsset.storageKey);
  await unlink(loadFailedPath);
  await mkdir(loadFailedPath);

  const sessionId = randomUUID();
  databaseModule.db().prepare("INSERT INTO sessions (id, expires_at, created_at) VALUES (?, ?, ?)").run(sessionId, new Date(Date.now() + 60_000).toISOString(), new Date().toISOString());
  databaseModule.db().close();
  databaseModule = undefined;

  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const requireFromProject = createRequire(path.join(repositoryRoot, "package.json"));
  const nextBinary = requireFromProject.resolve("next/dist/bin/next");
  const output = [];
  server = spawn(process.execPath, [nextBinary, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: repositoryRoot,
    env: { ...process.env, NODE_ENV: "production", EREMITE_DATA_DIR: temporaryDataDirectory, EREMITE_NEXT_DIST_DIR: ".next" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => output.push(chunk.toString()));
  server.stderr.on("data", (chunk) => output.push(chunk.toString()));
  await waitForServer(baseUrl, server, output);

  const auth = { cookie: `eremite_session=${sessionId}` };
  for (const pathname of ["/projects", `/projects/${projectId}`, `/projects/${projectId}/folders/${deepFolderId}`, "/tags", "/trash", `/search?q=HTTP&scope=project&projectId=${projectId}`]) {
    const page = await fetch(`${baseUrl}${pathname}`, { headers: auth });
    assert.equal(page.status, 200, `${pathname} should render`);
  }
  const rootDestinations = await fetch(`${baseUrl}/api/folders/destinations?projectId=${projectId}`, { headers: auth });
  assert.equal(rootDestinations.status, 200);
  assert.ok((await rootDestinations.json()).folders.some((folder) => folder.id === rootFolderId));
  const nestedDestinations = await fetch(`${baseUrl}/api/folders/destinations?projectId=${projectId}&parentId=${rootFolderId}`, { headers: auth });
  assert.equal(nestedDestinations.status, 200);
  const nestedDestinationPayload = await nestedDestinations.json();
  assert.deepEqual(nestedDestinationPayload.breadcrumbs, [{ id: rootFolderId, name: "Root" }]);
  assert.ok(nestedDestinationPayload.folders.some((folder) => folder.id === deepFolderId));
  const uploadHeaders = (name, type, size, extras = {}) => ({ ...auth, origin: baseUrl, "content-type": type, "x-eremite-file-name": encodeURIComponent(name), "x-eremite-file-size": String(size), ...extras });
  assert.equal((await fetch(`${baseUrl}/uploads/files`, { method: "POST", body: Buffer.from("no auth"), headers: { origin: baseUrl, "content-type": "text/plain", "x-eremite-file-name": "unauthorized.txt", "x-eremite-file-size": "7" } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/uploads/files`, { method: "POST", body: Buffer.from("wrong origin"), headers: { ...auth, origin: "http://example.invalid", "content-type": "text/plain", "x-eremite-file-name": "origin.txt", "x-eremite-file-size": "12" } })).status, 403);

  const smallUploadBytes = Buffer.from("small upload under one MiB");
  const smallUpload = await fetch(`${baseUrl}/uploads/files`, { method: "POST", body: smallUploadBytes, headers: uploadHeaders("small.txt", "text/plain", smallUploadBytes.length, { "x-eremite-file-title": encodeURIComponent("Small upload") }) });
  assert.equal(smallUpload.status, 201);
  const smallUploadId = (await smallUpload.json()).contentId;
  assert.deepEqual(pickDescriptor(await (await fetch(`${baseUrl}/files/${smallUploadId}/descriptor`, { headers: auth })).json()), { kind: "text", availability: "ready" });

  const largePdfHeader = makePdfFixture("Upload over one MiB");
  const largePdfBytes = Buffer.concat([largePdfHeader, Buffer.alloc(2 * 1024 * 1024, 0x20)]);
  const largeUpload = await fetch(`${baseUrl}/uploads/files`, { method: "POST", body: largePdfBytes, headers: uploadHeaders("large.pdf", "application/pdf", largePdfBytes.length) });
  assert.equal(largeUpload.status, 201);
  const largeUploadId = (await largeUpload.json()).contentId;
  const largeDescriptor = await (await fetch(`${baseUrl}/files/${largeUploadId}/descriptor`, { headers: auth })).json();
  assert.deepEqual(pickDescriptor(largeDescriptor), { kind: "pdf", availability: "ready" });
  assert.equal(largeDescriptor.byteSize, largePdfBytes.length);
  assert.equal((await fetch(`${baseUrl}/files/${largeUploadId}/content`, { headers: { ...auth, range: "bytes=0-3" } })).status, 206);
  assert.equal((await fetch(`${baseUrl}/viewer/${largeUploadId}`, { headers: auth })).status, 200);
  const uploadedInbox = await fetch(`${baseUrl}/inbox?selected=${largeUploadId}&preview=1`, { headers: auth });
  assert.equal(uploadedInbox.status, 200);
  assert.match(await uploadedInbox.text(), /large\.pdf/);

  const multiMegabyteBytes = Buffer.alloc(24 * 1024 * 1024, 0x61);
  const multiMegabyteUpload = await fetch(`${baseUrl}/uploads/files`, { method: "POST", body: multiMegabyteBytes, headers: uploadHeaders("twenty-four-megabytes.txt", "text/plain", multiMegabyteBytes.length) });
  assert.equal(multiMegabyteUpload.status, 201);
  const multiMegabyteId = (await multiMegabyteUpload.json()).contentId;
  assert.equal((await (await fetch(`${baseUrl}/files/${multiMegabyteId}/descriptor`, { headers: auth })).json()).byteSize, multiMegabyteBytes.length);

  const contentCountBeforeRejectedUploads = await databaseCount(temporaryDataDirectory, "content_items");
  const fileCountBeforeRejectedUploads = await storedFileCount(temporaryDataDirectory);
  const oversizedUpload = await fetch(`${baseUrl}/uploads/files`, { method: "POST", body: Buffer.from("rejected before stream"), headers: uploadHeaders("too-large.bin", "application/octet-stream", maximumFileUploadBytes + 1) });
  assert.equal(oversizedUpload.status, 413);
  assert.equal((await oversizedUpload.json()).code, "file_too_large");
  const interruptedUpload = await fetch(`${baseUrl}/uploads/files`, { method: "POST", body: Buffer.from("short"), headers: uploadHeaders("interrupted.bin", "application/octet-stream", 5000) });
  assert.equal(interruptedUpload.status, 400);
  assert.equal((await interruptedUpload.json()).code, "upload_interrupted");
  assert.equal(await databaseCount(temporaryDataDirectory, "content_items"), contentCountBeforeRejectedUploads);
  assert.equal(await storedFileCount(temporaryDataDirectory), fileCountBeforeRejectedUploads);
  const usableInboxAfterFailure = await fetch(`${baseUrl}/inbox`, { headers: auth });
  assert.equal(usableInboxAfterFailure.status, 200);
  assert.match(await usableInboxAfterFailure.text(), /Small upload/);
  for (const pathname of [`/files/${pdfId}/descriptor`, `/files/${pdfId}/content`, `/files/${pdfId}/download`]) {
    assert.equal((await fetch(`${baseUrl}${pathname}`, { redirect: "manual" })).status, 401, `${pathname} should require authentication`);
  }

  for (const pathname of ["/files/missing-id/descriptor", "/files/missing-id/content", "/files/missing-id/download"]) {
    assert.equal((await fetch(`${baseUrl}${pathname}`, { headers: auth })).status, 404, `${pathname} should return 404`);
  }

  const descriptor = await fetch(`${baseUrl}/files/${pdfId}/descriptor`, { headers: auth });
  assert.equal(descriptor.status, 200);
  assert.match(descriptor.headers.get("cache-control") ?? "", /private/);
  assert.match(descriptor.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(pickDescriptor(await descriptor.json()), { kind: "pdf", availability: "ready" });

  const content = await fetch(`${baseUrl}/files/${pdfId}/content`, { headers: auth });
  assert.equal(content.status, 200);
  assertSecurityHeaders(content, "inline", "application/pdf");
  assert.equal(content.headers.get("accept-ranges"), "bytes");

  const partial = await fetch(`${baseUrl}/files/${pdfId}/content`, { headers: { ...auth, range: "bytes=0-3" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), `bytes 0-3/${(await inboxFileSize(pdfId))}`);
  assert.equal(partial.headers.get("content-length"), "4");
  assert.equal(Buffer.from(await partial.arrayBuffer()).toString("ascii"), "%PDF");
  assertSecurityHeaders(partial, "inline", "application/pdf");

  const head = await fetch(`${baseUrl}/files/${pdfId}/content`, { method: "HEAD", headers: auth });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const etag = content.headers.get("etag");
  assert.ok(etag);
  const notModified = await fetch(`${baseUrl}/files/${pdfId}/content`, { headers: { ...auth, "if-none-match": etag } });
  assert.equal(notModified.status, 304);
  const ifRangeMiss = await fetch(`${baseUrl}/files/${pdfId}/content`, { headers: { ...auth, range: "bytes=0-3", "if-range": '"different"' } });
  assert.equal(ifRangeMiss.status, 200);
  const multipleRanges = await fetch(`${baseUrl}/files/${pdfId}/content`, { headers: { ...auth, range: "bytes=0-1,4-5" } });
  assert.equal(multipleRanges.status, 200, "legal multi-range requests safely fall back to a complete representation");

  const invalidRange = await fetch(`${baseUrl}/files/${pdfId}/content`, { headers: { ...auth, range: "bytes=999999-1000000" } });
  assert.equal(invalidRange.status, 416);
  assert.match(invalidRange.headers.get("content-range") ?? "", /^bytes \*\//);
  assert.equal(invalidRange.headers.get("accept-ranges"), "bytes");

  const download = await fetch(`${baseUrl}/files/${pdfId}/download`, { headers: auth });
  assert.equal(download.status, 200);
  assertSecurityHeaders(download, "attachment", "application/octet-stream");
  assert.match(download.headers.get("content-disposition") ?? "", /filename\*=UTF-8''/);

  const versions = await (await fetch(`${baseUrl}/files/${pdfId}/versions`, { headers: auth })).json();
  const originalVersionId = versions.currentVersionId;
  const replacementBytes = Buffer.from("replacement pdf bytes");
  const replacement = await fetch(`${baseUrl}/uploads/files/${pdfId}`, { method: "PUT", body: replacementBytes, headers: uploadHeaders("replaced.pdf", "application/pdf", replacementBytes.length, { "if-match": `"${originalVersionId}"`, "idempotency-key": "viewer-http-replace" }) });
  assert.equal(replacement.status, 200);
  const replacementPayload = await replacement.json();
  assert.notEqual(replacementPayload.versionId, originalVersionId);
  assert.equal(Buffer.from(await (await fetch(`${baseUrl}/files/${pdfId}/download`, { headers: auth })).arrayBuffer()).toString(), replacementBytes.toString(), "current download alias resolves the new head");
  assert.match(Buffer.from(await (await fetch(`${baseUrl}/files/${pdfId}/versions/${originalVersionId}/download`, { headers: auth })).arrayBuffer()).toString("ascii"), /^%PDF/, "pinned version download remains immutable");
  const replaceConflict = await fetch(`${baseUrl}/uploads/files/${pdfId}`, { method: "PUT", body: Buffer.from("conflict"), headers: uploadHeaders("conflict.pdf", "application/pdf", 8, { "if-match": `"${originalVersionId}"`, "idempotency-key": "viewer-http-conflict" }) });
  assert.equal(replaceConflict.status, 412);
  const restored = await fetch(`${baseUrl}/files/${pdfId}/versions/${originalVersionId}/restore`, { method: "POST", headers: { ...auth, origin: baseUrl, "if-match": `"${replacementPayload.versionId}"`, "idempotency-key": "viewer-http-restore" } });
  assert.equal(restored.status, 200);
  const restoredPayload = await restored.json();
  assert.notEqual(restoredPayload.versionId, originalVersionId, "restore creates a new head instead of moving the pointer backward");
  const updatedVersions = await (await fetch(`${baseUrl}/files/${pdfId}/versions`, { headers: auth })).json();
  assert.equal(updatedVersions.versions.length, 3);

  assert.equal((await fetch(`${baseUrl}/files/${missingId}/content`, { headers: auth })).status, 410);
  assert.equal((await fetch(`${baseUrl}/files/${missingId}/download`, { headers: auth })).status, 410);
  assert.equal((await fetch(`${baseUrl}/files/${integrityId}/content`, { headers: auth })).status, 422);
  assert.equal((await fetch(`${baseUrl}/files/${integrityId}/download`, { headers: auth })).status, 422);
  assert.equal((await fetch(`${baseUrl}/files/${corruptedId}/content`, { headers: auth })).status, 422);
  assert.equal((await fetch(`${baseUrl}/files/${unsupportedId}/content`, { headers: auth })).status, 415);
  assert.equal((await fetch(`${baseUrl}/files/${tooLargeId}/content`, { headers: auth })).status, 413);

  const failedDescriptor = await fetch(`${baseUrl}/files/${loadFailedId}/descriptor`, { headers: auth });
  assert.equal(failedDescriptor.status, 200);
  assert.deepEqual(pickDescriptor(await failedDescriptor.json()), { kind: "unsupported", availability: "load_failed" });
  assert.equal((await fetch(`${baseUrl}/files/${loadFailedId}/content`, { headers: auth })).status, 503);
  assert.equal((await fetch(`${baseUrl}/files/${loadFailedId}/download`, { headers: auth })).status, 503);
  const failedViewerPage = await fetch(`${baseUrl}/viewer/${loadFailedId}`, { headers: auth });
  assert.equal(failedViewerPage.status, 200);
  assert.match(await failedViewerPage.text(), /load-failed\.txt/);

  const legacy = await fetch(`${baseUrl}/files/${pdfId}`, { headers: auth, redirect: "manual" });
  assert.equal(legacy.status, 307);
  assert.equal(new URL(legacy.headers.get("location"), baseUrl).pathname, `/viewer/${pdfId}`);
  assert.equal((await fetch(`${baseUrl}/viewer/${pdfId}`, { redirect: "manual" })).status, 307);
  const viewerPage = await fetch(`${baseUrl}/viewer/${pdfId}`, { headers: auth });
  assert.equal(viewerPage.status, 200);
  assert.match(await viewerPage.text(), /HTTP range fixture|中文-range\.pdf/);

  console.log("Viewer/upload HTTP test passed: streaming uploads beyond 1 MiB, atomic failures, 401/403/404/410/413/415/422/503/206/416 and security headers.");

  async function inboxFileSize(id) {
    const response = await fetch(`${baseUrl}/files/${id}/descriptor`, { headers: auth });
    return (await response.json()).byteSize;
  }
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await Promise.race([new Promise((resolve) => server.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
  if (databaseModule) databaseModule.db().close();
  await rm(temporaryDataDirectory, { recursive: true, force: true });
}

async function databaseCount(dataDirectory, table) {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path.join(dataDirectory, "app.sqlite"), { readOnly: true });
  try { return database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count; }
  finally { database.close(); }
}

async function storedFileCount(dataDirectory) {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(path.join(dataDirectory, "files"), { withFileTypes: true });
  const staging = await readdir(path.join(dataDirectory, "files", ".upload-staging"), { withFileTypes: true }).catch(() => []);
  assert.equal(staging.filter((entry) => entry.isFile()).length, 0, "failed uploads must not leave staging files");
  return files.filter((entry) => entry.isFile()).length;
}

function assertSecurityHeaders(response, disposition, contentType) {
  assert.match(response.headers.get("cache-control") ?? "", /private/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-disposition") ?? "", new RegExp(`^${disposition};`));
  assert.match(response.headers.get("content-type") ?? "", new RegExp(`^${contentType.replace("/", "\\/")}`));
}

function pickDescriptor(descriptor) {
  return { kind: descriptor.kind, availability: descriptor.availability };
}

async function reservePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => socket.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = socket.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(baseUrl, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Viewer HTTP server exited early.\n${output.join("").slice(-4000)}`);
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual" });
      if (response.status > 0) return;
    } catch { /* Server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Viewer HTTP server did not become ready.\n${output.join("").slice(-4000)}`);
}
