import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../src/app/_components/", import.meta.url);
const [shell, drawer, lifecycle, editor, tags, trash, actions, styles] = await Promise.all([
  readFile(new URL("file-viewer/viewer-shell.tsx", root), "utf8"),
  readFile(new URL("file-viewer/file-lifecycle-drawer.tsx", root), "utf8"),
  readFile(new URL("file-viewer/file-lifecycle-panel.tsx", root), "utf8"),
  readFile(new URL("file-viewer/text-editor.tsx", root), "utf8"),
  readFile(new URL("tag-picker.tsx", root), "utf8"),
  readFile(new URL("trash-workspace.tsx", root), "utf8"),
  readFile(new URL("../resource-actions.ts", root), "utf8"),
  readFile(new URL("../styles.css", root), "utf8"),
]);

assert.match(shell, /<Menu label="文件菜单">/);
assert.match(shell, /<FileLifecycleDrawer /);
assert.match(shell, /mode === "full" && <ToastViewport \/>/, "full-viewer feedback must survive a keyed version refresh");
assert.doesNotMatch(shell, /viewer-more|viewer-download|className="quiet-button viewer-download"/);

assert.match(drawer, /useDismissableLayer\(\{ open, panelRef, onDismiss: onClose, modal: true, returnFocus: true \}\)/);
assert.match(drawer, /useFocusScope/);
assert.match(drawer, /role="dialog" aria-modal="true"/);
assert.match(drawer, /查看、下载或恢复过去版本/);
assert.match(lifecycle, /setReplaceOpen\(\(open\) => !open\)/);
assert.match(lifecycle, /<AlertDialog /);
assert.match(lifecycle, /"if-match": `"\$\{descriptor\.versionId\}"`/);
assert.match(lifecycle, /"idempotency-key": crypto\.randomUUID\(\)/);
assert.match(lifecycle, /内容已复制为新的当前版本/);
assert.match(lifecycle, /setRestoreTarget\(null\); setError\("当前版本已在此操作期间改变/);

assert.match(editor, /<Popover label="文本信息"/);
assert.match(editor, /textDocument\.encoding !== "utf-8"/);
assert.match(editor, /beforeunload/);
assert.match(editor, /版本冲突/);
assert.match(editor, /showToast\(\{ title: "已保存为新版本"/);
assert.doesNotMatch(editor, /type="date"|text-editor-footer/);

assert.match(tags, /<MutationForm action=\{setObjectTagsResultAction\}/);
assert.match(tags, /aria-multiselectable="true"/);
assert.match(tags, /disabled=\{pending\}/);
assert.match(trash, /<Menu label=\{`\$\{title\} 更多操作`\}>/);
assert.doesNotMatch(trash, /共享 blob|\bGC\b|外键|\bFK\b/);
assert.match(actions, /已恢复到：/);
assert.match(actions, /已恢复运行记录；执行时专案：/);

assert.match(styles, /\.lifecycle-drawer \{ width: 100vw; \}/);
assert.doesNotMatch(styles, /viewer-info-popover|editor-success|text-editor-footer|lifecycle-dialog/);

console.log("Lifecycle UI test passed: compact Viewer actions, safe version history, guarded text editing, persisted Tags and human-readable Trash flows.");
