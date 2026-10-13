import assert from "node:assert/strict";
import { File } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { makeDocxFixture } from "./viewer-fixtures.mjs";

const root = await mkdtemp(path.join(tmpdir(), "eremite-all-engines-"));
const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
process.env.EREMITE_DATA_DIR = path.join(root, "data");
let database;
try {
  database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const automations = await import("@/modules/automations/service");
  const { acceptedFileConversions } = await import("@/modules/automations/tools/file-converter/authority");
  const { fileConverterFormat } = await import("@/modules/automations/tools/file-converter/contract");
  const { managedFilePath } = await import("@/platform/files/service");
  const { verifyCurrentFiles } = await import("@/platform/backup/service");
  const { uuidv7 } = await import("@/platform/shared/ids");
  const originals = new Map();
  const raster = sharp({ create: { width: 32, height: 24, channels: 3, background: "#3377aa" } });
  for (const format of ["png", "jpeg", "webp", "avif"]) originals.set(format, await raster.clone().toFormat(format).toBuffer());
  originals.set("markdown", Buffer.from("# Stability regression\n\nDefault-only **conversion**.\n"));
  originals.set("html", Buffer.from("<!doctype html><html><head><title>Stability</title></head><body><h1>Stability regression</h1><p>Standalone conversion.</p></body></html>"));
  originals.set("docx", await makeDocxFixture("All-engine stability regression"));
  originals.set("xlsx", await makeSpreadsheet());
  originals.set("pptx", await makePresentation());
  const sources = new Map();
  for (const [format, bytes] of originals) {
    const descriptor = fileConverterFormat(format);
    const id = await inbox.createFileContentItem(new File([bytes], `all-engine${descriptor.extension}`, { type: descriptor.mediaType }));
    sources.set(format, { id, asset: inbox.getFileAssetForViewing(id) });
  }
  const originalVersions = database.all("SELECT * FROM file_versions ORDER BY id");
  const engines = new Map(); let count = 0;
  for (const conversion of acceptedFileConversions) {
    const source = sources.get(conversion.source);
    const result = await automations.executeExternalTool({ operationId: uuidv7(), toolId: "core.file-converter", rawInput: { contentItemId: source.id, conversionId: conversion.id, profile: conversion.defaultProfile } });
    const run = automations.getAutomationRun(result.runId);
    assert.equal(result.status, "completed", `${conversion.id}: ${run.error_code ?? ""}`);
    const output = JSON.parse(run.output_payload_json);
    assert.equal(output.supplier.engine.id, conversion.engine);
    const bytes = await readFile(managedFilePath(inbox.getFileAssetForViewing(output.contentId).storageKey));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), output.sha256);
    assert.equal(bytes.length, output.byteSize);
    assert.equal(database.one("SELECT state FROM file_write_operations WHERE idempotency_key = ?", `automation:${run.id}:output:0`).state, "committed");
    assert.deepEqual(inbox.getFileCreationByIdempotencyKey(`automation:${run.id}:output:0`), { state: "committed", contentId: output.contentId, versionId: output.versionId });
    assert.equal(database.one("SELECT COUNT(*) n FROM file_versions WHERE id = ? AND asset_id = ?", output.versionId, output.assetId).n, 1);
    assert.equal(database.one("SELECT file_asset_id FROM content_items WHERE id = ?", output.contentId).file_asset_id, output.assetId);
    if (conversion.target === "pdf") assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    engines.set(conversion.engine, output.supplier.engine.version); count++;
  }
  for (const [format, source] of sources) {
    assert.deepEqual(await readFile(managedFilePath(source.asset.storageKey)), originals.get(format));
    assert.deepEqual(database.all("SELECT * FROM file_versions WHERE asset_id = ? ORDER BY id", source.asset.assetId), originalVersions.filter(version => version.asset_id === source.asset.assetId));
  }
  assert.equal(count, 18); assert.deepEqual([...engines.keys()].sort(), ["libreoffice", "pandoc", "sharp"]);
  assert.deepEqual(await verifyCurrentFiles(), []);
  assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
  assert.equal((await readdir(process.env.EREMITE_TOOL_WORKSPACE_DIR)).some(name => name.startsWith("et-")), false);
  console.log(`All-engine Host gate PASS: 18/18 default conversions, including 12 image pairs, 3 Pandoc and DOCX/XLSX/PPTX PDF; real versions ${JSON.stringify(Object.fromEntries(engines))}; every output/Receipt, immutable sources/versions, DB/disk consistency and workspace cleanup.`);
} finally { database?.db().close(); await rm(root, { recursive: true, force: true }); }

async function packageParts(parts) {
  const zip = new JSZip(); for (const [name, xml] of Object.entries(parts)) zip.file(name, xml);
  return zip.generateAsync({ type: "nodebuffer" });
}
function rels(body) { return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`; }
function types(body) { return `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${body}</Types>`; }
async function makeSpreadsheet() {
  return packageParts({
    "[Content_Types].xml": types('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'),
    "_rels/.rels": rels(`<Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/>`),
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${office}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": rels(`<Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/>`),
    "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Stability regression</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>',
  });
}
async function makePresentation() {
  return packageParts({
    "[Content_Types].xml": types('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'),
    "_rels/.rels": rels(`<Relationship Id="rId1" Type="${office}/officeDocument" Target="ppt/presentation.xml"/>`),
    "ppt/presentation.xml": `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${office}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels(`<Relationship Id="rId1" Type="${office}/slide" Target="slides/slide1.xml"/>`),
    "ppt/slides/slide1.xml": '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="500000" y="500000"/><a:ext cx="8000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Stability regression</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  });
}
