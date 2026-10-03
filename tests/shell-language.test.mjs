import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = [
  "../src/app/_components/workspace-shell.tsx",
  "../src/app/_components/project-workspace-header.tsx",
  "../src/app/_components/project-lifecycle-controls.tsx",
  "../src/app/_components/projects-workspace.tsx",
  "../src/app/_components/project-content-workspace.tsx",
  "../src/app/_components/folder-tree.tsx",
  "../src/app/_components/destination-browser.tsx",
  "../src/app/_components/inbox-workspace.tsx",
  "../src/app/_components/actions-workspace.tsx",
  "../src/app/_components/automations-workspace.tsx",
  "../src/app/_components/tag-picker.tsx",
  "../src/app/_components/tag-manager.tsx",
  "../src/app/_components/trash-workspace.tsx",
  "../src/app/(workspace)/search/page.tsx",
  "../src/app/_components/search-scope-form.tsx",
  "../src/app/(workspace)/projects/[id]/page.tsx",
  "../src/app/_components/folder-breadcrumbs.tsx",
];
const sources = await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), "utf8")));
const [shell, header, lifecycle, projects, content, tree] = sources;
const combined = sources.join("\n");
const searchService = await readFile(new URL("../src/modules/search/service.ts", import.meta.url), "utf8");

assert.match(shell, /aria-label="专案导航"/);
assert.match(shell, /aria-current=\{pathname === href \? "page" : undefined\}/);
assert.match(shell, /aria-label="打开命令面板"/);
assert.match(shell, /全部专案/);
assert.match(header, /\["content", "资料"\]/);
assert.match(header, /\["actions", "行动"\]/);
assert.match(header, /\["automations", "自动化"\]/);
assert.doesNotMatch(header, /\["settings",/);
assert.match(header, /aria-current=\{activeTab === key \? "page" : undefined\}/);
assert.match(lifecycle, /<Menu label=\{`\$\{project\.name\} 专案菜单`\}>/);
assert.match(lifecycle, /专案设置/);
assert.match(content, /FolderBreadcrumbs/);
assert.match(sources.at(-1), />全部资料</);
assert.match(tree, /aria-label="文件夹树"/);
assert.match(tree, /aria-current=\{!selectedFolderId \? "page" : undefined\}/);

for (const banned of [
  "Project Workspace",
  "Project 根目录",
  "Project 上下文",
  "全部 Projects",
  "未归类",
  "管理 Tags",
  "新建 Action",
  "新建 Tag",
  "手动运行 Automation",
  "执行时 Project",
  "Automation Runs",
]) assert.doesNotMatch(combined, new RegExp(banned));

for (const label of ["group: \"资料\"", "group: \"行动\"", "group: \"运行记录\"", "group: \"专案\"", "group: \"文件夹\""]) {
  assert.match(searchService, new RegExp(label));
}

console.log("Shell language test passed: navigation semantics, project context hierarchy, and user-facing terminology are unified.");
