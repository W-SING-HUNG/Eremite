import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveInstalledFileConverter } from "@/modules/automations/tools/file-converter/runtime";
import type { FileConverterEngineId } from "@/modules/automations/tools/file-converter/authority";

export type DependencyReadiness = { id: FileConverterEngineId; status: "ready" | "unknown"; version: string | null };
export type FileConverterAvailability = { available: boolean; node: { status: "ready" | "unavailable"; version: string }; engines: DependencyReadiness[]; checkedAt: string };

const execFileAsync = promisify(execFile);
let cache: { expires: number; value: Promise<FileConverterAvailability> } | undefined;

export function getFileConverterAvailability(force = false) {
  if (!force && cache && cache.expires > Date.now()) return cache.value;
  const value = probeAvailability(); cache = { expires: Date.now() + 60_000, value }; return value;
}

async function probeAvailability(): Promise<FileConverterAvailability> {
  const version = process.versions.node;
  const major = Number(version.split(".")[0]); const minor = Number(version.split(".")[1]);
  const nodeReady = process.platform === "win32" && process.arch === "x64" && major === 24 && minor >= 15;
  if (!nodeReady) return { available: false, node: { status: "unavailable", version }, engines: [{ id: "sharp", status: "unknown", version: null }, { id: "pandoc", status: "unknown", version: null }, { id: "libreoffice", status: "unknown", version: null }], checkedAt: new Date().toISOString() };
  let installed;
  try { installed = await resolveInstalledFileConverter(); } catch { return { available: false, node: { status: "ready", version }, engines: [], checkedAt: new Date().toISOString() }; }
  const [sharp, pandoc, libreoffice] = await Promise.all([probeSharp(installed.packageRoot), probeExecutable("pandoc", pandocCandidates(), /pandoc\s+([\d.]+)/iu), probeExecutable("libreoffice", libreOfficeCandidates(), /LibreOffice\s+([\d.]+)/iu)]);
  return { available: true, node: { status: "ready", version }, engines: [sharp, pandoc, libreoffice], checkedAt: new Date().toISOString() };
}

async function probeSharp(packageRoot: string): Promise<DependencyReadiness> {
  try {
    const requireFromPackage = createRequire(path.join(packageRoot, "package.json"));
    let current = path.dirname(requireFromPackage.resolve("sharp"));
    while (path.dirname(current) !== current) {
      const manifestPath = path.join(current, "package.json");
      if ((await stat(manifestPath).catch(() => null))?.isFile()) {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: string; version?: string };
        if (manifest.name === "sharp") return { id: "sharp", status: "ready", version: manifest.version ?? null };
      }
      current = path.dirname(current);
    }
  } catch {}
  return { id: "sharp", status: "unknown", version: null };
}

async function probeExecutable(id: "pandoc" | "libreoffice", candidates: string[], pattern: RegExp): Promise<DependencyReadiness> {
  for (const candidate of candidates) {
    try {
      const { stdout, stderr } = await execFileAsync(candidate, ["--version"], { timeout: 10_000, windowsHide: true, shell: false, encoding: "utf8", env: process.env });
      const match = `${stdout}\n${stderr}`.match(pattern);
      if (match) return { id, status: "ready", version: match[1] ?? null };
    } catch {}
  }
  return { id, status: "unknown", version: null };
}

function pandocCandidates() {
  return [path.join(process.env.LOCALAPPDATA ?? "", "Pandoc", "pandoc.exe"), path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Pandoc", "pandoc.exe"), "pandoc.exe"];
}
function libreOfficeCandidates() {
  return [path.join(process.env.ProgramFiles ?? "C:\\Program Files", "LibreOffice", "program", "soffice.com"), path.join(process.env.ProgramFiles ?? "C:\\Program Files", "LibreOffice", "program", "soffice.exe"), path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "LibreOffice", "program", "soffice.com"), "soffice.com", "soffice.exe"];
}
