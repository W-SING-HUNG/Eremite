import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire, findPackageJSON } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PDF_TOOLS_PACKAGE_NAME,
  PDF_TOOLS_PACKAGE_VERSION,
  PDF_TOOLS_SCHEMA_SHA256,
  PDF_TOOLS_QPDF_VERSION,
  pdfToolsCanonicalContract,
} from "@/modules/automations/tools/pdf-tools/authority";

export type InstalledPdfTools = {
  packageRoot: string;
  packageVersion: string;
  cliPath: string;
  contractPath: string;
  qpdfPath: string;
  qpdfVersion: string;
  qpdfSha256: string;
};

let installedCache: Promise<InstalledPdfTools> | undefined;

export function resolveInstalledPdfTools() {
  return installedCache ??= inspectInstalledPdfTools();
}

export function clearInstalledPdfToolsCacheForTests() {
  installedCache = undefined;
}

async function inspectInstalledPdfTools(): Promise<InstalledPdfTools> {
  const locatedManifest = findPackageJSON(PDF_TOOLS_PACKAGE_NAME, pathToFileURL(path.join(process.cwd(), "package.json")).href);
  if (!locatedManifest) throw new Error("pdf_tools_package_missing");
  const manifestPath = await realpath(locatedManifest);
  const packageRoot = path.dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: string; version?: string; bin?: Record<string, string> };
  if (manifest.name !== PDF_TOOLS_PACKAGE_NAME || manifest.version !== PDF_TOOLS_PACKAGE_VERSION) throw new Error("pdf_tools_installed_identity_invalid");
  const bin = manifest.bin?.[PDF_TOOLS_PACKAGE_NAME];
  if (!bin) throw new Error("pdf_tools_cli_missing");
  const cliPath = await assertInstalledFile(packageRoot, path.join(packageRoot, bin));
  const contractPath = await assertInstalledFile(packageRoot, path.join(packageRoot, "schema", "supplier-protocol-v1.schema.json"));
  const contractBytes = await readFile(contractPath);
  if (createHash("sha256").update(contractBytes).digest("hex") !== PDF_TOOLS_SCHEMA_SHA256) throw new Error("pdf_tools_installed_contract_drift");
  const installedContract = JSON.parse(contractBytes.toString("utf8"));
  if (JSON.stringify(installedContract) !== JSON.stringify(pdfToolsCanonicalContract)) throw new Error("pdf_tools_installed_contract_drift");
  // rc5 owns PATH resolution/version probing. qpdf is not package content.
  const engineRuntimePath = await assertInstalledFile(packageRoot, path.join(packageRoot, "dist", "engine", "runtime.js"));
  // Use Node's package loader so the production bundler cannot rewrite this
  // absolute installed ESM path into a dynamic bundle import context.
  const engineRuntime = createRequire(path.join(packageRoot, "package.json"))(engineRuntimePath) as {
    resolveQpdfExecutable(): string | null;
    verifyQpdfVersion(timeoutMs: number, executable: string): Promise<string | null>;
  };
  const qpdfPath = engineRuntime.resolveQpdfExecutable();
  if (!qpdfPath || await engineRuntime.verifyQpdfVersion(10_000, qpdfPath) !== null) {
    throw new Error("pdf_tools_external_qpdf_unavailable");
  }
  const qpdfSha256 = createHash("sha256").update(await readFile(qpdfPath)).digest("hex");
  return { packageRoot, packageVersion: manifest.version, cliPath, contractPath, qpdfPath, qpdfVersion: PDF_TOOLS_QPDF_VERSION, qpdfSha256 };
}

async function assertInstalledFile(packageRoot: string, candidate: string) {
  const resolvedRoot = await realpath(packageRoot);
  const resolved = await realpath(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !(await stat(resolved)).isFile()) throw new Error("pdf_tools_installed_path_invalid");
  return resolved;
}
