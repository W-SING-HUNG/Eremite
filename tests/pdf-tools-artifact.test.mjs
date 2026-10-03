import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  PDF_TOOLS_ARTIFACT_SHA256,
  PDF_TOOLS_PACKAGE_NAME,
  PDF_TOOLS_PACKAGE_VERSION,
  PDF_TOOLS_SCHEMA_SHA256,
  PDF_TOOLS_QPDF_VERSION,
  PDF_TOOLS_TOOL_ID,
  acceptedPdfToolsCapabilities,
  pdfToolsCanonicalContract,
} from "@/modules/automations/tools/pdf-tools/authority";
import { resolveInstalledPdfTools } from "@/modules/automations/tools/pdf-tools/runtime";

const artifact = path.resolve("vendor/pdf-tools/pdf-tools-core-1.0.0-rc5.tgz");
const bytes = await readFile(artifact);
assert.equal(createHash("sha256").update(bytes).digest("hex"), PDF_TOOLS_ARTIFACT_SHA256);

function readTarEntries(tgz) {
  const tar = gunzipSync(tgz);
  const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/u, "");
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim() || "0", 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0);
    const bodyStart = offset + 512;
    entries.set(fullName, Buffer.from(tar.subarray(bodyStart, bodyStart + size)));
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const tarEntries = readTarEntries(bytes);
const names = [...tarEntries.keys()];
assert.equal(names.length, 204);
assert.ok(tarEntries.has("package/dist/cli/cli.js"));
assert.ok(tarEntries.has("package/schema/supplier-protocol-v1.schema.json"));
assert.equal(names.some((name) => /(^|\/)vendor\/|\.(exe|dll)$/iu.test(name)), false, "rc5 must contain no bundled qpdf/native binaries or vendor fallback");
assert.ok(tarEntries.has("package/LICENSE"));
assert.ok(tarEntries.has("package/THIRD-PARTY-NOTICES"));
assert.equal(names.some((name) => /(^|\/)(src|tests?|spec|benchmark|\.github|dev-harness|\.workbuddy)(\/|$)|\.js\.map$/u.test(name)), false);
assert.equal(names.some((name) => /accepted-capabilities|host-contract|microsoft-office/iu.test(name)), false);

const manifest = JSON.parse(tarEntries.get("package/package.json").toString("utf8"));
assert.equal(manifest.name, PDF_TOOLS_PACKAGE_NAME);
assert.equal(manifest.version, PDF_TOOLS_PACKAGE_VERSION);
assert.equal(manifest.license, "Apache-2.0");
assert.equal(manifest.engines.node, ">=24 <25");
assert.deepEqual(manifest.bin, { "pdf-tools-core": "./dist/cli/cli.js" });
assert.deepEqual(JSON.parse(tarEntries.get("package/schema/supplier-protocol-v1.schema.json").toString("utf8")), pdfToolsCanonicalContract);
assert.equal(createHash("sha256").update(tarEntries.get("package/schema/supplier-protocol-v1.schema.json")).digest("hex"), PDF_TOOLS_SCHEMA_SHA256);

assert.deepEqual(manifest.bundleDependencies, ["ajv"]);
assert.equal(JSON.parse(tarEntries.get("package/node_modules/ajv/package.json").toString("utf8")).version, "8.20.0");
assert.equal(JSON.parse(tarEntries.get("package/node_modules/fast-uri/package.json").toString("utf8")).version, "3.1.8");

const installed = await resolveInstalledPdfTools();
assert.equal(installed.packageVersion, PDF_TOOLS_PACKAGE_VERSION);
assert.equal(installed.qpdfVersion, PDF_TOOLS_QPDF_VERSION);
assert.equal(installed.qpdfSha256, createHash("sha256").update(await readFile(installed.qpdfPath)).digest("hex"));
assert.equal(path.relative(installed.packageRoot, installed.qpdfPath).startsWith(".."), true, "qpdf must be an external prerequisite");
for (const [entry, expected] of tarEntries) {
  if (!entry.startsWith("package/") || entry.endsWith("/")) continue;
  const installedPath = path.join(installed.packageRoot, entry.slice("package/".length));
  assert.equal((await stat(installedPath)).isFile(), true, `missing installed file: ${entry}`);
  assert.deepEqual(await readFile(installedPath), expected, `installed package drift: ${entry}`);
}

assert.equal(PDF_TOOLS_TOOL_ID, "core.pdf-tools");
assert.deepEqual(acceptedPdfToolsCapabilities.map((entry) => entry.id), ["pdf.merge", "pdf.split", "pdf.extract", "pdf.rotate", "pdf.reorder"]);
console.log("PDF Tools artifact gate passed: rc5 identity, no bundled native binaries, unchanged canonical protocol, external qpdf and Host-owned five-operation allowlist.");
