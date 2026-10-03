import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-unified-objects-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let databaseModule;

try {
  databaseModule = await import("@/platform/db/database");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const inbox = await import("@/modules/inbox/service");
  const actions = await import("@/modules/actions/service");
  const automations = await import("@/modules/automations/service");
  const tags = await import("@/modules/tags/service");
  const processing = await import("@/app/_services/inbox-processing");

  const projectA = projects.createProject({ name: "Project A" });
  const projectB = projects.createProject({ name: "Project B" });
  const folderA = folders.createFolder({ projectId: projectA, name: "Folder A" });
  const itemA = inbox.createLinkContentItem({ title: "A", url: "https://example.com/a", projectId: projectA, folderId: folderA });
  const itemB = inbox.createLinkContentItem({ title: "B", url: "https://example.com/b", projectId: projectB });
  assert.ok(inbox.listContentItems().some((item) => item.id === itemA), "contextual creation is immediately visible in the global Library");
  const itemAIdentity = inbox.getContentItemSummary(itemA);
  inbox.moveContentItems({ ids: [{ id: itemA, expectedRevision: itemAIdentity.revision }], projectId: null, folderId: null });
  assert.deepEqual({ id: inbox.getContentItemSummary(itemA).id, projectId: inbox.getContentItemSummary(itemA).project_id, folderId: inbox.getContentItemSummary(itemA).folder_id }, { id: itemA, projectId: null, folderId: null });
  inbox.moveContentItems({ ids: [{ id: itemA, expectedRevision: inbox.getContentItemSummary(itemA).revision }], projectId: projectA, folderId: folderA });

  const runCount = () => Number(databaseModule.one("SELECT COUNT(*) AS count FROM automation_runs").count);
  assert.throws(() => automations.runInboxToDrafts([]), (error) => error instanceof automations.AutomationContextError && error.code === "no_inputs");
  assert.equal(runCount(), 0, "invalid Automation input must fail before a Run is inserted");
  assert.throws(() => automations.runInboxToDrafts([itemA, itemB]), (error) => error instanceof automations.AutomationContextError && error.code === "mixed_projects");
  assert.equal(runCount(), 0);
  assert.throws(() => automations.runInboxToDrafts([itemA], projectB), (error) => error instanceof automations.AutomationContextError && error.code === "project_mismatch");
  assert.equal(runCount(), 0);

  const runId = automations.runInboxToDrafts([itemA], projectA);
  const runBeforeTrash = databaseModule.one("SELECT * FROM automation_runs WHERE id = ?", runId);
  automations.trashAutomationRun(runId, runBeforeTrash.revision);
  projects.archiveProject(projectA, projects.getProject(projectA).revision);
  const restore = automations.restoreAutomationRun(runId, databaseModule.one("SELECT revision FROM automation_runs WHERE id = ?", runId).revision);
  assert.equal(restore.projectId, projectA, "Run restore preserves immutable execution provenance");
  assert.equal(databaseModule.one("SELECT project_id FROM automation_runs WHERE id = ?", runId).project_id, projectA);
  assert.equal("moveAutomationRunsToProject" in automations, false, "completed Runs expose no move contract");
  projects.unarchiveProject(projectA, projects.getProject(projectA).revision);

  const unclassifiedOne = inbox.createLinkContentItem({ title: "One", url: "https://example.com/one" });
  const unclassifiedTwo = inbox.createLinkContentItem({ title: "Two", url: "https://example.com/two" });
  const oneBefore = inbox.getContentItemSummary(unclassifiedOne);
  const twoBefore = inbox.getContentItemSummary(unclassifiedTwo);
  assert.throws(
    () => inbox.moveContentItems({ ids: [{ id: unclassifiedOne, expectedRevision: oneBefore.revision }, { id: unclassifiedTwo, expectedRevision: twoBefore.revision + 1 }], projectId: projectB, folderId: null }),
    (error) => error instanceof inbox.FileLifecycleError && error.code === "revision_conflict",
  );
  assert.equal(inbox.getContentItemSummary(unclassifiedOne).project_id, null, "multi-item CAS rolls back the complete move");
  assert.throws(
    () => inbox.moveContentItems({ ids: [{ id: unclassifiedOne, expectedRevision: oneBefore.revision }], projectId: projectB, folderId: folderA }),
    (error) => error instanceof inbox.FileLifecycleError && error.code === "invalid_location",
  );

  inbox.updateContentItem({ id: unclassifiedOne, title: "One updated", status: "inbox", expectedRevision: oneBefore.revision });
  processing.processContentWithoutAction({ contentId: unclassifiedOne, expectedContentRevision: inbox.getContentItemSummary(unclassifiedOne).revision });
  assert.throws(
    () => inbox.updateContentItem({ id: unclassifiedOne, title: "stale", status: "processed", expectedRevision: oneBefore.revision }),
    (error) => error instanceof inbox.FileLifecycleError && error.code === "revision_conflict",
  );
  tags.setTagsByNames("content", unclassifiedOne, ["Important"]);
  assert.equal(databaseModule.one("SELECT tags FROM content_items WHERE id = ?", unclassifiedOne).tags, "Important");

  const actionId = actions.createAction({ title: "Action", priority: "normal" });
  const action = actions.listActions().find((item) => item.id === actionId);
  actions.updateActionStatus(actionId, "done", action.revision);
  assert.throws(() => actions.updateActionStatus(actionId, "active", action.revision), /action_revision_conflict/);

  assert.equal(databaseModule.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(databaseModule.all("PRAGMA foreign_key_check"), []);
  console.log("Unified object contracts test passed: CAS writes, atomic moves, Tag projection and immutable Run provenance.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
