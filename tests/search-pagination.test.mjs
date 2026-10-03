import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-search-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let databaseModule;
try {
  databaseModule = await import("@/platform/db/database");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const inbox = await import("@/modules/inbox/service");
  const tags = await import("@/modules/tags/service");
  const search = await import("@/modules/search/service");

  const projectA = projects.createProject({ name: "航天计划", description: "火星研究" });
  const projectB = projects.createProject({ name: "家庭", description: "生活资料" });
  const root = folders.createFolder({ projectId: projectA, name: "研究" });
  const child = folders.createFolder({ projectId: projectA, parentId: root, name: "深层报告" });
  const tagId = tags.createTag({ name: "关键" });
  const ids = [];
  for (let index = 0; index < 65; index += 1) {
    const id = inbox.createLinkContentItem({ title: `火星资料 ${String(index).padStart(2, "0")}`, url: `https://example.com/${index}`, projectId: index < 60 ? projectA : projectB, folderId: index < 30 ? child : null });
    ids.push(id);
  }
  tags.assignTag("content", ids[4], tagId);

  const firstPage = inbox.listContentItemsPage({ limit: 30 });
  const secondPage = inbox.listContentItemsPage({ limit: 30, cursor: firstPage.nextCursor });
  const thirdPage = inbox.listContentItemsPage({ limit: 30, cursor: secondPage.nextCursor });
  assert.equal(new Set([...firstPage.items, ...secondPage.items, ...thirdPage.items].map((item) => item.id)).size, 65);
  assert.equal(thirdPage.nextCursor, null);
  const actions = await import("@/modules/actions/service");
  const automations = await import("@/modules/automations/service");
  const priorities = ["low", "high", "normal", "high", "low", "normal"];
  const actionIds = priorities.map((priority, index) => actions.createAction({ title: `排序 ${index}`, priority, dueDate: index % 2 ? "2026-08-20" : undefined }));
  tags.assignTag("action", actionIds[0], tagId);
  const actionFirst = actions.listActionsPage({ limit: 3 });
  const actionSecond = actions.listActionsPage({ limit: 3, cursor: actionFirst.nextCursor });
  assert.equal(new Set([...actionFirst.items, ...actionSecond.items].map((item) => item.id)).size, actionIds.length);
  assert.deepEqual([...actionFirst.items, ...actionSecond.items].map((item) => item.priority), ["high", "high", "normal", "normal", "low", "low"], "Actions keyset preserves v1.1 priority ordering");
  const runId = automations.runInboxToDrafts([ids[4]], projectA);
  tags.assignTag("automation_run", runId, tagId);

  const projectNameResults = search.searchWorkspace({ query: "航天", scope: "global", limit: 50 }).results;
  assert.ok(projectNameResults.some((result) => result.type === "project" && result.projectId === projectA));
  const globalResults = search.searchWorkspace({ query: "火星资料", scope: "global", limit: 50 }).results;
  assert.equal(globalResults.some((result) => result.projectId === projectB && result.type === "content"), true, "global search is not constrained to a Project");
  const projectResults = search.searchWorkspace({ query: "火星资料", scope: "project", projectId: projectA, limit: 50 }).results.filter((result) => result.type === "content");
  assert.ok(projectResults.length > 0 && projectResults.every((result) => result.projectId === projectA));
  const folderResults = search.searchWorkspace({ query: "火星资料", scope: "folder", projectId: projectA, folderId: root, limit: 50 }).results.filter((result) => result.type === "content");
  assert.equal(folderResults.length, 30, "Folder scope recursively includes descendants");
  const tagResults = search.searchWorkspace({ query: "火星资料", scope: "global", tagId, limit: 50 }).results.filter((result) => result.type === "content");
  assert.deepEqual(tagResults.map((result) => result.id), [`content:${ids[4]}`]);
  const tagOnlyResults = search.searchWorkspace({ query: "", scope: "global", tagId, limit: 50 }).results;
  assert.ok(tagOnlyResults.some((result) => result.id === `content:${ids[4]}`));
  assert.ok(tagOnlyResults.some((result) => result.id === `action:${actionIds[0]}`));
  assert.ok(tagOnlyResults.some((result) => result.id === `run:${runId}`));
  assert.equal(tagOnlyResults.some((result) => result.type === "project" || result.type === "folder"), false, "Tag filters apply only to taggable business objects");
  assert.deepEqual(search.searchWorkspace({ query: "火星", scope: "project" }).results, [], "an incomplete scoped search must not silently degrade to global");
  assert.deepEqual(search.searchIndexDrift(), []);
  databaseModule.run("UPDATE content_items SET title = ? WHERE id = ?", "木星资料", ids[0]);
  assert.ok(search.searchWorkspace({ query: "木星资料", limit: 10 }).results.some((result) => result.id === `content:${ids[0]}`), "FTS trigger follows metadata changes");
  folders.trashFolder(root, folders.getFolder(root).revision);
  assert.equal(search.searchWorkspace({ query: "火星资料 04", scope: "global", limit: 50 }).results.some((result) => result.id === `content:${ids[4]}`), false, "Search hides Content inherited through a trashed Folder subtree");
  assert.equal(databaseModule.db().prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  console.log("Search and pagination test passed: keyset pages, global/Project/recursive Folder scopes, Tag filtering and FTS maintenance.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
