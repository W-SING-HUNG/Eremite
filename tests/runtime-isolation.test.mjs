import assert from "node:assert/strict";
import { realpath, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const projectRoot = process.cwd();
const requireFromProject = createRequire(path.join(projectRoot, "package.json"));

for (const packageName of ["next", "react", "react-dom", "typescript"]) {
  const resolvedPackage = await realpath(requireFromProject.resolve(`${packageName}/package.json`));
  const localPackageRoot = await realpath(path.join(projectRoot, "node_modules", packageName));
  assert.equal(resolvedPackage, path.join(localPackageRoot, "package.json"), `${packageName} must resolve from Eremite/node_modules`);
  assert.ok(localPackageRoot.startsWith(`${await realpath(path.join(projectRoot, "node_modules"))}${path.sep}`), `${packageName} must not resolve through another project`);
}

const lockfile = JSON.parse(await readFile(path.join(projectRoot, "package-lock.json"), "utf8"));
for (const [packagePath, metadata] of Object.entries(lockfile.packages)) {
  assert.equal(packagePath.startsWith(".."), false, `lockfile contains an external package path: ${packagePath}`);
  assert.notEqual(metadata.link, true, `lockfile contains a linked package: ${packagePath}`);
}

const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
for (const command of ["dev", "build", "start"]) {
  assert.equal(packageJson.scripts[command], `node scripts/run-next.mjs ${command}`);
}

const nextConfig = await readFile(path.join(projectRoot, "next.config.ts"), "utf8");
assert.match(nextConfig, /EREMITE_NEXT_DIST_DIR/);
assert.match(nextConfig, /\.next-dev/);

console.log("Runtime and dependency isolation test passed.");
