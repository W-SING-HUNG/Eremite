import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { clearInstalledPdfToolsCacheForTests, resolveInstalledPdfTools } from "@/modules/automations/tools/pdf-tools/runtime";
import { getPdfToolsAvailability } from "@/modules/automations/tools/pdf-tools/availability";

const originalPath = process.env.PATH;
try {
  process.env.PATH = "";
  clearInstalledPdfToolsCacheForTests();
  await assert.rejects(resolveInstalledPdfTools(), /pdf_tools_external_qpdf_unavailable/);
  assert.equal((await getPdfToolsAvailability(true)).available, false);
  process.env.PATH = ".";
  clearInstalledPdfToolsCacheForTests();
  await assert.rejects(resolveInstalledPdfTools(), /pdf_tools_external_qpdf_unavailable/, "relative PATH entries cannot become a cwd fallback");
} finally {
  if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
  clearInstalledPdfToolsCacheForTests();
}
const installed = await resolveInstalledPdfTools();
assert.equal(installed.packageVersion, "1.0.0-rc5");
assert.equal(installed.qpdfVersion, "12.4.0");
assert.equal(installed.qpdfSha256, createHash("sha256").update(await readFile(installed.qpdfPath)).digest("hex"));
assert.equal((await getPdfToolsAvailability(true)).available, true);
console.log("External qpdf gate passed: real PATH 12.4.0, observed hash, missing/relative PATH unavailable, no vendor fallback.");
