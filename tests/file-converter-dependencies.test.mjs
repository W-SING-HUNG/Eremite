import assert from "node:assert/strict";
import { File } from "node:buffer";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeDocxFixture } from "./viewer-fixtures.mjs";

const root = await mkdtemp(path.join(tmpdir(), "eremite-dependencies-"));
process.env.EREMITE_DATA_DIR = path.join(root, "data");
const keys = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA", "PATH", "FFC_SOFFICE_PATH", "FFC_PANDOC_PATH", "EREMITE_AI_API_KEY"];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let database;
try {
  const candidates = [saved.FFC_SOFFICE_PATH, path.join(saved.ProgramFiles ?? "C:\\Program Files", "LibreOffice", "program", "soffice.com"), "D:\\Program Files\\LibreOffice\\program\\soffice.com", "D:\\Tools\\LibreOffice\\program\\soffice.com"].filter(Boolean);
  let soffice; for (const candidate of candidates) if ((await stat(candidate).catch(() => null))?.isFile()) { soffice = candidate; break; }
  assert.ok(soffice, "real installed LibreOffice is required (C: and D: candidates checked)");
  const originalPandoc = path.join(saved.LOCALAPPDATA, "Pandoc", "pandoc.exe");
  assert.ok((await stat(originalPandoc)).isFile());
  database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const automations = await import("@/modules/automations/service");
  const { getFileConverterAvailability } = await import("@/modules/automations/tools/file-converter/availability");
  const { uuidv7 } = await import("@/platform/shared/ids");
  const { managedFilePath } = await import("@/platform/files/service");
  const docx = await makeDocxFixture("PATH-only real LibreOffice");
  const docxId = await inbox.createFileContentItem(new File([docx], "dependency.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  process.env.ProgramFiles = path.join(root, "no-standard64");
  process.env["ProgramFiles(x86)"] = path.join(root, "no-standard32");
  process.env.LOCALAPPDATA = path.join(root, "no-user-install");
  process.env.PATH = path.dirname(soffice) + ";" + path.join(process.env.SystemRoot, "System32");
  delete process.env.FFC_SOFFICE_PATH; delete process.env.FFC_PANDOC_PATH;
  process.env.EREMITE_AI_API_KEY = "fixture-only-not-a-real-key";
  const availability = await getFileConverterAvailability(true);
  assert.equal(availability.engines.find(engine => engine.id === "libreoffice").status, "ready");
  const run = await automations.executeExternalTool({ operationId: uuidv7(), toolId: "core.file-converter", rawInput: { contentItemId: docxId, conversionId: "docx-to-pdf" } });
  assert.equal(run.status, "completed", "Host ready and formal execution must use the same PATH-discovered real executable");
  assert.equal(JSON.stringify(availability).includes(path.dirname(soffice)), false);
  const { resolveFileConverterExecutable, fileConverterProcessEnvironment } = await import("@/modules/automations/tools/file-converter/dependencies");
  const resolved = await resolveFileConverterExecutable("libreoffice");
  assert.equal(resolved.executablePath.toLowerCase(), soffice.toLowerCase());
  const env = fileConverterProcessEnvironment(root, resolved);
  assert.equal(env.FFC_SOFFICE_PATH, resolved.executablePath);
  assert.equal(env.EREMITE_AI_API_KEY, undefined);
  assert.equal(env.EREMITE_TOOL_WORKSPACE_DIR, undefined);
  assert.equal(env.TEMP, root); assert.equal(env.TMP, root);
  assert.equal(env.PATH.includes(path.dirname(soffice)), false, "fallback discovery cannot substitute another engine from the Host PATH");

  // Real self-contained Pandoc copied only into a disposable D: directory with spaces/Unicode.
  const engineDir = path.join(root, "engine space 中文"); await mkdir(engineDir);
  const copiedPandoc = path.join(engineDir, "pandoc.exe"); await copyFile(originalPandoc, copiedPandoc);
  process.env.FFC_PANDOC_PATH = copiedPandoc;
  process.env.PATH = path.join(process.env.SystemRoot, "System32");
  const markdown = Buffer.from("# Explicit dependency\n\nReal Pandoc regression.\n");
  const mdId = await inbox.createFileContentItem(new File([markdown], "dependency.md", { type: "text/markdown" }));
  assert.equal((await getFileConverterAvailability(true)).engines.find(engine => engine.id === "pandoc").status, "ready");
  assert.equal((await resolveFileConverterExecutable("pandoc")).executablePath.toLowerCase(), copiedPandoc.toLowerCase());
  const converted = await automations.executeExternalTool({ operationId: uuidv7(), toolId: "core.file-converter", rawInput: { contentItemId: mdId, conversionId: "markdown-to-html" } });
  assert.equal(converted.status, "completed");
  const convertedOutput = JSON.parse(automations.getAutomationRun(converted.runId).output_payload_json);
  const html = await readFile(managedFilePath(inbox.getFileAssetForViewing(convertedOutput.contentId).storageKey), "utf8");
  assert.match(html, /Explicit dependency/u);
  assert.equal(html.includes("fixture-only-not-a-real-key"), false);

  await rm(copiedPandoc);
  const unavailable = await automations.executeExternalTool({ operationId: uuidv7(), toolId: "core.file-converter", rawInput: { contentItemId: mdId, conversionId: "markdown-to-html" } });
  assert.equal(unavailable.status, "failed");
  const parent = database.one("SELECT * FROM automation_runs WHERE id = ?", unavailable.runId);
  assert.equal(parent.error_code, "host_dependency_unavailable");
  assert.equal(parent.error_message.includes(root), false);
  assert.equal(database.one("SELECT COUNT(*) n FROM file_write_operations WHERE idempotency_key LIKE ?", `automation:${unavailable.runId}:output:%`).n, 0);
  await copyFile(originalPandoc, copiedPandoc);
  const retry = await automations.retryExternalTool(unavailable.runId);
  assert.equal(retry.status, "completed");
  assert.deepEqual(database.one("SELECT * FROM automation_runs WHERE id = ?", unavailable.runId), parent);
  const retryOutput = JSON.parse(automations.getAutomationRun(retry.runId).output_payload_json);
  assert.equal(retryOutput.sha256, convertedOutput.sha256);
  for (const id of [run.runId, converted.runId, retry.runId]) assert.equal(database.one("SELECT state FROM file_write_operations WHERE idempotency_key = ?", `automation:${id}:output:0`).state, "committed");
  assert.deepEqual(await readFile(managedFilePath(inbox.getFileAssetForViewing(docxId).storageKey)), docx);
  assert.deepEqual(await readFile(managedFilePath(inbox.getFileAssetForViewing(mdId).storageKey)), markdown);
  assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
  assert.equal((await readdir(process.env.EREMITE_TOOL_WORKSPACE_DIR)).some(name => name.startsWith("et-")), false);
  console.log("Dependency gate passed: real PATH-only LibreOffice, explicit D: Pandoc with spaces/Unicode, pinned executable/minimal secret-free environment, missing dependency -> Retry recovery, receipts/source/history and cleanup.");
} finally {
  for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  database?.db().close(); await rm(root, { recursive: true, force: true });
}
