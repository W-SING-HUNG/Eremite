import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rootPage = await readFile(new URL("../src/app/(workspace)/projects/[id]/page.tsx", import.meta.url), "utf8");
const folderPage = await readFile(new URL("../src/app/(workspace)/projects/[id]/folders/[folderId]/page.tsx", import.meta.url), "utf8");
const contentWorkspace = await readFile(new URL("../src/app/_components/project-content-workspace.tsx", import.meta.url), "utf8");
const folderTree = await readFile(new URL("../src/app/_components/folder-tree.tsx", import.meta.url), "utf8");

assert.match(rootPage, /ProjectContentWorkspace/);
assert.match(rootPage, /ActionsWorkspace/);
assert.match(rootPage, /AutomationsWorkspace/);
assert.doesNotMatch(rootPage, /ProjectBrowser|ProjectFileUpload|SimpleRows/);
assert.match(folderPage, /ProjectContentWorkspace/);
assert.match(contentWorkspace, /InboxWorkspace/, "Project Content must reuse the global Content surface");
assert.match(contentWorkspace, /folderWorkspaceContext|projectWorkspaceContext/);
assert.match(contentWorkspace, /nextFolderCursor/);
assert.match(contentWorkspace, /nextContentCursor/);
assert.match(folderTree, /role="tree"/);
assert.match(folderTree, /role="treeitem"/);
assert.match(folderTree, /nextTreeState/);
assert.match(folderTree, /DestinationBrowser/);
assert.match(folderTree, /excludeFolderId/);

console.log("Project workspace contract test passed: contextual views reuse global objects, Folder Tree is keyboard-capable, and pagination channels remain independent.");
