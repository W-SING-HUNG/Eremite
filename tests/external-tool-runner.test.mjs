import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createExternalToolWorkspace, discardExternalToolWorkspace, runExternalTool } from "@/platform/external-tools/request-runner";
import { fileConverterProcessEnvironment } from "@/modules/automations/tools/file-converter/dependencies";

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "eremite-external-runner-test-"));
const fixture = path.join(fixtureRoot, "fixture.mjs");
await writeFile(fixture, `
import { writeFile } from "node:fs/promises";
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
if (process.env.FAKE_MODE === "timeout") setInterval(() => {}, 1000);
else if (process.env.FAKE_MODE === "exit") process.exit(7);
else {
  await writeFile(args.get("--response"), JSON.stringify({ ok: true }));
  process.exit(0);
}
`, "utf8");

try {
  const protectedKey = process.env.EREMITE_AI_API_KEY;
  process.env.EREMITE_AI_API_KEY = "runner-fixture-only-secret";
  try {
    const selected = path.join(fixtureRoot, "selected.exe");
    const env = fileConverterProcessEnvironment(fixtureRoot, { id: "pandoc", executablePath: selected, version: "3.0" });
    assert.equal(env.FFC_PANDOC_PATH, selected); assert.equal(env.FFC_SOFFICE_PATH, undefined);
    assert.equal(env.EREMITE_AI_API_KEY, undefined); assert.equal(env.EREMITE_TOOL_WORKSPACE_DIR, undefined);
    assert.equal(env.TEMP, fixtureRoot); assert.equal(env.TMP, fixtureRoot);
    assert.equal(env.ProgramFiles, path.join(fixtureRoot, "unconfigured-install"));
    assert.equal(env.PATH.split(path.delimiter).every(directory => directory.startsWith(process.env.SystemRoot ?? "C:\\Windows")), true);
  } finally { if (protectedKey === undefined) delete process.env.EREMITE_AI_API_KEY; else process.env.EREMITE_AI_API_KEY = protectedKey; }
  const configured = process.env.EREMITE_TOOL_WORKSPACE_DIR;
  try {
    process.env.EREMITE_TOOL_WORKSPACE_DIR = "relative-root";
    await assert.rejects(() => createExternalToolWorkspace("eremite-runner-"), error => error.code === "external_workspace_root_invalid");
    process.env.EREMITE_TOOL_WORKSPACE_DIR = path.join(fixtureRoot, "does-not-exist");
    await assert.rejects(() => createExternalToolWorkspace("eremite-runner-"), error => error.code === "external_workspace_root_invalid");
  } finally { if (configured === undefined) delete process.env.EREMITE_TOOL_WORKSPACE_DIR; else process.env.EREMITE_TOOL_WORKSPACE_DIR = configured; }
  const completedWorkspace = await createExternalToolWorkspace("eremite-runner-complete-");
  try {
    assert.deepEqual(
      [completedWorkspace.inputDir, completedWorkspace.outputDir, completedWorkspace.workDir, completedWorkspace.logsDir].map((directory) => path.relative(completedWorkspace.root, directory)),
      ["input", "output", "work", "logs"],
      "workspace subdirectories must share the canonical root spelling on Windows",
    );
    const completed = await runExternalTool({ cliPath: fixture, workspace: completedWorkspace, request: { test: true }, timeoutMs: 5_000, env: { NODE_ENV: "test", FAKE_MODE: "complete" } });
    assert.equal(completed.exitCode, 0); assert.equal(completed.timedOut, false); assert.deepEqual(JSON.parse(completed.responseText), { ok: true });
  } finally { await discardExternalToolWorkspace(completedWorkspace); }

  const failedWorkspace = await createExternalToolWorkspace("eremite-runner-failed-");
  try {
    const failed = await runExternalTool({ cliPath: fixture, workspace: failedWorkspace, request: {}, timeoutMs: 5_000, env: { NODE_ENV: "test", FAKE_MODE: "exit" } });
    assert.equal(failed.exitCode, 7); assert.equal(failed.responseText, null);
  } finally { await discardExternalToolWorkspace(failedWorkspace); }

  const timeoutWorkspace = await createExternalToolWorkspace("eremite-runner-timeout-");
  try {
    const timeout = await runExternalTool({ cliPath: fixture, workspace: timeoutWorkspace, request: {}, timeoutMs: 100, env: { NODE_ENV: "test", FAKE_MODE: "timeout" } });
    assert.equal(timeout.timedOut, true); assert.notEqual(timeout.exitCode, 0);
  } finally { await discardExternalToolWorkspace(timeoutWorkspace); }
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log("External tool runner gate passed: request/response, non-zero failure, timeout tree termination and cleanup.");
