import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canCreateActionDirectly, canProcessContent, editableContentStatuses } from "@/app/_lib/inbox-processing-ui";

assert.equal(canProcessContent("inbox"), true);
assert.equal(canProcessContent("processed"), false);
assert.equal(canProcessContent("archived"), false);
assert.equal(canCreateActionDirectly("inbox"), false);
assert.equal(canCreateActionDirectly("processed"), true);
assert.equal(canCreateActionDirectly("archived"), true);
assert.deepEqual(editableContentStatuses("inbox"), ["inbox"]);
assert.deepEqual(editableContentStatuses("processed"), ["processed", "archived"]);
assert.deepEqual(editableContentStatuses("archived"), ["processed", "archived"]);

const [workspace, processingDialog, serverActions, inboxPage, projectPage, folderPage, quickViewer, viewerShell, fullViewerPage] = await Promise.all([
  readFile(new URL("../src/app/_components/inbox-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/inbox-processing-dialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/(workspace)/inbox/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/(workspace)/projects/[id]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/(workspace)/projects/[id]/folders/[folderId]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/file-viewer/quick-viewer.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/file-viewer/viewer-shell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/(viewer)/viewer/[id]/page.tsx", import.meta.url), "utf8"),
]);

assert.match(workspace, /canProcessContent\(selected\.status\).*处理资料/s);
assert.match(workspace, /onProcessContent=\{mutable && previewItem\?\.status === "inbox"/);
assert.match(workspace, /onCreateAction=\{mutable && previewItem && canCreateActionDirectly\(previewItem\.status\)/);
assert.match(workspace, /ActionCreateDialog open=\{mutable && createActionOpen[\s\S]*canCreateActionDirectly\(selected\.status\)/);
assert.match(workspace, /selected\.status === "inbox" \? <>\s*<input type="hidden" name="status" value="inbox"/);
assert.match(workspace, /新资料请通过“处理资料”完成整理/);
assert.match(workspace, /editableContentStatuses\(selected\.status\)/);
assert.match(workspace, /<InboxProcessingDialog /);

assert.match(processingDialog, /action=\{processContentWithoutActionAction\}/);
assert.match(processingDialog, /无需行动，标记为已处理/);
assert.match(processingDialog, /action=\{processContentWithNewActionAction\}/);
assert.match(processingDialog, /创建行动并处理/);
assert.match(processingDialog, /当前资料将固定关联到新行动/);
assert.match(processingDialog, /action=\{processContentWithAcceptedDraftAction\}/);
assert.match(processingDialog, /接受为行动并完成处理/);
assert.match(processingDialog, /name="revision" value=\{content\.revision\}/);
assert.match(processingDialog, /name="actionRevision" value=\{draft\.revision\}/);
assert.match(processingDialog, /href=\{`\/actions\?selected=/, "full Draft editing stays in the existing Actions UI");

for (const [name, command] of [
  ["processContentWithoutActionAction", "processContentWithoutAction"],
  ["processContentWithNewActionAction", "processContentWithNewAction"],
  ["processContentWithAcceptedDraftAction", "processContentWithAcceptedDraft"],
]) {
  const source = serverActions.match(new RegExp(`export async function ${name}\\(formData: FormData\\) \\{[\\s\\S]*?\\n\\}`, "u"))?.[0] ?? "";
  assert.match(source, new RegExp(`${command}\\(`));
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\s/iu);
}
const createProcessingSource = serverActions.match(/export async function processContentWithNewActionAction\(formData: FormData\) \{[\s\S]*?\n\}/u)?.[0] ?? "";
assert.doesNotMatch(createProcessingSource, /createActionAction|createAction\(/u, "Processing creation cannot fall back to the ordinary Action command");

assert.equal((inboxPage.match(/listDraftActionsForContentItems\(/g) ?? []).length, 1, "the Inbox page performs one batch Draft query");
assert.match(inboxPage, /listDraftActionsForContentItems\(page\.items\.map/);
assert.equal((projectPage.match(/listDraftActionsForContentItems\(/g) ?? []).length, 1);
assert.match(projectPage, /listDraftActionsForContentItems\(contentPage\.items\.map/);
assert.equal((folderPage.match(/listDraftActionsForContentItems\(/g) ?? []).length, 1);
assert.match(folderPage, /listDraftActionsForContentItems\(contentPage\.items\.map/);

assert.match(quickViewer, /onProcessContent/);
assert.match(viewerShell, /onProcessContent.*处理资料/s);
assert.match(fullViewerPage, /sourceSummary\.status === "inbox" \? `\$\{returnHref\}&processing=1`/);
assert.match(fullViewerPage, /actionCreateContext=\{sourceSummary\.status === "inbox" \? undefined/);

console.log("Inbox Processing UI contract test passed: explicit outcomes, lifecycle guard UI, batch Draft reads and create-action bypass closure.");
