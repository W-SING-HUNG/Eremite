import assert from "node:assert/strict";
import { File } from "node:buffer";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { makeDocxFixture } from "./viewer-fixtures.mjs";
import { createExternalToolWorkspace, discardExternalToolWorkspace } from "@/platform/external-tools/request-runner";

const inherited = process.env.EREMITE_TOOL_WORKSPACE_DIR;
const root = await mkdtemp(path.join(tmpdir(), "eremite-lo-root-"));
const shortBase = path.join(inherited ?? root, "w"); await mkdir(shortBase);
process.env.EREMITE_DATA_DIR = path.join(root, "data");
let database;
try {
  delete process.env.EREMITE_TOOL_WORKSPACE_DIR;
  const defaultWorkspace = await createExternalToolWorkspace("eremite-file-converter-");
  assert.equal(path.dirname(defaultWorkspace.root).toLowerCase(), tmpdir().toLowerCase());
  assert.ok(path.basename(defaultWorkspace.root).startsWith("eremite-file-converter-"));
  await discardExternalToolWorkspace(defaultWorkspace);
  const entries = await readdir(shortBase);
  process.env.EREMITE_TOOL_WORKSPACE_DIR = "relative-workspace";
  await assert.rejects(() => createExternalToolWorkspace("eremite-file-converter-"), error => error.code === "external_workspace_root_invalid");
  process.env.EREMITE_TOOL_WORKSPACE_DIR = path.join(root, "missing");
  await assert.rejects(() => createExternalToolWorkspace("eremite-file-converter-"));
  const junction = path.join(root, "redirect"); await symlink(shortBase, junction, "junction");
  process.env.EREMITE_TOOL_WORKSPACE_DIR = junction;
  await assert.rejects(() => createExternalToolWorkspace("eremite-file-converter-"));
  assert.deepEqual(await readdir(shortBase), entries, "invalid roots never fall back or create redirected workspaces");
  process.env.EREMITE_TOOL_WORKSPACE_DIR = shortBase;
  const one = await createExternalToolWorkspace("eremite-file-converter-");
  const two = await createExternalToolWorkspace("eremite-file-converter-");
  assert.notEqual(one.root, two.root);
  assert.equal(path.dirname(one.root).toLowerCase(), shortBase.toLowerCase());
  assert.ok(path.basename(one.root).length <= 10, "configured root uses a short private name");
  await discardExternalToolWorkspace(one); await discardExternalToolWorkspace(two);

  database = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const automations = await import("@/modules/automations/service");
  const { managedFilePath } = await import("@/platform/files/service");
  const { uuidv7 } = await import("@/platform/shared/ids");
  const bytes = await makeDocxFixture("Real LibreOffice workspace regression");
  const id = await inbox.createFileContentItem(new File([bytes], "root.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  const source = inbox.getFileAssetForViewing(id);
  const versions = database.all("SELECT * FROM file_versions ORDER BY id");
  const input = { contentItemId: id, conversionId: "docx-to-pdf", profile: "standard" };
  process.env.EREMITE_TOOL_WORKSPACE_DIR = "invalid-config";
  const invalid = await automations.executeExternalTool({ operationId: uuidv7(), toolId: "core.file-converter", rawInput: input });
  const invalidRun = automations.getAutomationRun(invalid.runId);
  assert.equal(invalidRun.error_code, "host_workspace_unavailable");
  assert.equal(invalidRun.error_message.includes(root), false);
  assert.equal(database.one("SELECT COUNT(*) n FROM file_write_operations WHERE idempotency_key LIKE ?", `automation:${invalid.runId}:output:%`).n, 0);
  // First reproduce the native failure with an explicitly long root; no threshold is assumed universal.
  const longBase = path.join(root, "long-" + "x".repeat(90)); await mkdir(longBase);
  process.env.EREMITE_TOOL_WORKSPACE_DIR = longBase;
  const failed = await automations.executeExternalTool({ operationId: uuidv7(), toolId: "core.file-converter", rawInput: input });
  assert.equal(failed.status, "failed");
  const parent = database.one("SELECT * FROM automation_runs WHERE id = ?", failed.runId);
  assert.ok(["FC_ENGINE_FAILED", "FC_TIMEOUT"].includes(parent.error_code), `real long-path failure must be an engine failure or timeout, got ${parent.error_code}`);
  await assertNoOfficeProcess();
  assert.equal(database.one("SELECT COUNT(*) n FROM automation_run_outputs WHERE run_id = ?", failed.runId).n, 0);
  assert.equal(database.one("SELECT COUNT(*) n FROM file_write_operations WHERE idempotency_key LIKE ?", `automation:${failed.runId}:output:%`).n, 0);
  assert.deepEqual(database.all("SELECT * FROM file_versions ORDER BY id"), versions);
  assert.deepEqual(await readdir(longBase), []);

  process.env.EREMITE_TOOL_WORKSPACE_DIR = shortBase;
  const recovered = await automations.retryExternalTool(failed.runId);
  assert.equal(recovered.status, "completed");
  const child = automations.getAutomationRun(recovered.runId);
  assert.equal(child.retry_of_run_id, failed.runId);
  assert.equal(child.input_payload_json, parent.input_payload_json);
  assert.deepEqual(database.one("SELECT * FROM automation_runs WHERE id = ?", failed.runId), parent);
  const output = JSON.parse(child.output_payload_json);
  const profileLength = base => path.join(base, "et-XXXXXX", "work", child.id, "work", "lo-profile").length;
  console.log(`Real LibreOffice ${output.supplier.engine.version}: failed Profile length ${profileLength(longBase)}, successful configured length ${profileLength(shortBase)}.`);
  const pdf = await readFile(managedFilePath(inbox.getFileAssetForViewing(output.contentId).storageKey));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(createHash("sha256").update(pdf).digest("hex"), output.sha256);
  assert.equal(database.one("SELECT state FROM file_write_operations WHERE idempotency_key = ?", `automation:${child.id}:output:0`).state, "committed");
  assert.equal((await automations.retryExternalTool(failed.runId)).runId, child.id);
  assert.deepEqual(await readFile(managedFilePath(source.storageKey)), bytes);
  assert.deepEqual(await readdir(shortBase), []);
  await assertNoOfficeProcess();
  assert.equal(database.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(database.all("PRAGMA foreign_key_check"), []);
  console.log("Workspace gate passed: invalid/junction roots rejected, private short root, real long-root LibreOffice failure -> short-root Retry PDF/receipt, immutable parent/source and cleanup. Default arbitrary long paths are not claimed fixed.");
} finally {
  database?.db().close();
  if (inherited === undefined) delete process.env.EREMITE_TOOL_WORKSPACE_DIR; else process.env.EREMITE_TOOL_WORKSPACE_DIR = inherited;
  await rm(root, { recursive: true, force: true }); await rm(shortBase, { recursive: true, force: true });
}

async function assertNoOfficeProcess() {
  const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: path.join(process.env.SystemRoot, "System32"), TEMP: process.env.TEMP, TMP: process.env.TMP, EREMITE_QA_PROCESS_MARKER: path.basename(root) };
  const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='soffice.bin' OR Name='soffice.exe' OR Name='soffice.com'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:EREMITE_QA_PROCESS_MARKER) } | Select-Object -ExpandProperty ProcessId"], { windowsHide: true, shell: false, timeout: 10_000, encoding: "utf8", env });
  assert.equal(stdout.trim(), "", "no LibreOffice process from this QA invocation may survive failure/recovery");
}
