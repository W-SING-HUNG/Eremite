import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-inbox-processing-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let databaseModule;

try {
  const appServiceSource = await readFile(new URL("../src/app/_services/inbox-processing.ts", import.meta.url), "utf8");
  assert.match(appServiceSource, /withUnitOfWork/);
  assert.match(appServiceSource, /markContentProcessed/);
  assert.match(appServiceSource, /createAction/);
  assert.match(appServiceSource, /acceptDraftAction/);
  assert.match(appServiceSource, /actionHasContentItem/);
  assert.doesNotMatch(appServiceSource, /\b(?:SELECT|INSERT|UPDATE|DELETE)\s/iu, "the app Processing service must not issue owner-table SQL");
  assert.doesNotMatch(appServiceSource, /\b(?:all|one|run|transaction)\(/u, "the app Processing service may compose only public module contracts through withUnitOfWork");

  databaseModule = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const actions = await import("@/modules/actions/service");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const processing = await import("@/app/_services/inbox-processing");

  const counts = () => ({
    actions: Number(databaseModule.one("SELECT COUNT(*) AS count FROM actions").count),
    links: Number(databaseModule.one("SELECT COUNT(*) AS count FROM action_content_items").count),
  });
  const expectContentError = (work, code) => assert.throws(
    work,
    (error) => error instanceof inbox.ContentProcessingError && error.code === code,
  );
  assert.throws(
    () => inbox.markContentProcessed({}, { id: "forged-unit-of-work", expectedRevision: 0 }),
    /invalid_unit_of_work/u,
    "the Inbox Processing write contract cannot run outside the app-owned Unit of Work",
  );

  const guardedStatusId = inbox.createLinkContentItem({ title: "状态绕过保护", url: "https://example.com/status-guard" });
  const guardedInbox = inbox.getContentItemSummary(guardedStatusId);
  for (const status of ["processed", "archived"]) {
    assert.throws(
      () => inbox.updateContentItem({ id: guardedStatusId, title: guardedInbox.title, status, expectedRevision: guardedInbox.revision }),
      (error) => error instanceof inbox.FileLifecycleError && error.code === "invalid_status_transition",
      `generic metadata update must reject inbox -> ${status}`,
    );
  }
  inbox.updateContentItem({ id: guardedStatusId, title: "状态绕过保护已重命名", status: "inbox", expectedRevision: guardedInbox.revision });
  processing.processContentWithoutAction({ contentId: guardedStatusId, expectedContentRevision: inbox.getContentItemSummary(guardedStatusId).revision });
  const guardedProcessed = inbox.getContentItemSummary(guardedStatusId);
  assert.throws(
    () => inbox.updateContentItem({ id: guardedStatusId, title: guardedProcessed.title, status: "inbox", expectedRevision: guardedProcessed.revision }),
    (error) => error instanceof inbox.FileLifecycleError && error.code === "invalid_status_transition",
  );
  inbox.updateContentItem({ id: guardedStatusId, title: guardedProcessed.title, status: "archived", expectedRevision: guardedProcessed.revision });
  const guardedArchived = inbox.getContentItemSummary(guardedStatusId);
  inbox.updateContentItem({ id: guardedStatusId, title: guardedArchived.title, status: "processed", expectedRevision: guardedArchived.revision });
  assert.equal(inbox.getContentItemSummary(guardedStatusId).status, "processed", "processed and archived retain their existing lifecycle transitions");

  const noActionId = inbox.createLinkContentItem({ title: "无需行动", url: "https://example.com/no-action" });
  const noActionBefore = inbox.getContentItemSummary(noActionId);
  const noActionCounts = counts();
  const noActionResult = processing.processContentWithoutAction({ contentId: noActionId, expectedContentRevision: noActionBefore.revision });
  assert.deepEqual(
    { status: inbox.getContentItemSummary(noActionId).status, revision: inbox.getContentItemSummary(noActionId).revision, actionCounts: counts() },
    { status: "processed", revision: noActionResult.contentRevision, actionCounts: noActionCounts },
  );
  expectContentError(
    () => processing.processContentWithoutAction({ contentId: noActionId, expectedContentRevision: noActionResult.contentRevision }),
    "not_inbox",
  );

  const archivedId = inbox.createLinkContentItem({ title: "已归档资料", url: "https://example.com/archived" });
  const archivedBefore = inbox.getContentItemSummary(archivedId);
  processing.processContentWithoutAction({ contentId: archivedId, expectedContentRevision: archivedBefore.revision });
  const processedBeforeArchive = inbox.getContentItemSummary(archivedId);
  inbox.updateContentItem({ id: archivedId, title: processedBeforeArchive.title, status: "archived", expectedRevision: processedBeforeArchive.revision });
  const archived = inbox.getContentItemSummary(archivedId);
  expectContentError(() => processing.processContentWithoutAction({ contentId: archivedId, expectedContentRevision: archived.revision }), "not_inbox");

  const trashedId = inbox.createLinkContentItem({ title: "回收资料", url: "https://example.com/trashed" });
  inbox.trashContentItem(trashedId, inbox.getContentItemSummary(trashedId).revision);
  expectContentError(() => processing.processContentWithoutAction({ contentId: trashedId, expectedContentRevision: inbox.getContentItemSummary(trashedId).revision }), "unavailable");
  expectContentError(() => processing.processContentWithoutAction({ contentId: "missing-content", expectedContentRevision: 0 }), "unavailable");

  const folderProjectId = projects.createProject({ name: "Processing visibility" });
  const trashedAncestorId = folders.createFolder({ projectId: folderProjectId, name: "回收祖先" });
  const nestedFolderId = folders.createFolder({ projectId: folderProjectId, parentId: trashedAncestorId, name: "后代" });
  const hiddenContentId = inbox.createLinkContentItem({ title: "祖先回收下的资料", url: "https://example.com/hidden", projectId: folderProjectId, folderId: nestedFolderId });
  folders.trashFolder(trashedAncestorId, folders.getFolder(trashedAncestorId).revision);
  expectContentError(() => processing.processContentWithoutAction({ contentId: hiddenContentId, expectedContentRevision: inbox.getContentItemSummary(hiddenContentId).revision }), "unavailable");

  const newActionContentId = inbox.createLinkContentItem({ title: "创建行动资料", url: "https://example.com/new-action" });
  const newActionContent = inbox.getContentItemSummary(newActionContentId);
  const newActionResult = processing.processContentWithNewAction({
    contentId: newActionContentId,
    expectedContentRevision: newActionContent.revision,
    title: "处理后行动",
    priority: "high",
    dueDate: "2026-10-01",
    projectId: null,
  });
  assert.equal(inbox.getContentItemSummary(newActionContentId).status, "processed");
  assert.deepEqual(
    { status: actions.getAction(newActionResult.actionId).status, priority: actions.getAction(newActionResult.actionId).priority, dueDate: actions.getAction(newActionResult.actionId).due_date },
    { status: "active", priority: "high", dueDate: "2026-10-01" },
  );
  assert.equal(actions.actionHasContentItem(newActionResult.actionId, newActionContentId), true);

  const staleNewActionContentId = inbox.createLinkContentItem({ title: "新行动回滚", url: "https://example.com/new-action-rollback" });
  const staleNewActionContent = inbox.getContentItemSummary(staleNewActionContentId);
  inbox.updateContentItem({ id: staleNewActionContentId, title: "新行动回滚已更新", status: "inbox", expectedRevision: staleNewActionContent.revision });
  const beforeNewActionRollback = counts();
  expectContentError(() => processing.processContentWithNewAction({
    contentId: staleNewActionContentId,
    expectedContentRevision: staleNewActionContent.revision,
    title: "不应保留的行动",
    priority: "normal",
    projectId: null,
  }), "revision_conflict");
  assert.deepEqual(counts(), beforeNewActionRollback, "a new Action and its relation roll back when Content CAS fails after creation");
  assert.equal(actions.listActions().some((action) => action.title === "不应保留的行动"), false);
  assert.equal(inbox.getContentItemSummary(staleNewActionContentId).status, "inbox");

  const unrelatedTargetId = inbox.createLinkContentItem({ title: "未关联目标", url: "https://example.com/unrelated-target" });
  const unrelatedSourceId = inbox.createLinkContentItem({ title: "草稿实际资料", url: "https://example.com/unrelated-source" });
  const unrelatedDraftId = actions.createAction({ title: "未关联草稿", priority: "normal", status: "draft", contentItemIds: [unrelatedSourceId] });
  assert.throws(
    () => processing.processContentWithAcceptedDraft({ contentId: unrelatedTargetId, expectedContentRevision: inbox.getContentItemSummary(unrelatedTargetId).revision, actionId: unrelatedDraftId, expectedActionRevision: actions.getAction(unrelatedDraftId).revision }),
    (error) => error instanceof processing.InboxProcessingError && error.code === "action_not_linked",
  );
  assert.equal(actions.getAction(unrelatedDraftId).status, "draft");
  assert.equal(inbox.getContentItemSummary(unrelatedTargetId).status, "inbox");

  const staleActionContentId = inbox.createLinkContentItem({ title: "Action CAS 资料", url: "https://example.com/action-cas" });
  const staleActionDraftId = actions.createAction({ title: "Action CAS 草稿", priority: "normal", status: "draft", contentItemIds: [staleActionContentId] });
  const staleActionDraft = actions.getAction(staleActionDraftId);
  actions.updateActionDetails({ id: staleActionDraftId, title: "Action CAS 草稿已更新", priority: "normal", dueDate: null, projectId: null, expectedRevision: staleActionDraft.revision });
  assert.throws(
    () => processing.processContentWithAcceptedDraft({ contentId: staleActionContentId, expectedContentRevision: inbox.getContentItemSummary(staleActionContentId).revision, actionId: staleActionDraftId, expectedActionRevision: staleActionDraft.revision }),
    /action_revision_conflict/u,
  );
  assert.equal(actions.getAction(staleActionDraftId).status, "draft");
  assert.equal(inbox.getContentItemSummary(staleActionContentId).status, "inbox");

  const activeActionContentId = inbox.createLinkContentItem({ title: "非草稿资料", url: "https://example.com/not-draft" });
  const activeActionId = actions.createAction({ title: "已经正式的行动", priority: "normal", contentItemIds: [activeActionContentId] });
  assert.throws(
    () => processing.processContentWithAcceptedDraft({ contentId: activeActionContentId, expectedContentRevision: inbox.getContentItemSummary(activeActionContentId).revision, actionId: activeActionId, expectedActionRevision: actions.getAction(activeActionId).revision }),
    (error) => error instanceof actions.ActionContextError && error.code === "not_draft",
  );
  assert.equal(inbox.getContentItemSummary(activeActionContentId).status, "inbox");

  const staleContentId = inbox.createLinkContentItem({ title: "Content CAS 资料", url: "https://example.com/content-cas" });
  const staleContentBefore = inbox.getContentItemSummary(staleContentId);
  inbox.updateContentItem({ id: staleContentId, title: "Content CAS 资料已更新", status: "inbox", expectedRevision: staleContentBefore.revision });
  const rollbackDraftId = actions.createAction({ title: "接受后必须回滚", priority: "normal", status: "draft", contentItemIds: [staleContentId] });
  const rollbackDraftBefore = actions.getAction(rollbackDraftId);
  expectContentError(() => processing.processContentWithAcceptedDraft({
    contentId: staleContentId,
    expectedContentRevision: staleContentBefore.revision,
    actionId: rollbackDraftId,
    expectedActionRevision: rollbackDraftBefore.revision,
  }), "revision_conflict");
  assert.deepEqual(
    { status: actions.getAction(rollbackDraftId).status, revision: actions.getAction(rollbackDraftId).revision, contentStatus: inbox.getContentItemSummary(staleContentId).status },
    { status: "draft", revision: rollbackDraftBefore.revision, contentStatus: "inbox" },
    "Draft acceptance rolls back when the later Content CAS fails",
  );

  const multiA = inbox.createLinkContentItem({ title: "多资料 A", url: "https://example.com/multi-a" });
  const multiB = inbox.createLinkContentItem({ title: "多资料 B", url: "https://example.com/multi-b" });
  const multiC = inbox.createLinkContentItem({ title: "多资料 C", url: "https://example.com/multi-c" });
  const multiDraftId = actions.createAction({ title: "多资料草稿", priority: "normal", status: "draft", contentItemIds: [multiA, multiB, multiC] });
  const excludedActiveId = actions.createAction({ title: "不应返回 active", priority: "normal", contentItemIds: [multiA] });
  const excludedDoneId = actions.createAction({ title: "不应返回 done", priority: "normal", contentItemIds: [multiA] });
  actions.updateActionStatus(excludedDoneId, "done", actions.getAction(excludedDoneId).revision);
  const excludedTrashedDraftId = actions.createAction({ title: "不应返回 trashed", priority: "normal", status: "draft", contentItemIds: [multiA] });
  actions.trashAction(excludedTrashedDraftId, actions.getAction(excludedTrashedDraftId).revision);
  const draftRows = actions.listDraftActionsForContentItems([multiA, multiB]);
  assert.deepEqual(
    draftRows.map((row) => ({ contentId: row.content_item_id, actionId: row.id })),
    [{ contentId: multiA, actionId: multiDraftId }, { contentId: multiB, actionId: multiDraftId }],
    "the batch Draft read returns only live linked drafts for the requested Content IDs",
  );
  assert.equal(draftRows.some((row) => [excludedActiveId, excludedDoneId, excludedTrashedDraftId].includes(row.id)), false);
  const multiResult = processing.processContentWithAcceptedDraft({
    contentId: multiA,
    expectedContentRevision: inbox.getContentItemSummary(multiA).revision,
    actionId: multiDraftId,
    expectedActionRevision: actions.getAction(multiDraftId).revision,
  });
  assert.deepEqual(
    { actionStatus: actions.getAction(multiDraftId).status, actionRevision: actions.getAction(multiDraftId).revision, a: inbox.getContentItemSummary(multiA).status, b: inbox.getContentItemSummary(multiB).status, c: inbox.getContentItemSummary(multiC).status },
    { actionStatus: "active", actionRevision: multiResult.actionRevision, a: "processed", b: "inbox", c: "inbox" },
    "Processing one Content never processes the other Content linked to the same Draft",
  );

  const directAcceptContentId = inbox.createLinkContentItem({ title: "直接接受资料", url: "https://example.com/direct-accept" });
  const directAcceptDraftId = actions.createAction({ title: "直接接受草稿", priority: "normal", status: "draft", contentItemIds: [directAcceptContentId] });
  const directAcceptedRevision = actions.acceptDraftAction(directAcceptDraftId, actions.getAction(directAcceptDraftId).revision);
  assert.equal(actions.getAction(directAcceptDraftId).status, "active");
  assert.equal(inbox.getContentItemSummary(directAcceptContentId).status, "inbox", "the Actions-only acceptance contract never processes Content");
  const doneRevision = actions.updateActionStatus(directAcceptDraftId, "done", directAcceptedRevision);
  assert.equal(actions.getAction(directAcceptDraftId).status, "done");
  actions.updateActionStatus(directAcceptDraftId, "active", doneRevision);
  assert.equal(actions.getAction(directAcceptDraftId).status, "active");

  assert.equal(databaseModule.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(databaseModule.all("PRAGMA foreign_key_check"), []);
  console.log("Inbox Processing transaction test passed: explicit outcomes, owner contracts, CAS errors, rollback, relation checks and single-Content semantics.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
