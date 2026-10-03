import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nextArguments } from "./next-listen-policy.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDirectory);
const requestedCommand = process.argv[2];
const forwardedArguments = process.argv.slice(3);

if (!["dev", "build", "start"].includes(requestedCommand)) {
  throw new Error(`Unsupported Next command: ${requestedCommand ?? "missing"}`);
}
const validatedArguments = nextArguments(requestedCommand, forwardedArguments);

if (realpathSync(process.cwd()) !== realpathSync(projectRoot)) {
  throw new Error(`Eremite must be started from ${projectRoot}. Current directory: ${process.cwd()}`);
}

const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
const projectNodeModulesRoot = realpathSync(path.join(projectRoot, "node_modules"));

for (const packageName of ["next", "react", "react-dom"]) {
  const packageJsonPath = realpathSync(requireFromProject.resolve(`${packageName}/package.json`));
  const expectedPackageRoot = realpathSync(path.join(projectRoot, "node_modules", packageName));
  if (!expectedPackageRoot.startsWith(`${projectNodeModulesRoot}${path.sep}`)) {
    throw new Error(`${packageName} is linked outside Eremite: ${expectedPackageRoot}`);
  }
  if (packageJsonPath !== path.join(expectedPackageRoot, "package.json")) {
    throw new Error(`${packageName} resolves outside Eremite: ${packageJsonPath}`);
  }
}

const nextBinary = requireFromProject.resolve("next/dist/bin/next");
const nextOutputDirectory = requestedCommand === "dev" ? ".next-dev" : ".next";
const buildDataDirectory = requestedCommand === "build" ? mkdtempSync(path.join(tmpdir(), "eremite-build-data-")) : undefined;
let result;
try {
  result = spawnSync(process.execPath, [nextBinary, ...validatedArguments], {
    cwd: projectRoot,
    env: {
      ...process.env,
      EREMITE_NEXT_DIST_DIR: nextOutputDirectory,
      ...(buildDataDirectory ? { EREMITE_DATA_DIR: buildDataDirectory } : {}),
    },
    stdio: "inherit",
  });
} finally {
  if (buildDataDirectory) rmSync(buildDataDirectory, { recursive: true, force: true });
}

if (result.error) throw result.error;
process.exit(result.status ?? 1);
