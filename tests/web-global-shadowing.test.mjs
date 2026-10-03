import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const protectedWebGlobals = new Set(["File", "Image", "FormData", "URL"]);
const sourceFiles = await collectSources(path.join(process.cwd(), "src", "app"));
const collisions = [];

for (const sourceFile of sourceFiles) {
  const source = await readFile(sourceFile, "utf8");
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/gs)) {
    for (const binding of match[1].split(",").map((value) => value.trim()).filter(Boolean)) {
      const [importedName, localName] = binding.replace(/^type\s+/, "").split(/\s+as\s+/);
      if (protectedWebGlobals.has(importedName) && (!localName || localName === importedName)) {
        collisions.push(`${path.relative(process.cwd(), sourceFile)} imports ${importedName} without an explicit alias`);
      }
    }
  }
  for (const match of source.matchAll(/import\s+(?:type\s+)?(File|Image|FormData|URL)\s+from\s+["'][^"']+["']/g)) {
    collisions.push(`${path.relative(process.cwd(), sourceFile)} default-imports ${match[1]}`);
  }
}

assert.deepEqual(collisions, [], `Web platform globals must not be shadowed:\n${collisions.join("\n")}`);
console.log("Web global shadowing test passed: File, Image, FormData and URL remain unshadowed across src/app.");

async function collectSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSources(target);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}
