import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-classification-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let databaseModule;
try {
  databaseModule = await import("@/platform/db/database");
  const projects = await import("@/modules/projects/service");
  const folders = await import("@/modules/projects/folders");
  const inbox = await import("@/modules/inbox/service");
  const tags = await import("@/modules/tags/service");
  const automations = await import("@/modules/automations/service");
  const actions = await import("@/modules/actions/service");
  const operations = await import("@/app/_services/resource-operations");

  const projectId = projects.createProject({ name: "产品", description: "v1.2" });
  const folderId = folders.createFolder({ projectId, name: "研究" });
  const fileId = await inbox.createFileContentItemFromStream({
    body: new File([Buffer.from("immutable")], "source.txt", { type: "text/plain" }).stream(), originalName: "source.txt", mimeType: "text/plain", expectedSize: 9, projectId, folderId,
  });
  const first = inbox.getFileAssetForViewing(fileId);
  const linkId = inbox.createLinkContentItem({ title: "官方资料", url: "https://example.com", projectId, folderId });

  tags.setTagsByNames("content", fileId, ["参考", "产品"]);
  assert.deepEqual(tags.listObjectTags("content", fileId).map((tag) => tag.name), ["产品", "参考"]);
  assert.equal(inbox.getContentItemSummary(fileId).id, fileId);
  assert.equal(databaseModule.db().prepare("SELECT tags FROM content_items WHERE id = ?").get(fileId).tags, "产品, 参考", "v1.1 tag text remains a synchronized compatibility projection");
  const sourceTag = tags.listTags().find((tag) => tag.name === "参考");
  const targetTag = tags.listTags().find((tag) => tag.name === "产品");
  tags.mergeTags(sourceTag.id, targetTag.id);
  assert.deepEqual(tags.listObjectTags("content", fileId).map((tag) => tag.name), ["产品"]);

  const runId = automations.runInboxToDrafts([fileId], projectId);
  const run = databaseModule.db().prepare("SELECT * FROM automation_runs WHERE id = ?").get(runId);
  assert.equal(run.project_id, projectId);
  assert.equal(run.project_name_snapshot, "产品");
  const runInput = databaseModule.db().prepare("SELECT * FROM automation_run_inputs WHERE run_id = ?").get(runId);
  assert.equal(runInput.file_version_id, first.versionId, "automation input pins the immutable version observed at execution");
  const generatedOutput = databaseModule.db().prepare("SELECT action_id FROM automation_run_outputs WHERE run_id = ? ORDER BY ordinal LIMIT 1").get(runId);
  const generated = databaseModule.db().prepare("SELECT * FROM actions WHERE id = ?").get(generatedOutput.action_id);
  assert.equal(generated.status, "draft");
  assert.equal(generated.project_id, projectId);

  folders.trashFolder(folderId, folders.getFolder(folderId).revision);
  await assert.rejects(() => inbox.replaceFileContentItemFromStream({
    contentId: fileId, expectedVersionId: first.versionId, idempotencyKey: "trash-write", body: new File(["changed"], "source.txt", { type: "text/plain" }).stream(), originalName: "source.txt", mimeType: "text/plain",
  }), (error) => error instanceof inbox.FileLifecycleError && error.code === "not_found");
  assert.equal(inbox.getFileAssetForViewing(fileId).sha256, first.sha256, "Trash remains readable without allowing mutation");
  folders.restoreFolder(folderId, folders.getFolder(folderId).revision);

  inbox.trashContentItem(linkId, inbox.getContentItemSummary(linkId).revision);
  const restoredLink = inbox.restoreContentItem(linkId, inbox.getContentItemSummary(linkId).revision);
  assert.equal(restoredLink.folderId, folderId);

  actions.trashAction(generated.id, databaseModule.db().prepare("SELECT revision FROM actions WHERE id = ?").get(generated.id).revision);
  actions.restoreAction(generated.id, databaseModule.db().prepare("SELECT revision FROM actions WHERE id = ?").get(generated.id).revision);
  projects.trashProject(projectId, projects.getProject(projectId).revision);
  const description = operations.describeProjectPermanentDeletion(projectId);
  operations.permanentlyDeleteProjectWorkspace({ projectId, expectedFolders: description.folders, expectedContent: description.content, expectedActions: description.actions, expectedRuns: description.runs });
  assert.equal(inbox.getContentItemSummary(fileId).project_id, null);
  assert.equal(inbox.getFileAssetForViewing(fileId).versionId, first.versionId);
  assert.equal(databaseModule.db().prepare("SELECT project_id FROM actions WHERE id = ?").get(generated.id).project_id, null);
  assert.equal(databaseModule.db().prepare("SELECT project_name_snapshot FROM automation_runs WHERE id = ?").get(runId).project_name_snapshot, "产品");
  assert.equal(databaseModule.db().prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(databaseModule.db().prepare("PRAGMA foreign_key_check").all(), []);
  console.log("Project classification test passed: Project/Folder/Tag roles, pinned automation inputs, Trash write blocking and non-destructive Project deletion.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
