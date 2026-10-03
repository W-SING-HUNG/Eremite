import assert from "node:assert/strict";
import { actionProjectForContext, contentLocationForContext, folderWorkspaceContext, globalWorkspaceContext, projectWorkspaceContext, workspaceHref } from "@/app/_lib/workspace-context";
import { nextRovingIndex, nextTreeState } from "@/app/_lib/ui-keyboard";

assert.deepEqual(contentLocationForContext(globalWorkspaceContext), { projectId: null, folderId: null });
assert.deepEqual(contentLocationForContext(projectWorkspaceContext("p1")), { projectId: "p1", folderId: null });
assert.deepEqual(contentLocationForContext(folderWorkspaceContext("p1", "f1")), { projectId: "p1", folderId: "f1" });
assert.equal(actionProjectForContext(folderWorkspaceContext("p1", "f1")), "p1", "Actions inherit Project but never Folder");
assert.equal(workspaceHref(folderWorkspaceContext("p1", "f1"), { selected: "c1" }), "/projects/p1/folders/f1?selected=c1");
assert.deepEqual(nextRovingIndex("ArrowUp", 0, 3), { handled: true, index: 2, activate: false });
assert.equal(nextTreeState({ key: "ArrowRight", index: 1, itemCount: 3, expanded: false, hasChildren: true, parentIndex: 0 }).expand, true);
assert.equal(nextTreeState({ key: "ArrowRight", index: 1, itemCount: 3, expanded: true, hasChildren: true, parentIndex: 0, firstChildIndex: 2 }).index, 2);
assert.equal(nextTreeState({ key: "ArrowLeft", index: 2, itemCount: 3, expanded: false, hasChildren: false, parentIndex: 0 }).index, 0);
console.log("Workspace context and keyboard primitive test passed.");
