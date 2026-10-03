import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { uuidv7 } from "@/platform/shared/ids";
import { withFileConverterOutput } from "@/modules/automations/tools/file-converter/host-adapter";

const root = await mkdtemp(path.join(tmpdir(), "eremite-file-converter-real-engines-"));
try {
  const cases = [];
  const pngPath = path.join(root, "engine.png"); await sharp({ create: { width: 2, height: 2, channels: 3, background: "#3377aa" } }).png().toFile(pngPath);
  cases.push({ sourcePath: pngPath, displayName: "engine.png", mime: "image/png", sourceFormat: "png", conversionId: "png-to-jpeg", expected: "jpeg" });
  const mdPath = path.join(root, "engine.md"); await writeFile(mdPath, "# Eremite\n\nHost integration smoke.\n", "utf8");
  cases.push({ sourcePath: mdPath, displayName: "engine.md", mime: "text/markdown", sourceFormat: "markdown", conversionId: "markdown-to-html", expected: "html" });
  const docxPath = path.join(root, "engine.docx"); await writeFile(docxPath, await minimalDocx());
  cases.push({ sourcePath: docxPath, displayName: "engine.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sourceFormat: "docx", conversionId: "docx-to-pdf", expected: "pdf" });
  const actual = [];
  for (const item of cases) {
    const bytes = await readFile(item.sourcePath); const sha256 = createHash("sha256").update(bytes).digest("hex");
    const result = await withFileConverterOutput({ invocationId: uuidv7(), sourcePath: item.sourcePath, displayName: item.displayName, declaredMediaType: item.mime, expectedSize: bytes.length, expectedSha256: sha256, sourceFormat: item.sourceFormat, conversionId: item.conversionId }, async (output, response) => { assert.equal(output.format.formatId, item.expected); assert.ok((await readFile(output.path)).length > 0); return response.engine; });
    assert.equal(result.response.status, "succeeded", JSON.stringify(result.response));
    assert.equal(result.response.coreVersion, "1.1.2");
    if (result.response.status === "succeeded") actual.push(result.value.id);
  }
  assert.deepEqual(actual, ["sharp", "pandoc", "libreoffice"]);
  console.log("File Converter real-engine gate passed: Sharp, Pandoc and LibreOffice through the Eremite Host Adapter.");
} finally { await rm(root, { recursive: true, force: true }); }

async function minimalDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Eremite Host smoke</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
