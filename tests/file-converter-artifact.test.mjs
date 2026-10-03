import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import {
  FILE_CONVERTER_ARTIFACT_SHA256,
  FILE_CONVERTER_CONTRACT_SHA256,
  FILE_CONVERTER_NATIVE_HELPER_SHA256,
  FILE_CONVERTER_CONTRACT_ID,
  FILE_CONVERTER_PACKAGE_NAME,
  FILE_CONVERTER_PACKAGE_VERSION,
  FILE_CONVERTER_TOOL_ID,
  acceptedFileConversions,
  fileConverterCanonicalContract,
} from "@/modules/automations/tools/file-converter/authority";

const artifact = path.resolve("vendor/file-converter/file-converter-core-1.1.2.tgz");
const bytes = await readFile(artifact);
assert.equal(createHash("sha256").update(bytes).digest("hex"), FILE_CONVERTER_ARTIFACT_SHA256);

function readTarEntries(tgz) {
  const tar = gunzipSync(tgz);
  const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/u, "");
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0, `Unsafe tar size for ${fullName}`);
    const bodyStart = offset + 512;
    entries.set(fullName, Buffer.from(tar.subarray(bodyStart, bodyStart + size)));
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const tarEntries = readTarEntries(bytes);
const entries = [...tarEntries.keys()];
assert.equal(entries.length, 105);
assert.ok(tarEntries.has("package/LICENSE"));
assert.ok(tarEntries.has("package/THIRD-PARTY-NOTICES.md"));
assert.ok(tarEntries.has("package/dist/native/bin/fc-movefile.exe"));
assert.ok(tarEntries.has("package/dist/cli/index.js"));
assert.ok(tarEntries.has("package/tool-contract.json"));
assert.equal(entries.some((entry) => /(^|\/)(src|tests|dev-harness|node_modules|\.workbuddy|accepted-capabilities)(\/|$)/u.test(entry)), false);
assert.equal(entries.some((entry) => /qa-stub|phase.?5|fc-cli|workspace\/publish\./iu.test(entry)), false);

const manifest = JSON.parse(tarEntries.get("package/package.json").toString("utf8"));
assert.equal(manifest.name, FILE_CONVERTER_PACKAGE_NAME);
assert.equal(manifest.version, FILE_CONVERTER_PACKAGE_VERSION);
assert.equal(manifest.license, "Apache-2.0");
assert.equal(manifest.engines.node, ">=24 <25");
assert.equal(manifest.bin?.["file-converter-core"], "dist/cli/index.js");
assert.deepEqual(Object.keys(manifest.bin), ["file-converter-core"]);

assert.deepEqual(manifest.dependencies, { sharp: "0.35.4" });
assert.equal(createHash("sha256").update(tarEntries.get("package/tool-contract.json")).digest("hex"), FILE_CONVERTER_CONTRACT_SHA256);
assert.equal(createHash("sha256").update(tarEntries.get("package/dist/native/bin/fc-movefile.exe")).digest("hex"), FILE_CONVERTER_NATIVE_HELPER_SHA256);
const supplierContract = JSON.parse(tarEntries.get("package/tool-contract.json").toString("utf8"));
assert.deepEqual(supplierContract, fileConverterCanonicalContract);
assert.equal(supplierContract.$id, FILE_CONVERTER_CONTRACT_ID);

const installedRoot = path.resolve("node_modules/file-converter-core");
const installedManifest = JSON.parse(await readFile(path.join(installedRoot, "package.json"), "utf8"));
assert.equal(installedManifest.name, FILE_CONVERTER_PACKAGE_NAME);
assert.equal(installedManifest.version, FILE_CONVERTER_PACKAGE_VERSION);
const installedSharp = createRequire(path.join(installedRoot, "package.json"))("sharp");
assert.equal(installedSharp.versions.sharp, "0.35.4");
for (const [entry, expected] of tarEntries) {
  if (!entry.startsWith("package/") || entry.endsWith("/")) continue;
  const installedPath = path.join(installedRoot, entry.slice("package/".length));
  assert.equal((await stat(installedPath)).isFile(), true, `Installed entry is not a file: ${entry}`);
  assert.deepEqual(await readFile(installedPath), expected, `Installed package differs from accepted tgz: ${entry}`);
}

assert.equal(FILE_CONVERTER_TOOL_ID, "core.file-converter");
assert.equal(acceptedFileConversions.length, 18);
assert.equal(new Set(acceptedFileConversions.map((entry) => entry.id)).size, 18);
assert.equal(acceptedFileConversions.filter((entry) => !entry.previewable).length, 4);
assert.equal(acceptedFileConversions.some((entry) => entry.id === "docx-to-pdf" && entry.engine === "libreoffice"), true);

console.log("File Converter artifact gate passed: accepted tgz identity, canonical Contract and Host-owned 18-item allowlist.");
