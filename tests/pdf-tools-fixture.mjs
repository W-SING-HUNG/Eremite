import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

export async function writePdfFixture(file, pages) {
  const pageIds = pages.map((_, index) => 3 + index * 2);
  const contentIds = pages.map((_, index) => 4 + index * 2);
  const fontId = 3 + pages.length * 2;
  const objects = new Map([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`],
  ]);
  pages.forEach((page, index) => {
    const rotate = page.rotate ? ` /Rotate ${page.rotate}` : "";
    objects.set(pageIds[index], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}]${rotate} /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`);
    const stream = `BT /F1 24 Tf 36 72 Td (${page.label}) Tj ET`;
    objects.set(contentIds[index], `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects.set(fontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const chunks = [Buffer.from("%PDF-1.4\n%HOST\n", "ascii")];
  const offsets = [0];
  let length = chunks[0].length;
  for (let id = 1; id <= fontId; id += 1) {
    offsets[id] = length;
    const chunk = Buffer.from(`${id} 0 obj\n${objects.get(id)}\nendobj\n`, "ascii");
    chunks.push(chunk);
    length += chunk.length;
  }
  const xrefAt = length;
  let tail = `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= fontId; id += 1) tail += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  tail += `trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  chunks.push(Buffer.from(tail, "ascii"));
  await writeFile(file, Buffer.concat(chunks));
}

export function inspectPdf(qpdfPath, file) {
  const result = spawnSync(qpdfPath, ["--json", file], { shell: false, windowsHide: true, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  const objects = new Map();
  collectObjects(parsed, objects);
  return parsed.pages.map((page) => {
    const value = objects.get(`obj:${page.object}`);
    assert.ok(value);
    const box = value["/MediaBox"];
    return {
      width: Number(box[2]) - Number(box[0]),
      height: Number(box[3]) - Number(box[1]),
      rotation: ((Number(value["/Rotate"] ?? 0) % 360) + 360) % 360,
    };
  });
}

export const pdfSignatures = (qpdfPath, file) => inspectPdf(qpdfPath, file).map((page) => `${page.width}x${page.height}@${page.rotation}`);

function collectObjects(node, output) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((value) => collectObjects(value, output));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("obj:") && value?.value && typeof value.value === "object") output.set(key, value.value);
    collectObjects(value, output);
  }
}
