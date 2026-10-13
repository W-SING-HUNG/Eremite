import "server-only";

import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { minimalExternalToolEnvironment } from "@/platform/external-tools/request-runner";

type ExecutableEngine = "pandoc" | "libreoffice";
export type FileConverterExecutable = { id: ExecutableEngine; executablePath: string; version: string };
const execFileAsync = promisify(execFile);

/** Server-only resolution shared by readiness and each formal invocation; no cached paths. */
export async function resolveFileConverterExecutable(id: ExecutableEngine): Promise<FileConverterExecutable | null> {
  const candidates = id === "pandoc"
    ? [process.env.FFC_PANDOC_PATH, process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Pandoc", "pandoc.exe") : undefined, path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Pandoc", "pandoc.exe")]
    : [process.env.FFC_SOFFICE_PATH, path.join(process.env.ProgramFiles ?? "C:\\Program Files", "LibreOffice", "program", "soffice.com"), path.join(process.env.ProgramFiles ?? "C:\\Program Files", "LibreOffice", "program", "soffice.exe"), path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "LibreOffice", "program", "soffice.com")];
  const env = minimalExternalToolEnvironment(tmpdir());
  const names = id === "pandoc" ? ["pandoc.exe"] : ["soffice.com", "soffice.exe"];
  for (const name of names) {
    try {
      const { stdout } = await execFileAsync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe"), [name], { timeout: 3_000, windowsHide: true, shell: false, encoding: "utf8", maxBuffer: 256 * 1024, env });
      candidates.push(...stdout.split(/\r?\n/u).filter(Boolean));
    } catch { /* absence from PATH is not evidence that standard/explicit installs are absent */ }
  }
  for (const candidate of new Set(candidates.filter((value): value is string => Boolean(value)))) {
    try {
      if (!path.isAbsolute(candidate) || candidate.startsWith("\\\\")) continue;
      const info = await lstat(candidate);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      const executablePath = await realpath(candidate);
      const probeEnv = fileConverterProcessEnvironment(tmpdir(), { id, executablePath, version: "" });
      const options = { timeout: 10_000, windowsHide: true, shell: false as const, encoding: "utf8" as const, maxBuffer: 256 * 1024, env: probeEnv };
      const { stdout, stderr } = await execFileAsync(executablePath, ["--version"], options);
      const pattern = id === "pandoc" ? /pandoc\s+([\d.]+)/iu : /LibreOffice\s+([\d.]+)/iu;
      const version = `${stdout}\n${stderr}`.match(pattern)?.[1];
      if (!version) continue;
      if (id === "pandoc") {
        const help = await execFileAsync(executablePath, ["--help"], options);
        if (!/--sandbox/u.test(help.stdout)) continue;
      } else {
        // Match the accepted Supplier's existing version predicate; do not broaden it here.
        const [major, minor] = version.split("."); const majorMinor = Number(`${major}.${minor}`);
        if (!(majorMinor >= 24 || (majorMinor >= 7.6 && majorMinor < 10))) continue;
      }
      return { id, executablePath, version };
    } catch { /* invalid or unusable candidates remain unknown, without raw diagnostics */ }
  }
  return null;
}

/** Pin the selected executable through the Supplier's existing environment hook. */
export function fileConverterProcessEnvironment(workspaceRoot: string, dependency: FileConverterExecutable) {
  const env = minimalExternalToolEnvironment(workspaceRoot);
  env[dependency.id === "libreoffice" ? "FFC_SOFFICE_PATH" : "FFC_PANDOC_PATH"] = dependency.executablePath;
  // If the pinned executable disappears, Supplier discovery must not substitute a different install.
  const undiscovered = path.join(workspaceRoot, "unconfigured-install");
  env.ProgramFiles = undiscovered; env["ProgramFiles(x86)"] = undiscovered; env.LOCALAPPDATA = undiscovered;
  const systemRoot = env.SystemRoot ?? "C:\\Windows";
  env.PATH = [path.join(systemRoot, "System32"), path.join(systemRoot, "SysWOW64")].join(path.delimiter);
  return env;
}
