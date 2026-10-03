import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryRoot = process.cwd();
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-state-safety-"));
process.env.EREMITE_DATA_DIR = temporaryRoot;
let databaseModule;

try {
  const { detailFormKey } = await import("@/app/_lib/detail-form-key");
  const { localDateKey, millisecondsUntilNextLocalDay, partitionByDueDate } = await import("@/app/_lib/local-date");
  const { tagPickerIdentity } = await import("@/app/_lib/tag-picker-state");
  const { classifyMutationError, mutationFailure, requiredRevision, InvalidMutationInputError } = await import("@/app/_lib/server-mutation-error");
  const { mutationNoticeMessage } = await import("@/app/_lib/mutation-result");
  const inbox = await import("@/modules/inbox/service");
  const actions = await import("@/modules/actions/service");
  const projects = await import("@/modules/projects/service");
  const { AutomationContextError } = await import("@/modules/automations/service");
  const { FolderError } = await import("@/modules/projects/folders");
  databaseModule = await import("@/platform/db/database");

  assert.equal(detailFormKey({ id: "content-a", revision: 7 }), "content-a:7");
  assert.notEqual(detailFormKey({ id: "content-a", revision: 7 }), detailFormKey({ id: "content-b", revision: 7 }));
  assert.notEqual(detailFormKey({ id: "content-a", revision: 7 }), detailFormKey({ id: "content-a", revision: 8 }));

  const assigned = [{ id: "tag-a", revision: 1, name: "重要" }];
  assert.notEqual(tagPickerIdentity("content", "content-a", assigned), tagPickerIdentity("content", "content-b", assigned), "equal Tag sets on different objects still have different state identities");
  assert.notEqual(tagPickerIdentity("content", "content-a", assigned), tagPickerIdentity("content", "content-a", [{ ...assigned[0], revision: 2, name: "复核" }]));

  assert.equal(localDateKey(new Date(2026, 7, 16, 0, 30)), "2026-08-16");
  const grouped = partitionByDueDate([
    { id: "past", due_date: "2026-08-15" },
    { id: "today", due_date: "2026-08-16" },
    { id: "future", due_date: "2026-08-17" },
    { id: "none", due_date: null },
  ], "2026-08-16");
  assert.deepEqual(grouped.overdue.map((item) => item.id), ["past"]);
  assert.deepEqual(grouped.today.map((item) => item.id), ["today"]);
  assert.deepEqual(grouped.next.map((item) => item.id), ["future", "none"]);
  assert.ok(millisecondsUntilNextLocalDay(new Date(2026, 7, 16, 23, 59, 59, 900)) <= 1_000);

  const validRevision = new FormData();
  validRevision.set("revision", "12");
  assert.equal(requiredRevision(validRevision), 12);
  for (const invalid of ["", "1.5", "-1", "latest", "9007199254740992"]) {
    const data = new FormData(); data.set("revision", invalid);
    assert.throws(() => requiredRevision(data), (error) => error instanceof InvalidMutationInputError);
  }

  assert.equal(classifyMutationError(new inbox.FileLifecycleError("revision_conflict")), "conflict");
  assert.equal(classifyMutationError(new Error("action_revision_conflict")), "conflict");
  assert.equal(classifyMutationError(new actions.ActionContextError("draft_confirmation_required")), "blocked");
  assert.equal(classifyMutationError(new actions.ActionContextError("not_draft")), "blocked");
  assert.equal(classifyMutationError(new FolderError("revision_conflict")), "conflict");
  assert.equal(classifyMutationError(new AutomationContextError("input_unavailable")), "unavailable");
  assert.equal(mutationNoticeMessage("action_revision_conflict"), "操作未能完成，请刷新后重试。", "unknown query values never expose internal error text");
  const internal = new Error("sensitive_database_detail");
  assert.throws(() => mutationFailure(internal), (error) => error === internal, "unexpected infrastructure errors remain exceptional");

  const lifecycleProjectId = projects.createProject({ name: "Project lifecycle CAS" });
  const initialProject = projects.getProject(lifecycleProjectId);
  projects.archiveProject(lifecycleProjectId, initialProject.revision);
  assert.throws(
    () => projects.trashProject(lifecycleProjectId, initialProject.revision),
    (error) => error instanceof projects.ProjectError && error.code === "revision_conflict",
    "a stale Project page cannot overwrite a newer lifecycle state",
  );
  const archivedProject = projects.getProject(lifecycleProjectId);
  projects.unarchiveProject(lifecycleProjectId, archivedProject.revision);
  const activeProject = projects.getProject(lifecycleProjectId);
  projects.trashProject(lifecycleProjectId, activeProject.revision);
  assert.throws(
    () => projects.restoreProject(lifecycleProjectId, activeProject.revision),
    (error) => error instanceof projects.ProjectError && error.code === "revision_conflict",
  );
  projects.restoreProject(lifecycleProjectId, projects.getProject(lifecycleProjectId).revision);
  assert.equal(projects.getProject(lifecycleProjectId).trashed_at, null);

  const contentA = inbox.createLinkContentItem({ title: "已有行动", url: "https://example.com/a" });
  const contentB = inbox.createLinkContentItem({ title: "可运行", url: "https://example.com/b" });
  const actionId = actions.createAction({ title: "关联行动", priority: "normal", contentItemIds: [contentA] });
  assert.deepEqual(actions.listContentItemIdsWithActions([contentA, contentB]), [contentA]);
  assert.deepEqual(actions.listContentItemIdsWithActions(), [contentA], "the page-level read avoids SQLite variable limits as data grows");
  const action = actions.getAction(actionId);
  actions.trashAction(actionId, action.revision);
  assert.deepEqual(actions.listContentItemIdsWithActions([contentA, contentB]), [contentA], "Trash 中的 Action still blocks duplicate automation output");
  actions.permanentlyDeleteAction(actionId);
  assert.deepEqual(actions.listContentItemIdsWithActions([contentA, contentB]), [], "permanent Action deletion removes the relationship through FK cascade");

  const [inboxWorkspace, actionsWorkspace, automationWorkspace, automationLauncher, automationTool, tagPicker, mutationForm, resourceActions, projectControls, projectsWorkspace] = await Promise.all([
    readFile(path.join(repositoryRoot, "src", "app", "_components", "inbox-workspace.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_components", "actions-workspace.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_components", "automations-workspace.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_components", "automations", "content-to-action-drafts-launcher.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "modules", "automations", "tools", "content-to-action-drafts.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_components", "tag-picker.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_components", "ui", "mutation-form.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "resource-actions.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_components", "project-lifecycle-controls.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_components", "projects-workspace.tsx"), "utf8"),
  ]);
  assert.match(inboxWorkspace, /key=\{detailFormKey\(selected\)\}/);
  assert.match(inboxWorkspace, /MutationForm[^>]*action=\{updateContentAction\}/);
  assert.match(actionsWorkspace, /MutationForm action=\{updateActionStatusAction\}/);
  assert.match(actionsWorkspace, /actionViewGroups\(actions, viewMode, today\)/);
  assert.match(actionsWorkspace, /MutationForm action=\{acceptActionDraftAction\}/);
  assert.match(automationTool, /listContentItemIdsWithActions\(page\.items\.map/);
  assert.match(automationLauncher, /disabled=\{pending \|\| !operationId \|\| selected\.length === 0\}/);
  assert.doesNotMatch(automationWorkspace, /listContentItems|contentWithActions/, "automation shell no longer owns eager input eligibility state");
  assert.match(tagPicker, /useEffect\(\(\) => \{[\s\S]*setOpen\(false\)[\s\S]*setQuery\(""\)[\s\S]*setNames\(assigned\.map/s);
  assert.match(mutationForm, /result = await action\(new FormData\(form\)\);[\s\S]*catch \(error\) \{[\s\S]*setFatalError\(asError\(error\)\)[\s\S]*if \(!result\.ok\)/s, "unexpected Server Action failures go to the fatal error boundary");
  assert.doesNotMatch(mutationForm, /catch[\s\S]{0,180}setFailure\(\{ ok: false/, "unexpected exceptions are never mislabeled as recoverable business failures");
  assert.ok(mutationForm.indexOf("onSuccess?.(result.value, form)") > mutationForm.indexOf("if (!result.ok)"), "success callbacks run only after the mutation result is known");
  for (const actionName of ["archiveProject", "unarchiveProject", "trashProject"]) {
    assert.match(resourceActions, new RegExp(`${actionName}\\(field\\(data, \\\"id\\\"\\), requiredRevision\\(data\\)\\)`));
  }
  assert.match(resourceActions, /restoreProject\(id, requiredRevision\(data\)\)/);
  assert.match(projectControls, /name="revision" value=\{project\.revision\}/);
  assert.match(projectsWorkspace, /name="revision" value=\{trashTarget\.revision\}/);
  assert.match(projectsWorkspace, /name="revision" value=\{project\.revision\}/);

  assert.equal(databaseModule.one("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(databaseModule.all("PRAGMA foreign_key_check"), []);
  console.log("State safety test passed: object generations, Tag reset identity, local dates, public conflicts, strict revisions and automation eligibility.");
} finally {
  databaseModule?.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
