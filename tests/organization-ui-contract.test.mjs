import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const [library, actions, automations, search, tags, trash, projects, tagPicker, viewer, lifecycle, editor] = await Promise.all([
  readFile(new URL("../src/app/_components/inbox-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/actions-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/automations-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/(workspace)/search/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/(workspace)/tags/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/trash-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/(workspace)/projects/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/tag-picker.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/file-viewer/viewer-shell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/file-viewer/file-lifecycle-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/file-viewer/text-editor.tsx", import.meta.url), "utf8"),
]);
const styles = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");

for (const source of [library, actions, automations]) assert.match(source, /<TagPicker /);
assert.match(tagPicker, /管理标签/);
assert.match(tagPicker, /setObjectTagsResultAction/);
assert.match(tagPicker, /<MutationForm action=\{setObjectTagsResultAction\}/);
assert.doesNotMatch(projects, /tag-manager-link|管理 Tags（跨 Project/);
assert.doesNotMatch(search, /Folder ID/);
assert.match(search, /SearchScopeForm/);
assert.match(trash, /PermanentDeleteDialog/);
assert.doesNotMatch(trash, /共享 blob/);
assert.match(trash, /其他资料不会受影响/);
assert.match(trash, /<Menu label=\{`\$\{title\} 更多操作`\}>/);
assert.doesNotMatch(trash, /selection\?\.type === "action"[\s\S]{0,250}<Confirmation/);
assert.doesNotMatch(trash, /selection\?\.type === "run"[\s\S]{0,250}<Confirmation/);
assert.match(tags, /TagManager/);
assert.match(viewer, /eremite:viewer-return:/);
assert.match(viewer, /<FileLifecycleDrawer /);
assert.match(viewer, /<Menu label="文件菜单">/);
assert.doesNotMatch(viewer, /viewer-more|viewer-info-popover|className="quiet-button viewer-download"/);
assert.doesNotMatch(lifecycle, /window\.confirm/);
assert.match(lifecycle, /<AlertDialog /);
assert.match(lifecycle, /<Menu label=\{`v\$\{version\.version_number\} 版本操作`\}>/);
assert.match(lifecycle, /setReplaceOpen\(\(open\) => !open\)/);
assert.match(lifecycle, /历史恢复/);
assert.match(lifecycle, /新的当前版本/);
assert.match(lifecycle, /setRestoreTarget\(null\); setError\("当前版本已在此操作期间改变/);
assert.match(editor, /beforeunload/);
assert.match(editor, /pendingNavigation/);
assert.match(editor, /版本冲突/);
assert.match(editor, /navigator\.clipboard\.writeText/);
assert.match(editor, /<Popover label="文本信息"/);
assert.doesNotMatch(editor, /text-editor-footer/);
await assert.rejects(access(new URL("../src/app/_components/project-browser.tsx", import.meta.url)));
await assert.rejects(access(new URL("../src/app/_components/project-file-upload.tsx", import.meta.url)));
assert.match(styles, /\.lifecycle-drawer/);
assert.match(styles, /\.lifecycle-drawer \{ width: 100vw; \}/);
assert.doesNotMatch(styles, /create-resource-form|resource-menu|tag-card|selected-tags-form|unified-inspector|viewer-info-popover|editor-success/);

console.log("Organization UI contract test passed: shared organization controls, explicit Trash consequences, non-pushing version history and guarded text editing.");
