import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type ExternalToolWorkspace = {
  root: string; inputDir: string; outputDir: string; workDir: string; logsDir: string;
  requestPath: string; responsePath: string;
};

export type ExternalToolProcessResult = { exitCode: number; timedOut: boolean; stdout: string; stderr: string; responseText: string | null };

export async function createExternalToolWorkspace(prefix: string): Promise<ExternalToolWorkspace> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const inputDir = path.join(root, "input"); const outputDir = path.join(root, "output");
  const workDir = path.join(root, "work"); const logsDir = path.join(root, "logs");
  await Promise.all([inputDir, outputDir, workDir, logsDir].map((directory) => mkdir(directory)));
  const rootReal = await realpath(root);
  const [inputDirReal, outputDirReal, workDirReal, logsDirReal] = await Promise.all(
    [inputDir, outputDir, workDir, logsDir].map((directory) => resolveContainedDirectory(rootReal, directory)),
  );
  return {
    root: rootReal,
    inputDir: inputDirReal,
    outputDir: outputDirReal,
    workDir: workDirReal,
    logsDir: logsDirReal,
    requestPath: path.join(rootReal, "request.json"),
    responsePath: path.join(rootReal, "response.json"),
  };
}

export async function runExternalTool(input: {
  cliPath: string; workspace: ExternalToolWorkspace; request: unknown; timeoutMs: number; env?: NodeJS.ProcessEnv;
}): Promise<ExternalToolProcessResult> {
  await writeFile(input.workspace.requestPath, JSON.stringify(input.request, null, 2), { encoding: "utf8", flag: "wx" });
  const args = [input.cliPath, "--protocol", "1", "--request", input.workspace.requestPath, "--response", input.workspace.responsePath];
  const child = spawn(process.execPath, args, { cwd: input.workspace.root, env: input.env ?? minimalExternalToolEnvironment(input.workspace.root), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = []; const stderr: Buffer[] = []; let stdoutBytes = 0; let stderrBytes = 0; let timedOut = false;
  const capture = (target: Buffer[], chunk: Buffer, size: number) => { const remaining = 1024 * 1024 - size; if (remaining > 0) target.push(chunk.subarray(0, remaining)); return size + chunk.length; };
  child.stdout.on("data", (chunk: Buffer) => { stdoutBytes = capture(stdout, chunk, stdoutBytes); });
  child.stderr.on("data", (chunk: Buffer) => { stderrBytes = capture(stderr, chunk, stderrBytes); });
  const timer = setTimeout(() => { timedOut = true; void terminateProcessTree(child.pid); }, input.timeoutMs);
  const exitCode = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("close", (code) => resolve(code ?? 1)); }).finally(() => clearTimeout(timer));
  const responseText = await readFile(input.workspace.responsePath, "utf8").catch(() => null);
  return { exitCode, timedOut, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), responseText };
}

export async function discardExternalToolWorkspace(workspace: ExternalToolWorkspace) {
  await rm(workspace.root, { recursive: true, force: true, maxRetries: 3 });
}

export function minimalExternalToolEnvironment(workspaceRoot: string): NodeJS.ProcessEnv {
  const allowed = ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"];
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production" };
  for (const key of allowed) if (process.env[key]) env[key] = process.env[key];
  env.TEMP = workspaceRoot; env.TMP = workspaceRoot;
  return env;
}

async function resolveContainedDirectory(rootReal: string, directory: string) {
  const info = await stat(directory); const resolved = await realpath(directory); const relative = path.relative(rootReal, resolved);
  if (!info.isDirectory() || !relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("external_workspace_containment_failed");
  return resolved;
}

async function terminateProcessTree(pid?: number) {
  if (!pid) return;
  if (process.platform !== "win32") return;
  await new Promise<void>((resolve) => execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, shell: false }, () => resolve()));
}
