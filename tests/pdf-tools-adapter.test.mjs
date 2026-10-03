import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDF_TOOLS_LIMITS } from "@/modules/automations/tools/pdf-tools/authority";
import { withPdfToolsOutputs } from "@/modules/automations/tools/pdf-tools/host-adapter";
import { validatePdfToolsOutputs } from "@/modules/automations/tools/pdf-tools/output-validation";
import { resolveInstalledPdfTools } from "@/modules/automations/tools/pdf-tools/runtime";
import { pdfSignatures, writePdfFixture } from "./pdf-tools-fixture.mjs";
import { runExternalTool } from "@/platform/external-tools/request-runner";

const root = await mkdtemp(path.join(tmpdir(), "eremite-pdf-tools-adapter-"));
const installed = await resolveInstalledPdfTools();
const ids = [
  "11111111-1111-7111-8111-111111111111",
  "22222222-2222-7222-8222-222222222222",
  "33333333-3333-7333-8333-333333333333",
  "44444444-4444-7444-8444-444444444444",
  "55555555-5555-7555-8555-555555555555",
  "66666666-6666-7666-8666-666666666666",
];
try {
  const ab = path.join(root, "ab.pdf");
  const c = path.join(root, "c.pdf");
  const abc = path.join(root, "abc.pdf");
  await writePdfFixture(ab, [{ label: "A", width: 200, height: 300 }, { label: "B", width: 300, height: 400 }]);
  await writePdfFixture(c, [{ label: "C", width: 400, height: 500 }]);
  await writePdfFixture(abc, [{ label: "A", width: 200, height: 300 }, { label: "B", width: 300, height: 400 }, { label: "C", width: 400, height: 500 }]);
  const source = async (file) => {
    const bytes = await readFile(file);
    return { sourcePath: file, displayName: path.basename(file), expectedSize: bytes.length, expectedSha256: createHash("sha256").update(bytes).digest("hex") };
  };

  const merge = await withPdfToolsOutputs({ invocationId: ids[0], operation: "pdf.merge", inputs: [await source(ab), await source(c)] }, async (outputs) => {
    assert.equal(outputs.length, 1);
    return pdfSignatures(installed.qpdfPath, outputs[0].path);
  });
  assert.equal(merge.response.status, "succeeded", JSON.stringify(merge.response));
  assert.equal(merge.response.provenance.coreVersion, "1.0.0-rc5");
  assert.deepEqual(merge.value, ["200x300@0", "300x400@0", "400x500@0"]);

  const split = await withPdfToolsOutputs({ invocationId: ids[1], operation: "pdf.split", inputs: [await source(abc)], parameters: { strategy: { type: "every", n: 1 } } }, async (outputs) => {
    assert.equal(outputs.length, 3);
    return outputs.map((output) => pdfSignatures(installed.qpdfPath, output.path)[0]);
  });
  assert.equal(split.response.status, "succeeded");
  assert.equal(split.response.provenance.coreVersion, "1.0.0-rc5");
  assert.deepEqual(split.value, ["200x300@0", "300x400@0", "400x500@0"]);

  const extract = await withPdfToolsOutputs({ invocationId: ids[2], operation: "pdf.extract", inputs: [await source(abc)], parameters: { pageSelector: { mode: "pages", pages: [2, 0] } } }, async (outputs) => pdfSignatures(installed.qpdfPath, outputs[0].path));
  assert.equal(extract.response.status, "succeeded");
  assert.equal(extract.response.provenance.coreVersion, "1.0.0-rc5");
  assert.deepEqual(extract.value, ["400x500@0", "200x300@0"]);

  const rotate = await withPdfToolsOutputs({ invocationId: ids[3], operation: "pdf.rotate", inputs: [await source(abc)], parameters: { pages: { mode: "pages", pages: [1] }, angle: 90, mode: "relative" } }, async (outputs) => pdfSignatures(installed.qpdfPath, outputs[0].path));
  assert.equal(rotate.response.status, "succeeded");
  assert.equal(rotate.response.provenance.coreVersion, "1.0.0-rc5");
  assert.deepEqual(rotate.value, ["200x300@0", "300x400@90", "400x500@0"]);

  const reorder = await withPdfToolsOutputs({ invocationId: ids[4], operation: "pdf.reorder", inputs: [await source(abc)], parameters: { pageOrder: [2, 0, 1] } }, async (outputs) => pdfSignatures(installed.qpdfPath, outputs[0].path));
  assert.equal(reorder.response.status, "succeeded");
  assert.equal(reorder.response.provenance.coreVersion, "1.0.0-rc5");
  assert.deepEqual(reorder.value, ["400x500@0", "200x300@0", "300x400@0"]);

  const failure = await withPdfToolsOutputs({ invocationId: ids[5], operation: "pdf.extract", inputs: [await source(abc)], parameters: { pageSelector: { mode: "pages", pages: [99] } } }, async () => {
    throw new Error("business failure output must not be consumed");
  });
  assert.equal(failure.response.status, "failed");
  assert.equal(failure.response.error.code, "parameter.out_of_range");

  // Exercise the accepted CLI's containment guard with a real outside PDF.
  const escapeRoot = path.join(root, "escape-workspace");
  const workspace = { root: escapeRoot, inputDir: path.join(escapeRoot, "input"), outputDir: path.join(escapeRoot, "output"), workDir: path.join(escapeRoot, "work"), logsDir: path.join(escapeRoot, "logs"), requestPath: path.join(escapeRoot, "request.json"), responsePath: path.join(escapeRoot, "response.json") };
  for (const directory of [workspace.inputDir, workspace.outputDir, workspace.workDir, workspace.logsDir]) await mkdir(directory, { recursive: true });
  const escapedBytes = await readFile(abc);
  const escapeResult = await runExternalTool({ cliPath: installed.cliPath, workspace, timeoutMs: 30000, request: {
    kind: "pdf.tools.request", protocolVersion: 1, invocationId: ids[5], operation: "pdf.reorder",
    workspace: { rootPath: escapeRoot }, inputs: [{ id: "in-0", relativePath: "../abc.pdf", snapshot: { displayName: "outside.pdf", byteSize: escapedBytes.length, sha256: createHash("sha256").update(escapedBytes).digest("hex") } }], parameters: { pageOrder: [0, 1, 2] },
  } });
  assert.equal(escapeResult.exitCode, 0);
  const escapeResponse = JSON.parse(escapeResult.responseText);
  assert.equal(escapeResponse.status, "failed");
  assert.equal(escapeResponse.error.code, "input.escape");
  assert.deepEqual(await readFile(abc), escapedBytes, "containment rejection preserves outside source");

  const validationRoot = path.join(root, "validation");
  const outputRoot = path.join(validationRoot, "output");
  await mkdir(outputRoot, { recursive: true });
  const good = path.join(outputRoot, "good.pdf");
  const bad = path.join(outputRoot, "bad.pdf");
  await copyFile(abc, good);
  await writeFile(bad, Buffer.from("%PDF-1.4\nnot a valid document\n%%EOF"));
  const goodBytes = await readFile(good);
  const badBytes = await readFile(bad);
  const response = {
    kind: "pdf.tools.response", protocolVersion: 1, invocationId: ids[1], operation: "pdf.split", status: "succeeded",
    outputs: [
      { id: "out-0", displayName: "good.pdf", byteSize: goodBytes.length, sha256: createHash("sha256").update(goodBytes).digest("hex"), pageCount: 3, relativePath: "output/good.pdf" },
      { id: "out-1", displayName: "bad.pdf", byteSize: badBytes.length, sha256: createHash("sha256").update(badBytes).digest("hex"), pageCount: 1, relativePath: "output/bad.pdf" },
    ],
    provenance: { coreVersion: "0.1.0", protocolVersion: 1, operation: "pdf.split" }, warnings: [],
  };
  await assert.rejects(() => validatePdfToolsOutputs({ workspaceRoot: validationRoot, outputDirectory: outputRoot, response, limits: { ...PDF_TOOLS_LIMITS } }), /host_pdf_output_structural_invalid/u);
  const partial = { ...response, outputs: [response.outputs[0], { ...response.outputs[1], relativePath: "output/missing.pdf" }] };
  await assert.rejects(() => validatePdfToolsOutputs({ workspaceRoot: validationRoot, outputDirectory: outputRoot, response: partial, limits: { ...PDF_TOOLS_LIMITS } }));
  await assert.rejects(() => validatePdfToolsOutputs({ workspaceRoot: validationRoot, outputDirectory: outputRoot, response: { ...response, outputs: [response.outputs[0]] }, limits: { ...PDF_TOOLS_LIMITS, maxTotalOutputBytes: 1 } }), /host_pdf_output_total_limit/u);
  assert.equal((await stat(good)).isFile(), true);
  console.log("PDF Tools adapter gate passed: five real operations, page order/rotation, business failure, per-output, partial-set and aggregate validation.");
} finally {
  await rm(root, { recursive: true, force: true });
}
