import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-context-views-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let databaseModule;

try {
  databaseModule = await import("@/platform/db/database");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const inbox = await import("@/modules/inbox/service");
  const actions = await import("@/modules/actions/service");
  const automations = await import("@/modules/automations/service");

  const projectA = projects.createProject({ name: "Project A" });
  const projectB = projects.createProject({ name: "Project B" });
  const folder = folders.createFolder({ projectId: projectA, name: "Sources" });
  const contentId = inbox.createLinkContentItem({ title: "Source", url: "https://example.com/source", projectId: projectA, folderId: folder });

  const actionId = actions.createAction({ title: "From Content", priority: "normal", contentItemIds: [contentId] });
  const inheritedAction = actions.getAction(actionId);
  assert.equal(inheritedAction.project_id, projectA, "an Action created from Content inherits its Project when no explicit context is supplied");
  assert.equal("folder_id" in inheritedAction, false, "Actions never inherit the source Content folder");
  assert.equal(actions.listActions().find((item) => item.id === actionId)?.id, actionId);
  assert.equal(actions.listProjectActions(projectA).find((item) => item.id === actionId)?.id, actionId, "global and Project views expose the same Action row");

  actions.moveActionsToProject({ ids: [{ id: actionId, expectedRevision: inheritedAction.revision }], projectId: projectB });
  const movedAction = actions.getAction(actionId);
  assert.equal(movedAction.id, actionId);
  assert.equal(movedAction.project_id, projectB);
  assert.equal(actions.listActionContentLinks([actionId])[0]?.content_item_id, contentId, "moving an Action preserves Content links");
  actions.moveActionsToProject({ ids: [{ id: actionId, expectedRevision: movedAction.revision }], projectId: null });
  const unassignedAction = actions.getAction(actionId);
  assert.equal(unassignedAction.project_id, null);

  const detailsRevision = actions.updateActionDetails({ id: actionId, title: "Edited without replacement", priority: "high", dueDate: "2026-08-21", projectId: projectA, expectedRevision: unassignedAction.revision });
  assert.equal(actions.getAction(actionId).id, actionId, "editing metadata preserves stable Action identity");
  assert.equal(actions.getAction(actionId).priority, "high");
  assert.equal(actions.getAction(actionId).due_date, "2026-08-21");
  assert.throws(() => actions.updateActionDetails({ id: actionId, title: "stale", priority: "normal", dueDate: null, projectId: null, expectedRevision: unassignedAction.revision }), /action_revision_conflict/);

  const relationRevision = actions.replaceActionContentItems({ id: actionId, contentItemIds: [contentId], expectedRevision: detailsRevision });
  assert.deepEqual(actions.listActionContentLinks([actionId]), [{ action_id: actionId, content_item_id: contentId }], "relation replacement preserves the original Content identity");
  const doneRevision = actions.updateActionStatus(actionId, "done", relationRevision);
  assert.equal(actions.getAction(actionId).status, "done");
  actions.updateActionStatus(actionId, "active", doneRevision);
  assert.equal(actions.getAction(actionId).status, "active", "completed Actions can be restored to the open list");
  assert.throws(() => actions.createAction({ title: "Bad date", priority: "normal", dueDate: "2026-02-30" }), (error) => error instanceof actions.ActionContextError && error.code === "invalid_due_date");

  inbox.trashContentItem(contentId, inbox.getContentItemSummary(contentId).revision);
  assert.throws(() => actions.createAction({ title: "Unavailable source", priority: "normal", contentItemIds: [contentId] }), (error) => error instanceof actions.ActionContextError && error.code === "content_unavailable");
  inbox.restoreContentItem(contentId, inbox.getContentItemSummary(contentId).revision);

  const runId = automations.runInboxToDrafts([contentId], projectA);
  assert.equal(automations.listAutomationRuns().find((run) => run.id === runId)?.id, runId);
  assert.equal(automations.listProjectAutomationRuns(projectA).find((run) => run.id === runId)?.id, runId, "global and Project views expose the same historical Run");
  assert.equal("moveAutomationRunsToProject" in automations, false);
  const run = databaseModule.one("SELECT * FROM automation_runs WHERE id = ?", runId);
  automations.trashAutomationRun(runId, run.revision);
  automations.restoreAutomationRun(runId, databaseModule.one("SELECT revision FROM automation_runs WHERE id = ?", runId).revision);
  assert.deepEqual(databaseModule.one("SELECT project_id, project_name_snapshot FROM automation_runs WHERE id = ?", runId), { project_id: projectA, project_name_snapshot: "Project A" });

  assert.equal(databaseModule.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(databaseModule.all("PRAGMA foreign_key_check"), []);
  console.log("Action/Automation context test passed: inheritance, shared identity, mutable Action organization, unavailable input rejection and immutable Run provenance.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
