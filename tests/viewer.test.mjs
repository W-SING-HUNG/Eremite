import assert from "node:assert/strict";
import { File } from "node:buffer";
import { cp, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectViewerFormat } from "@/modules/viewer/format";
import { archiveEntryLimit, inspectZipDirectory, isUnsafeArchivePath, parseZipCentralDirectory } from "@/modules/viewer/archive";
import { exceedsSafeImageDimensions, maximumImagePixels, readImageDimensions } from "@/modules/viewer/image";
import { makeDocxFixture, makeOversizedPngHeader, makeZipFixture } from "./viewer-fixtures.mjs";
import { isMarkdownTooComplex, maximumMarkdownCharacters, maximumMarkdownLines } from "@/modules/viewer/markdown-complexity";
import { contentDisposition, parseByteRange } from "@/modules/viewer/http";
import { decodeViewerText } from "@/modules/viewer/text-decoding";

const bytes = (...values) => new Uint8Array(values);
assert.deepEqual(detectViewerFormat("paper.pdf", "application/octet-stream", bytes(0x25, 0x50, 0x44, 0x46, 0x2d)), { kind: "pdf", mimeType: "application/pdf", formatMismatch: false });
assert.deepEqual(detectViewerFormat("wrong.txt", "text/plain", bytes(0x25, 0x50, 0x44, 0x46, 0x2d)), { kind: "pdf", mimeType: "application/pdf", formatMismatch: true });
assert.equal(detectViewerFormat("photo.png", "image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)).kind, "image");
assert.equal(detectViewerFormat("photo.webp", "", new Uint8Array([...Buffer.from("RIFFxxxxWEBP")])).mimeType, "image/webp");
assert.equal(detectViewerFormat("notes.md", "text/plain", new TextEncoder().encode("# Notes")).kind, "markdown");
assert.equal(detectViewerFormat("archive.zip", "application/zip", bytes(0x50, 0x4b, 0x03, 0x04)).kind, "archive");
assert.equal(detectViewerFormat("empty.zip", "application/zip", bytes(0x50, 0x4b, 0x05, 0x06)).kind, "archive");
assert.deepEqual(detectViewerFormat("clip.mp4", "video/mp4", new Uint8Array([...bytes(0, 0, 0, 24), ...Buffer.from("ftypisom")])).kind, "video");
assert.deepEqual(detectViewerFormat("clip.webm", "video/webm", bytes(0x1a, 0x45, 0xdf, 0xa3)).kind, "video");
assert.equal(detectViewerFormat("document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes(0x50, 0x4b, 0x03, 0x04)).kind, "unsupported");
assert.equal(detectViewerFormat("document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes(0x50, 0x4b, 0x03, 0x04), "docx").kind, "docx");
assert.equal(detectViewerFormat("not-word.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes(0x50, 0x4b, 0x03, 0x04), "zip").kind, "archive");

const emptyZip = new ArrayBuffer(22);
const emptyZipView = new DataView(emptyZip);
emptyZipView.setUint32(0, 0x06054b50, true);
assert.deepEqual(inspectZipDirectory(emptyZip), { entryCount: 0, isMultiDisk: false, isZip64: false, centralDirectoryOffset: 0, centralDirectorySize: 0 });
emptyZipView.setUint16(10, archiveEntryLimit + 1, true);
assert.equal(inspectZipDirectory(emptyZip)?.entryCount, archiveEntryLimit + 1);
assert.equal(inspectZipDirectory(new ArrayBuffer(8)), null);
assert.equal(isUnsafeArchivePath("folder/readme.txt"), false);
assert.equal(isUnsafeArchivePath("../outside.txt"), true);
assert.equal(isUnsafeArchivePath("C:\\outside.txt"), true);

const zipFixture = await makeZipFixture();
const zipDirectory = inspectZipDirectory(zipFixture.buffer.slice(zipFixture.byteOffset, zipFixture.byteOffset + zipFixture.byteLength));
assert.ok(zipDirectory);
const centralBytes = zipFixture.subarray(zipDirectory.centralDirectoryOffset, zipDirectory.centralDirectoryOffset + zipDirectory.centralDirectorySize);
const centralEntries = parseZipCentralDirectory(centralBytes.buffer.slice(centralBytes.byteOffset, centralBytes.byteOffset + centralBytes.byteLength), zipDirectory.entryCount);
assert.deepEqual(centralEntries?.map((entry) => entry.name), ["README.txt", "notes/", "notes/daily.txt"]);

const pngHeader = makeOversizedPngHeader(320, 180);
assert.deepEqual(readImageDimensions(pngHeader, "image/png"), { width: 320, height: 180 });
assert.equal(exceedsSafeImageDimensions({ width: 320, height: 180 }), false);
assert.equal(exceedsSafeImageDimensions({ width: maximumImagePixels, height: 2 }), true);
assert.deepEqual(readImageDimensions(bytes(0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, 0, 180, 1, 64), "image/jpeg"), { width: 320, height: 180 });
assert.deepEqual(readImageDimensions(new Uint8Array([...Buffer.from("RIFFxxxxWEBPVP8X"), 0, 0, 0, 0, 0, 0, 0, 0, 0x3f, 0x01, 0, 0xb3, 0, 0]), "image/webp"), { width: 320, height: 180 });
assert.equal(isMarkdownTooComplex("# Safe\n\nText"), false);
assert.equal(isMarkdownTooComplex("x".repeat(maximumMarkdownCharacters + 1)), true);
assert.equal(isMarkdownTooComplex("\n".repeat(maximumMarkdownLines)), true);

assert.deepEqual(parseByteRange(null, 100), null);
assert.deepEqual(parseByteRange("bytes=10-19", 100), { start: 10, end: 19 });
assert.deepEqual(parseByteRange("bytes=90-", 100), { start: 90, end: 99 });
assert.deepEqual(parseByteRange("bytes=-10", 100), { start: 90, end: 99 });
assert.equal(parseByteRange("bytes=100-101", 100), "invalid");
assert.equal(parseByteRange("bytes=0-1,4-5", 100), "multiple");
assert.match(contentDisposition("attachment", "中文 文件.txt"), /^attachment; filename="__ __\.txt"; filename\*=UTF-8''/);

assert.deepEqual(decodeViewerText(new TextEncoder().encode("你好").buffer), { text: "你好", encoding: "utf-8" });
const utf16 = bytes(0xff, 0xfe, 0x41, 0x00).buffer;
assert.deepEqual(decodeViewerText(utf16), { text: "A", encoding: "utf-16le" });

const repositoryRoot = process.cwd();
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-viewer-"));
const priorDataDirectory = process.env.EREMITE_DATA_DIR;
let databaseModule;
try {
  await cp(path.join(repositoryRoot, "db"), path.join(temporaryRoot, "db"), { recursive: true });
  process.chdir(temporaryRoot);
  process.env.EREMITE_DATA_DIR = path.join(temporaryRoot, "data");
  databaseModule = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const viewer = await import("@/modules/viewer/service");
  const fileId = await inbox.createFileContentItem(new File([Buffer.from("%PDF-test")], "reading.pdf", { type: "application/pdf" }), "Reading");
  const descriptor = await viewer.getViewerDescriptor(fileId);
  assert.deepEqual({ kind: descriptor.kind, availability: descriptor.availability, title: descriptor.title }, { kind: "pdf", availability: "ready", title: "Reading" });

  const fileAsset = inbox.getFileAssetForViewing(fileId);
  await writeFile(path.join(temporaryRoot, "data", "files", fileAsset.storageKey), "changed");
  assert.equal((await viewer.getViewerDescriptor(fileId)).availability, "integrity_error");
  await rm(path.join(temporaryRoot, "data", "files", fileAsset.storageKey));
  assert.equal((await viewer.getViewerDescriptor(fileId)).availability, "missing");

  const validDocx = await makeDocxFixture();
  const docxId = await inbox.createFileContentItem(new File([validDocx], "reading.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "DOCX reading");
  assert.deepEqual(pick(await viewer.getViewerDescriptor(docxId)), { kind: "docx", availability: "ready" });

  const plainZip = await makeZipFixture();
  const mislabeledDocxId = await inbox.createFileContentItem(new File([plainZip], "mislabeled.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  assert.deepEqual(pick(await viewer.getViewerDescriptor(mislabeledDocxId)), { kind: "archive", availability: "ready" });

  const malformedDocx = validDocx.subarray(0, validDocx.length - 24);
  const malformedDocxId = await inbox.createFileContentItem(new File([malformedDocx], "malformed.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  assert.deepEqual(pick(await viewer.getViewerDescriptor(malformedDocxId)), { kind: "docx", availability: "corrupted" });

  const oversizedImageId = await inbox.createFileContentItem(new File([makeOversizedPngHeader()], "huge.png", { type: "image/png" }));
  assert.deepEqual(pick(await viewer.getViewerDescriptor(oversizedImageId)), { kind: "image", availability: "too_large" });

  const unreadableId = await inbox.createFileContentItem(new File([Buffer.from("unreadable")], "unreadable.txt", { type: "text/plain" }));
  const unreadableAsset = inbox.getFileAssetForViewing(unreadableId);
  const unreadablePath = path.join(temporaryRoot, "data", "files", unreadableAsset.storageKey);
  await unlink(unreadablePath);
  await mkdir(unreadablePath);
  assert.equal((await viewer.getViewerDescriptor(unreadableId)).availability, "load_failed");

  databaseModule.db().close();
  databaseModule = undefined;
  console.log("Viewer contract test passed.");
} finally {
  if (priorDataDirectory === undefined) delete process.env.EREMITE_DATA_DIR;
  else process.env.EREMITE_DATA_DIR = priorDataDirectory;
  process.chdir(repositoryRoot);
  if (databaseModule) databaseModule.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

function pick(descriptor) {
  assert.ok(descriptor);
  return { kind: descriptor.kind, availability: descriptor.availability };
}
