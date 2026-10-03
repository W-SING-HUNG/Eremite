import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const launcher = await readFile(new URL("../src/app/_components/automations/file-converter-launcher.tsx", import.meta.url), "utf8");
const result = await readFile(new URL("../src/app/_components/automations/file-converter-result-renderer.tsx", import.meta.url), "utf8");
const contract = JSON.parse(await readFile(new URL("../src/modules/automations/tools/file-converter/canonical-tool-contract-v1.1.json", import.meta.url), "utf8"));
const workspace = await readFile(new URL("../src/app/_components/automations-workspace.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");

assert.match(launcher, /contentItemId/); assert.match(launcher, /conversionId/); assert.match(launcher, /folderId/); assert.match(launcher, /未归入专案/);
assert.match(launcher, /dependencyUnknown/); assert.match(launcher, /正在转换/); assert.doesNotMatch(launcher, /cancel|取消转换/iu);
assert.match(result, /打开查看器/); assert.match(result, /在资料库中显示/); assert.match(result, /下载/); assert.match(result, /暂不支持此格式/);
for (const warningCode of contract.$defs.warning.properties.code.enum) assert.match(result, new RegExp(warningCode));
assert.doesNotMatch(result, /warningLabels\[code\]\s*\?\?\s*code/u);
assert.match(workspace, /ResultRenderer/); assert.match(styles, /file-converter-settings/);
assert.doesNotMatch(styles, /file-converter[^}]*gradient|file-converter[^}]*backdrop-filter/iu);
console.log("File Converter UI contract passed: compact Launcher, dependency/running/result/warning and download-only states.");
