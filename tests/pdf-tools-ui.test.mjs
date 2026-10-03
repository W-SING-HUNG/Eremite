import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const launcher = await readFile(new URL("../src/app/_components/automations/pdf-tools-launcher.tsx", import.meta.url), "utf8");
const result = await readFile(new URL("../src/app/_components/automations/pdf-tools-result-renderer.tsx", import.meta.url), "utf8");
const registry = await readFile(new URL("../src/app/_components/automations/tool-ui-registry.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");

for (const operation of ["pdf.merge", "pdf.split", "pdf.extract", "pdf.rotate", "pdf.reorder"]) assert.match(launcher, new RegExp(operation.replace(".", "\\.")));
for (const field of ["contentItemIds", "splitEvery", "pageSelector", "rotateAngle", "rotateMode", "pageOrder", "folderId"]) assert.match(launcher, new RegExp(field));
assert.match(launcher, /PDF 合并顺序/);
assert.match(launcher, /上移/);
assert.match(launcher, /下移/);
assert.match(launcher, /未归入专案/);
assert.match(launcher, /正在处理/);
assert.doesNotMatch(launcher, /caller.?outdir|cancel|取消处理/iu);
assert.match(result, /打开|查看/u);
assert.match(result, /在资料库中显示/);
assert.match(result, /下载/);
assert.match(result, /w\.duplicate_page_emitted/);
assert.match(result, /w\.document_features_dropped/);
assert.doesNotMatch(result, /\?\?\s*code/u);
assert.match(registry, /PDF_TOOLS_TOOL_ID/);
assert.match(registry, /PdfToolsLauncher/);
assert.match(registry, /PdfToolsResultRenderer/);
assert.match(styles, /pdf-tools-settings/);
assert.match(styles, /pdf-tools-output-list/);
assert.doesNotMatch(styles, /pdf-tools[^}]*gradient|pdf-tools[^}]*backdrop-filter/iu);
console.log("PDF Tools UI contract passed: five operation launchers, ordered merge, destination, running/results/warnings and multi-output actions.");
