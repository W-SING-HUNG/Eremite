import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDF_TOOLS_QPDF_VERSION } from "@/modules/automations/tools/pdf-tools/authority";
import { resolveInstalledPdfTools } from "@/modules/automations/tools/pdf-tools/runtime";

export type PdfToolsAvailability = {
  available: boolean;
  node: { status: "ready" | "unavailable"; version: string };
  package: { status: "ready" | "unavailable"; version: string | null };
  qpdf: { status: "ready" | "unavailable"; version: string | null };
  checkedAt: string;
};

const execFileAsync = promisify(execFile);
let cache: { expires: number; value: Promise<PdfToolsAvailability> } | undefined;

export function getPdfToolsAvailability(force = false) {
  if (!force && cache && cache.expires > Date.now()) return cache.value;
  const value = probeAvailability();
  cache = { expires: Date.now() + 60_000, value };
  return value;
}

async function probeAvailability(): Promise<PdfToolsAvailability> {
  const version = process.versions.node;
  const [major, minor] = version.split(".").map(Number);
  const checkedAt = new Date().toISOString();
  const nodeReady = process.platform === "win32" && process.arch === "x64" && major === 24 && minor >= 15;
  if (!nodeReady) return {
    available: false,
    node: { status: "unavailable", version },
    package: { status: "unavailable", version: null },
    qpdf: { status: "unavailable", version: null },
    checkedAt,
  };
  try {
    const installed = await resolveInstalledPdfTools();
    const { stdout, stderr } = await execFileAsync(installed.qpdfPath, ["--version"], {
      timeout: 10_000,
      windowsHide: true,
      shell: false,
      encoding: "utf8",
      env: { NODE_ENV: "production", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR },
    });
    const match = `${stdout}\n${stderr}`.match(/qpdf\s+version\s+([0-9.]+)/iu);
    const qpdfReady = match?.[1] === PDF_TOOLS_QPDF_VERSION;
    return {
      available: qpdfReady,
      node: { status: "ready", version },
      package: { status: "ready", version: installed.packageVersion },
      qpdf: { status: qpdfReady ? "ready" : "unavailable", version: match?.[1] ?? null },
      checkedAt,
    };
  } catch {
    return {
      available: false,
      node: { status: "ready", version },
      package: { status: "unavailable", version: null },
      qpdf: { status: "unavailable", version: null },
      checkedAt,
    };
  }
}
