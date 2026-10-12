import { readFile, realpath, stat } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileConverterCanonicalContract, FILE_CONVERTER_PACKAGE_NAME, FILE_CONVERTER_PACKAGE_VERSION } from "@/modules/automations/tools/file-converter/authority";

export type InstalledFileConverter = { packageRoot: string; cliPath: string; nativeHelperPath: string; packageVersion: string };

let installedCache: Promise<InstalledFileConverter> | undefined;

export function resolveInstalledFileConverter(force = false) {
  if (force) installedCache = undefined;
  return installedCache ??= inspectInstalledFileConverter();
}

export function clearInstalledFileConverterCacheForTests() {
  installedCache = undefined;
}

async function inspectInstalledFileConverter(): Promise<InstalledFileConverter> {
  const locatedManifest = findPackageJSON(FILE_CONVERTER_PACKAGE_NAME, pathToFileURL(path.join(process.cwd(), "package.json")).href);
  if (!locatedManifest) throw new Error("file_converter_package_missing");
  const manifestPath = await realpath(locatedManifest);
  const packageRoot = path.dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: string; version?: string; bin?: Record<string, string> };
  if (manifest.name !== FILE_CONVERTER_PACKAGE_NAME || manifest.version !== FILE_CONVERTER_PACKAGE_VERSION) throw new Error("file_converter_installed_identity_invalid");
  const bin = manifest.bin?.["file-converter-core"];
  if (!bin) throw new Error("file_converter_cli_missing");
  const cliPath = await assertInstalledFile(packageRoot, path.join(packageRoot, bin));
  const nativeHelperPath = await assertInstalledFile(packageRoot, path.join(packageRoot, "dist", "native", "bin", "fc-movefile.exe"));
  const installedContract = JSON.parse(await readFile(path.join(packageRoot, "tool-contract.json"), "utf8"));
  if (JSON.stringify(installedContract) !== JSON.stringify(fileConverterCanonicalContract)) throw new Error("file_converter_installed_contract_drift");
  return { packageRoot, cliPath, nativeHelperPath, packageVersion: manifest.version };
}

async function assertInstalledFile(packageRoot: string, candidate: string) {
  const resolvedRoot = await realpath(packageRoot);
  const resolved = await realpath(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !(await stat(resolved)).isFile()) throw new Error("file_converter_installed_path_invalid");
  return resolved;
}
