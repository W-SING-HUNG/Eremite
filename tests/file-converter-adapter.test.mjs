import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { uuidv7 } from "@/platform/shared/ids";
import { parseCanonicalFileConverterResponse } from "@/modules/automations/tools/file-converter/contract";
import { resolveInstalledFileConverter } from "@/modules/automations/tools/file-converter/runtime";
import { withFileConverterOutput } from "@/modules/automations/tools/file-converter/host-adapter";
import { validateSupplierOutput } from "@/modules/automations/tools/file-converter/output-validation";
import { makeDocxFixture, makeOversizedPngHeader, makeZipFixture } from "./viewer-fixtures.mjs";

const outputValidationSource = await readFile(path.join(process.cwd(), "src", "modules", "automations", "tools", "file-converter", "output-validation.ts"), "utf8");
const platformInspectionSources = await Promise.all([
  "docx-inspection.ts", "image-metadata.ts", "zip-inspection.ts",
].map((name) => readFile(path.join(process.cwd(), "src", "platform", "files", name), "utf8")));
assert.doesNotMatch(outputValidationSource, /@\/modules\/viewer\//u, "File Converter must not import Viewer internals");
assert.doesNotMatch(platformInspectionSources.join("\n"), /@\/modules\//u, "Platform file inspection must not depend on product modules");

const installed = await resolveInstalledFileConverter();
assert.equal(installed.packageVersion, "1.1.2");
assert.ok(installed.cliPath.endsWith(path.join("dist", "cli", "index.js")));
assert.ok(installed.nativeHelperPath.endsWith("fc-movefile.exe"));

const syntheticFailure = {
  kind: "response", contractVersion: 1, invocationId: uuidv7(), status: "failed", coreVersion: "1.1.0",
  durationMs: 1, warnings: [], errors: [{ code: "FC_SOURCE_UNSUPPORTED", stage: "detection", retryable: false }],
};
assert.equal(parseCanonicalFileConverterResponse(syntheticFailure).status, "failed");
assert.throws(() => parseCanonicalFileConverterResponse({ ...syntheticFailure, errors: [{ code: "supplier_custom", stage: "detection", retryable: false }] }), /file_converter_contract_invalid/u);

const root = await mkdtemp(path.join(tmpdir(), "eremite-adapter-test-"));
try {
  const source = path.join(root, "source.png");
  await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 40, g: 100, b: 180, alpha: 0.7 } } }).png().toFile(source);
  const bytes = await readFile(source); const sha256 = createHash("sha256").update(bytes).digest("hex");
  const result = await withFileConverterOutput({
    invocationId: uuidv7(), sourcePath: source, displayName: "测试图像.png", declaredMediaType: "image/png",
    expectedSize: bytes.length, expectedSha256: sha256, sourceFormat: "png", conversionId: "png-to-jpeg", profile: "balanced",
  }, async (output, response) => {
    const converted = await readFile(output.path);
    assert.equal(converted[0], 0xff); assert.equal(converted[1], 0xd8);
    assert.equal(createHash("sha256").update(converted).digest("hex"), response.output.sha256);
    return converted.length;
  });
  assert.equal(result.response.status, "succeeded");
  assert.equal(result.response.coreVersion, "1.1.2");
  if (result.response.status === "succeeded") assert.ok(result.value > 0);

  const validDocx = await makeDocxFixture("File Converter validation");
  await assertValidatedFixture(root, "valid.docx", validDocx, { formatId: "docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: ".docx" });
  const plainZip = await makeZipFixture();
  await assert.rejects(
    assertValidatedFixture(root, "plain.docx", plainZip, { formatId: "docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: ".docx" }),
    /host_output_type_mismatch/u,
  );
  const oversizedPng = makeOversizedPngHeader();
  await assert.rejects(
    assertValidatedFixture(root, "oversized.png", oversizedPng, { formatId: "png", mediaType: "image/png", extension: ".png" }),
    /host_output_image_unsafe/u,
  );

  const malformed = path.join(root, "bad.png"); await writeFile(malformed, Buffer.from("not an image"));
  const malformedBytes = await readFile(malformed);
  const failed = await withFileConverterOutput({
    invocationId: uuidv7(), sourcePath: malformed, displayName: "损坏.png", declaredMediaType: "image/png",
    expectedSize: malformedBytes.length, expectedSha256: createHash("sha256").update(malformedBytes).digest("hex"), sourceFormat: "png", conversionId: "png-to-jpeg",
  }, async () => { throw new Error("failure output must not be consumed"); });
  assert.equal(failed.response.status, "failed");
} finally {
  await rm(root, { recursive: true, force: true });
}

const residue = (await readdir(tmpdir())).filter((name) => name.startsWith("eremite-file-converter-"));
assert.deepEqual(residue, []);
console.log("File Converter adapter gate passed: installed identity, canonical parsing, real Sharp conversion, business failure and workspace cleanup.");

async function assertValidatedFixture(root, name, bytes, format) {
  const outputPath = path.join(root, name);
  await writeFile(outputPath, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return validateSupplierOutput({
    outputPath,
    outputDirectory: root,
    maximumBytes: 512 * 1024 * 1024,
    response: { target: format, output: { byteSize: bytes.length, sha256, detectedType: format } },
  });
}
