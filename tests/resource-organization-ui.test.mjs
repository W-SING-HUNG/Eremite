import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { collapseBreadcrumbs, isSameDestination, serializeDestination } from "@/app/_lib/resource-navigation";

const [library, tree, workspace, destination, searchForm, searchPage, styles] = await Promise.all([
  readFile(new URL("../src/app/_components/inbox-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/folder-tree.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/project-content-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/destination-browser.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/search-scope-form.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/(workspace)/search/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/styles.css", import.meta.url), "utf8"),
]);

assert.equal(serializeDestination({ projectId: null, folderId: null }), "inbox");
assert.equal(serializeDestination({ projectId: "p1", folderId: null }), "p1|");
assert.equal(serializeDestination({ projectId: "p1", folderId: "f1" }), "p1|f1");
assert.equal(isSameDestination({ projectId: "p1", folderId: "f1" }, { projectId: "p1", folderId: "f1" }), true);
assert.equal(isSameDestination({ projectId: "p1", folderId: null }, { projectId: "p1", folderId: "f1" }), false);
const collapsed = collapseBreadcrumbs(["1", "2", "3", "4", "5", "6"], 4);
assert.deepEqual(collapsed, { leading: ["1"], hidden: ["2", "3", "4"], trailing: ["5", "6"] });

assert.match(library, /resource-inspector/);
assert.match(library, /编辑资料/);
assert.match(library, /新资料请通过“处理资料”完成整理/);
assert.match(library, /editableContentStatuses\(selected\.status\)/);
assert.match(library, /DestinationBrowser/);
assert.match(library, /className="content-heading"/);
assert.doesNotMatch(library, /<FolderDestinationPicker/);
assert.match(destination, /所有位置/);
assert.match(destination, /未归入专案/);
assert.match(destination, /移到这里|将移到/);
assert.match(destination, /noOp/);
assert.match(destination, /excludeFolderId/);
assert.match(tree, /ContextMenu/);
assert.match(tree, /firstChildIndex/);
assert.match(tree, /event\.key === "F2"/);
assert.match(workspace, /FolderBreadcrumbs/);
assert.match(workspace, /folder-tree-backdrop/);
assert.match(workspace, /useFocusScope/);
assert.match(searchForm, /search-filter-chips/);
assert.match(searchForm, /Popover/);
assert.match(searchPage, /searchFailed/);
assert.match(searchPage, /这不代表没有结果/);
assert.match(styles, /@media \(max-width: 839px\)/);
assert.match(styles, /workspace-split\.has-detail:not\(\.previewing\)/);
assert.match(styles, /project-resource-shell\.tree-open/);
assert.match(styles, /destination-browser__list/);
assert.match(styles, /--row-height: 52px/);
assert.match(styles, /\.content-primary \{ display: grid; grid-template-columns: 20px minmax\(0, 1fr\)/);
assert.match(styles, /\.list-heading > :nth-child\(3\), \.content-row \.status-text \{ display: none; \}/);
await assert.rejects(access(new URL("../src/app/_components/folder-destination-picker.tsx", import.meta.url)));

console.log("Resource organization UI test passed: read-first inspector, spatial destinations, no-op guards, tree keyboard, scoped search and responsive sheets.");
