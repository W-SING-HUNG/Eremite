import assert from "node:assert/strict";
import { automationRetryConfirmation } from "@/app/_lib/automation-retry";

const projectId = "qa-project", folderId = "qa-folder", projectName = "Retry 专案", folderNameSnapshot = "原叶子文件夹";
const ancestors = Array.from({ length: 320 }, (_, n) => ({ id: `folder-${n}`, name: `ancestor-${n}`, parentId: n ? `folder-${n-1}` : null, projectId }));
let cases = 0;
for (const tool of ["fc", "pdf"]) for (const schemaVersion of [1, 2]) for (const kind of ["unassigned", "root", "deep"]) {
  const destination = { projectId: kind === "unassigned" ? null : projectId, folderId: kind === "deep" ? folderId : null,
    projectName: kind === "unassigned" ? null : projectName };
  const evidence = { schemaVersion, sources: [{ originalName: "原文件" }], destination: { ...destination,
    ...(schemaVersion === 1 ? { folders: kind === "deep" ? ancestors : [] } : { folderPathSha256: "a".repeat(64) }) } };
  const payload = { destination: { projectId: destination.projectId, folderId: destination.folderId, folderNameSnapshot: kind === "deep" ? folderNameSnapshot : null }, retryEvidence: evidence,
    ...(tool === "fc" ? { conversionId: "png-to-jpeg", profile: "balanced" } : { operation: "pdf.extract", parameters: { pageSelector: { pages: [2, 0] } } }) };
  const expected = kind === "unassigned" ? "未归入专案" : schemaVersion === 1
    ? [projectName, ...(kind === "deep" ? ancestors.map(f => f.name) : [])].join(" / ")
    : kind === "root" ? `${projectName} / 专案根目录` : `${projectName} · 文件夹：${folderNameSnapshot}（完整路径未记录）`;
  const before = JSON.stringify(payload);
  assert.deepEqual(automationRetryConfirmation(before), { sourceNames: "原文件", location: expected,
    parameters: tool === "fc" ? "转换：PNG → JPEG；方式：均衡" : "提取页码：3、1" }, `${tool}/v${schemaVersion}/${kind}: eligible Run must retain a confirmation`);
  assert.equal(JSON.stringify(payload), before, "display never rewrites immutable Retry evidence");
  if (schemaVersion === 2 && kind === "deep") {
    for (const change of [value => { delete value.destination.folderNameSnapshot; }, value => { value.destination.folderId = "another-folder"; }]) {
      const unknown = structuredClone(payload); change(unknown);
      assert.equal(automationRetryConfirmation(JSON.stringify(unknown)).location, `${projectName} · 原文件夹（名称及完整路径未记录）`, "missing or mismatched snapshot must not invent a complete path");
    }
  }
  cases++;
}
assert.equal(automationRetryConfirmation("invalid JSON"), null);
assert.equal(automationRetryConfirmation(JSON.stringify({ retryEvidence: { schemaVersion: 2, sources: [], destination: { projectId, projectName } } })), null, "unknown folder identity is not a Project root");
console.log(`Retry confirmation PASS: ${cases} FC/PDF v1/v2 unassigned/root/320-depth cases; exact legacy display, bounded trusted leaf, unknown path, parameters and immutable evidence`);
