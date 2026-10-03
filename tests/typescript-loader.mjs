import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const sourceRoot = process.cwd();

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === "server-only") {
    return {
      url: pathToFileURL(path.join(sourceRoot, "node_modules", "next", "dist", "compiled", "server-only", "empty.js")).href,
      shortCircuit: true,
    };
  }
  if (!specifier.startsWith("@/")) return defaultResolve(specifier, context, defaultResolve);

  const source = path.join(sourceRoot, "src", specifier.slice(2));
  const candidates = [".ts", ".tsx", ".js", "/index.ts", "/index.tsx", "/index.js"].map((suffix) => `${source}${suffix}`);
  const match = candidates.find(existsSync);
  if (!match) throw new Error(`Cannot resolve ${specifier}`);
  return { url: pathToFileURL(match).href, shortCircuit: true };
}

export async function load(url, context, defaultLoad) {
  if (!url.endsWith(".ts") && !url.endsWith(".tsx")) return defaultLoad(url, context, defaultLoad);

  const source = await readFile(fileURLToPath(url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
  });
  return { format: "module", source: output.outputText, shortCircuit: true };
}
