import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-folder-tree-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
const inboxSource = await readFile(path.join(process.cwd(), "src", "modules", "inbox", "service.ts"), "utf8");
const visibilityContractSource = await readFile(path.join(process.cwd(), "src", "modules", "projects", "folder-visibility.ts"), "utf8");
assert.doesNotMatch(inboxSource, /\b(?:FROM|JOIN)\s+folders\b/iu, "Inbox must not query the Projects-owned folders table");
assert.match(visibilityContractSource, /\bFROM\s+folders\b/iu, "Projects must own the Folder visibility SQL contract");
let databaseModule;
try {
  databaseModule = await import("@/platform/db/database");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const inbox = await import("@/modules/inbox/service");
  const operations = await import("@/app/_services/resource-operations");
  const { transaction } = databaseModule;

  const projectA = projects.createProject({ name: "项目 A" });
  const projectB = projects.createProject({ name: "项目 B" });
  const root = folders.createFolder({ projectId: projectA, name: "资料" });
  const chain = [root];
  for (let depth = 2; depth <= 8; depth += 1) chain.push(folders.createFolder({ projectId: projectA, parentId: chain.at(-1), name: `层级 ${depth}` }));
  const deepest = chain.at(-1);
  assert.equal(folders.getFolderBreadcrumbs(deepest).length, 8, "the product must not impose a shallow folder-depth limit");
  assert.deepEqual(folders.getFolderBreadcrumbs(deepest).map((folder) => folder.name), ["资料", "层级 2", "层级 3", "层级 4", "层级 5", "层级 6", "层级 7", "层级 8"]);
  assert.throws(() => folders.createFolder({ projectId: projectA, parentId: root, name: "  层级 2  " }), (error) => error instanceof folders.FolderError && error.code === "name_conflict");
  assert.throws(() => operations.moveFolderTree({ id: root, expectedRevision: folders.getFolder(root).revision, targetProjectId: projectA, targetParentId: deepest }), (error) => error instanceof folders.FolderError && error.code === "cycle");

  const pagingParent = folders.createFolder({ projectId: projectA, name: "分页目录" });
  for (let index = 1; index <= 3; index += 1) {
    folders.createFolder({ projectId: projectA, parentId: pagingParent, name: `子目录 ${index}` });
    inbox.createLinkContentItem({ title: `分页资料 ${index}`, url: `https://example.com/page-${index}`, projectId: projectA, folderId: pagingParent });
  }
  const firstFolderPage = folders.listChildFoldersPage(projectA, pagingParent, { limit: 2 });
  const firstContentPage = inbox.listContentItemsInFolderPage(projectA, pagingParent, { limit: 2 });
  const secondFolderPage = folders.listChildFoldersPage(projectA, pagingParent, { limit: 2, cursor: firstFolderPage.nextCursor });
  const secondContentPage = inbox.listContentItemsInFolderPage(projectA, pagingParent, { limit: 2, cursor: firstContentPage.nextCursor });
  assert.equal(firstFolderPage.items.length, 2); assert.equal(secondFolderPage.items.length, 1);
  assert.equal(firstContentPage.items.length, 2); assert.equal(secondContentPage.items.length, 1);
  assert.equal(new Set([...firstFolderPage.items, ...secondFolderPage.items].map((item) => item.id)).size, 3);
  assert.equal(new Set([...firstContentPage.items, ...secondContentPage.items].map((item) => item.id)).size, 3);
  assert.deepEqual(folders.listChildFoldersPage(projectA, pagingParent, { limit: 2 }).items.map((item) => item.id), firstFolderPage.items.map((item) => item.id), "advancing Content must not advance Folder pagination");
  assert.deepEqual(inbox.listContentItemsInFolderPage(projectA, pagingParent, { limit: 2 }).items.map((item) => item.id), firstContentPage.items.map((item) => item.id), "advancing Folders must not advance Content pagination");

  const contentId = await inbox.createFileContentItem(new File([Buffer.from("stable bytes")], "stable.txt", { type: "text/plain" }));
  const before = inbox.getFileAssetForViewing(contentId);
  transaction(() => inbox.moveContentItems({ ids: [{ id: contentId, expectedRevision: inbox.getContentItemSummary(contentId).revision }], projectId: projectA, folderId: deepest }));
  const move = operations.moveFolderTree({ id: root, expectedRevision: folders.getFolder(root).revision, targetProjectId: projectB, targetParentId: null });
  assert.equal(move.crossProject, true);
  assert.throws(() => operations.moveFolderTree({ id: root, expectedRevision: 1, targetProjectId: projectA, targetParentId: null }), (error) => error instanceof folders.FolderError && error.code === "revision_conflict");
  const movedContent = inbox.getContentItemSummary(contentId);
  assert.equal(movedContent.project_id, projectB);
  assert.equal(movedContent.folder_id, deepest);
  const after = inbox.getFileAssetForViewing(contentId);
  assert.deepEqual({ contentId: after.contentId, assetId: after.assetId, versionId: after.versionId, sha256: after.sha256 }, { contentId: before.contentId, assetId: before.assetId, versionId: before.versionId, sha256: before.sha256 });

  const movedRoot = folders.getFolder(root);
  const directRootContentId = inbox.createLinkContentItem({ title: "根目录资料", url: "https://example.com/root-content", projectId: projectB, folderId: root });
  folders.trashFolder(root, movedRoot.revision);
  assert.equal(inbox.listContentItems().some((item) => item.id === contentId), false, "folder trash hides the effective subtree");
  assert.equal(inbox.listContentItems().some((item) => item.id === directRootContentId), false, "a trashed Folder hides its direct Content");
  assert.equal(inbox.getAvailableContentItemSummary(contentId), undefined, "an ancestor trash hides point reads");
  assert.equal(inbox.getAvailableContentItemSummary(directRootContentId), undefined, "a direct Folder trash hides point reads");
  const hiddenPageIds = collectContentPageIds(inbox, 1);
  assert.equal(hiddenPageIds.includes(contentId), false, "keyset pagination excludes Content under a trashed ancestor");
  assert.equal(hiddenPageIds.includes(directRootContentId), false, "keyset pagination excludes Content in a trashed Folder");
  const restore = folders.restoreFolder(root, folders.getFolder(root).revision);
  assert.equal(restore.fallbackToProjectRoot, false);
  assert.equal(inbox.listContentItems().some((item) => item.id === contentId), true);
  assert.equal(inbox.listContentItems().some((item) => item.id === directRootContentId), true);
  assert.equal(inbox.getAvailableContentItemSummary(contentId)?.id, contentId);
  assert.equal(inbox.getAvailableContentItemSummary(directRootContentId)?.id, directRootContentId);

  projects.trashProject(projectB, projects.getProject(projectB).revision);
  const projectDelete = operations.describeProjectPermanentDeletion(projectB);
  operations.permanentlyDeleteProjectWorkspace({ projectId: projectB, expectedFolders: projectDelete.folders, expectedContent: projectDelete.content, expectedActions: 0, expectedRuns: 0 });
  assert.ok(inbox.getContentItemSummary(contentId), "project deletion must preserve content identity");
  assert.equal(inbox.getContentItemSummary(contentId).project_id, null);
  assert.equal(inbox.getFileAssetForViewing(contentId).sha256, before.sha256);
  assert.equal(databaseModule.db().prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(databaseModule.db().prepare("PRAGMA foreign_key_check").all(), []);
  console.log("Folder tree test passed: 8-level depth, independent pagination, cycle rejection, cross-project subtree move, Trash/restore and non-destructive Project deletion.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

function collectContentPageIds(inbox, limit) {
  const ids = [];
  let cursor;
  do {
    const page = inbox.listContentItemsPage({ cursor, limit });
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return ids;
}
