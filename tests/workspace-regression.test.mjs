import assert from "node:assert/strict";
import { File } from "node:buffer";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = process.cwd();
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-workspace-regression-"));
let databaseModule;

const waitForNextTimestamp = () => new Promise((resolve) => setTimeout(resolve, 5));

try {
  await cp(path.join(repositoryRoot, "db"), path.join(temporaryRoot, "db"), { recursive: true });
  process.chdir(temporaryRoot);

  databaseModule = await import("@/platform/db/database");
  const inbox = await import("@/modules/inbox/service");
  const actions = await import("@/modules/actions/service");
  const automations = await import("@/modules/automations/service");
  const projects = await import("@/modules/projects/service");
  const processing = await import("@/app/_services/inbox-processing");
  const { detailFormKey } = await import("@/app/_lib/detail-form-key");
  const { workspaceRoutes, workspaceRevalidationPaths } = await import("@/app/_lib/workspace-routes");
  const { buildWorkspaceSearchEntries } = await import(pathToFileURL(path.join(repositoryRoot, "src", "app", "_lib", "workspace-search.js")).href);

  const { all, one, run, db } = databaseModule;
  run("CREATE TABLE regression_rows (id TEXT PRIMARY KEY, label TEXT NOT NULL) STRICT");
  run("INSERT INTO regression_rows (id, label) VALUES (?, ?)", "row-1", "plain object");
  assert.equal(Object.getPrototypeOf(all("SELECT * FROM regression_rows")[0]), Object.prototype);
  assert.equal(Object.getPrototypeOf(one("SELECT * FROM regression_rows WHERE id = ?", "row-1")), Object.prototype);

  const linkId = inbox.createLinkContentItem({ title: "可检索链接资料", url: "https://example.com/regression" });
  const tags = await import("@/modules/tags/service");
  tags.setTagsByNames("content", linkId, ["学习", "回归"]);
  const originalLink = inbox.listContentItems().find((item) => item.id === linkId);
  assert.deepEqual({ title: originalLink.title, tags: originalLink.tags, status: originalLink.status }, { title: "可检索链接资料", tags: "回归, 学习", status: "inbox" });
  assert.equal(Object.getPrototypeOf(originalLink), Object.prototype);

  await waitForNextTimestamp();
  inbox.updateContentItem({ id: linkId, title: "已处理链接资料", status: "inbox", expectedRevision: originalLink.revision });
  const renamedLink = inbox.getContentItemSummary(linkId);
  processing.processContentWithoutAction({ contentId: linkId, expectedContentRevision: renamedLink.revision });
  tags.setTagsByNames("content", linkId, ["学习", "已处理"]);
  const updatedLink = inbox.listContentItems().find((item) => item.id === linkId);
  assert.deepEqual({ title: updatedLink.title, tags: updatedLink.tags, status: updatedLink.status }, { title: "已处理链接资料", tags: "学习, 已处理", status: "processed" });
  assert.notEqual(detailFormKey(originalLink), detailFormKey(updatedLink));

  const fileId = await inbox.createFileContentItem(new File(["isolated file fixture"], "source-note.txt", { type: "text/plain" }), "上传文件资料");
  const uploadedFile = inbox.listContentItems().find((item) => item.id === fileId);
  assert.equal(uploadedFile.kind, "file");
  assert.equal(uploadedFile.original_name, "source-note.txt");
  assert.ok(uploadedFile.storage_key);

  const standaloneActionId = actions.createAction({ title: "独立行动", priority: "low", dueDate: "2026-09-01" });
  const linkedActionId = actions.createAction({ title: "资料行动", priority: "high", dueDate: "2026-08-20", contentItemIds: [linkId] });
  const linkedAction = actions.listActions().find((action) => action.id === linkedActionId);
  assert.deepEqual({ title: linkedAction.title, priority: linkedAction.priority, dueDate: linkedAction.due_date, sourceCount: linkedAction.source_count }, { title: "资料行动", priority: "high", dueDate: "2026-08-20", sourceCount: 1 });
  assert.deepEqual(actions.listActionContentLinks([linkedActionId]), [{ action_id: linkedActionId, content_item_id: linkId }]);
  assert.ok(actions.listActions().some((action) => action.id === standaloneActionId));

  const doneRevision = actions.updateActionStatus(linkedActionId, "done", linkedAction.revision);
  assert.equal(Boolean(actions.getAction(linkedActionId).completed_at), true);
  const activeRevision = actions.updateActionStatus(linkedActionId, "active", doneRevision);
  assert.equal(actions.getAction(linkedActionId).completed_at, null);
  const cancelledRevision = actions.updateActionStatus(linkedActionId, "cancelled", activeRevision);
  actions.updateActionStatus(linkedActionId, "archived", cancelledRevision);
  const archivedAction = actions.listActions().find((action) => action.id === linkedActionId);
  assert.equal(archivedAction.status, "archived");
  assert.notEqual(detailFormKey(linkedAction), detailFormKey(archivedAction));

  const automationSourceId = inbox.createLinkContentItem({ title: "自动化资料", url: "https://example.com/automation" });
  const successfulRunId = automations.runInboxToDrafts([automationSourceId]);
  const successfulRun = automations.listAutomationRuns().find((run) => run.id === successfulRunId);
  assert.deepEqual({ status: successfulRun.status, output: successfulRun.output_summary }, { status: "completed", output: "创建 1 个草稿；跳过 0 条已有行动的资料。" });
  assert.equal(actions.hasActionForContentItem(automationSourceId), true);
  const draft = actions.listActions().find((action) => action.status === "draft");
  assert.ok(draft, "Automation output remains a draft until the user accepts it");
  const sourceStatusBeforeAcceptance = inbox.getContentItemSummary(automationSourceId).status;
  for (const target of ["active", "done", "cancelled", "archived"]) {
    assert.throws(
      () => actions.updateActionStatus(draft.id, target, draft.revision),
      (error) => error instanceof actions.ActionContextError && error.code === "draft_confirmation_required",
      `generic status updates must reject draft -> ${target}`,
    );
    assert.deepEqual({ status: actions.getAction(draft.id).status, revision: actions.getAction(draft.id).revision }, { status: "draft", revision: draft.revision });
  }

  const draftProjectId = projects.createProject({ name: "Draft confirmation" });
  const detailsRevision = actions.updateActionDetails({ id: draft.id, title: "已编辑行动草稿", priority: "high", dueDate: "2026-08-19", projectId: draftProjectId, expectedRevision: draft.revision });
  const relationRevision = actions.replaceActionContentItems({ id: draft.id, contentItemIds: [automationSourceId, linkId], expectedRevision: detailsRevision });
  tags.setTagsByNames("action", draft.id, ["待复核"]);
  const editedDraft = actions.getAction(draft.id);
  assert.deepEqual(
    { title: editedDraft.title, status: editedDraft.status, priority: editedDraft.priority, dueDate: editedDraft.due_date, projectId: editedDraft.project_id },
    { title: "已编辑行动草稿", status: "draft", priority: "high", dueDate: "2026-08-19", projectId: draftProjectId },
  );
  assert.deepEqual(actions.listActionContentLinks([draft.id]).map((link) => link.content_item_id).sort(), [automationSourceId, linkId].sort());
  assert.deepEqual(tags.listObjectTags("action", draft.id).map((tag) => tag.name), ["待复核"]);
  assert.throws(() => actions.acceptDraftAction(draft.id, draft.revision), /action_revision_conflict/, "draft acceptance retains revision CAS");
  await waitForNextTimestamp();
  const acceptedRevision = actions.acceptDraftAction(draft.id, relationRevision);
  const accepted = actions.getAction(draft.id);
  assert.deepEqual({ status: accepted.status, completedAt: accepted.completed_at, revision: accepted.revision }, { status: "active", completedAt: null, revision: acceptedRevision });
  assert.notEqual(accepted.updated_at, editedDraft.updated_at);
  assert.equal(inbox.getContentItemSummary(automationSourceId).status, sourceStatusBeforeAcceptance, "accepting an Action draft never processes linked Content");
  assert.throws(
    () => actions.acceptDraftAction(draft.id, acceptedRevision),
    (error) => error instanceof actions.ActionContextError && error.code === "not_draft",
    "a non-draft cannot be accepted again",
  );
  const acceptedDoneRevision = actions.updateActionStatus(draft.id, "done", acceptedRevision);
  assert.equal(actions.getAction(draft.id).status, "done");
  actions.updateActionStatus(draft.id, "active", acceptedDoneRevision);
  assert.equal(actions.getAction(draft.id).status, "active", "accepted Actions retain the normal done -> active flow");

  const skippedRunId = automations.runInboxToDrafts([automationSourceId]);
  const skippedRun = automations.listAutomationRuns().find((run) => run.id === skippedRunId);
  assert.deepEqual({ status: skippedRun.status, output: skippedRun.output_summary }, { status: "completed", output: "创建 0 个草稿；跳过 1 条已有行动的资料。" });

  const failureSourceId = inbox.createLinkContentItem({ title: "失败资料", url: "https://example.com/failure" });
  db().exec("CREATE TRIGGER regression_force_automation_failure BEFORE INSERT ON actions BEGIN SELECT RAISE(ABORT, 'Regression forced draft failure'); END;");
  const failedRunId = automations.runInboxToDrafts([failureSourceId]);
  db().exec("DROP TRIGGER regression_force_automation_failure");
  const failedRun = automations.listAutomationRuns().find((run) => run.id === failedRunId);
  assert.equal(failedRun.status, "failed");
  assert.equal(failedRun.error_code, "execution_failed");
  assert.doesNotMatch(failedRun.error_message, /Regression forced draft failure/);
  assert.equal(actions.hasActionForContentItem(failureSourceId), false);

  const searchEntries = buildWorkspaceSearchEntries({ content: inbox.listContentItems(), actions: actions.listActions(), runs: automations.listAutomationRuns() });
  assert.ok(searchEntries.some((entry) => entry.id === `content:${linkId}` && entry.title === "已处理链接资料" && entry.href.includes(linkId)));
  assert.ok(searchEntries.some((entry) => entry.id === `action:${standaloneActionId}` && entry.title === "独立行动" && entry.href.includes(standaloneActionId)));
  assert.ok(searchEntries.some((entry) => entry.id === `run:${failedRunId}` && entry.href.includes(failedRunId)));
  assert.deepEqual(workspaceRevalidationPaths, [workspaceRoutes.inbox, workspaceRoutes.actions, workspaceRoutes.automations]);

  const [workspaceShell, paletteKeyboard, rootPage, workspaceLayout, serverActions, inboxWorkspace, uploadClient, uploadRoute, nextConfig, actionsWorkspace, automationsWorkspace, archiveRenderer] = await Promise.all([
    readFile(path.join(repositoryRoot, "src", "app", "_components", "workspace-shell.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_lib", "command-palette-keyboard.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "page.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "(workspace)", "layout.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "actions.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_components", "inbox-workspace.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_lib", "file-upload-client.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "uploads", "files", "route.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "next.config.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_components", "actions-workspace.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_components", "automations-workspace.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "app", "_components", "file-viewer", "renderers", "archive-renderer.tsx"), "utf8"),
  ]);
  for (const href of ["/inbox", "/actions", "/automations", "/inbox?create=1", "/actions?create=1"]) assert.match(workspaceShell, new RegExp(href.replace(/[?]/g, "\\?")));
  assert.match(rootPage, /redirect\("\/inbox"\)/);
  assert.match(workspaceLayout, /requireAuthorized\(\)/);
  assert.match(serverActions, /workspaceRevalidationPaths\.forEach\(\(path\) => revalidatePath\(path\)\)/);
  const acceptDraftServerAction = serverActions.match(/export async function acceptActionDraftAction\(formData: FormData\) \{[\s\S]*?\n\}/u)?.[0] ?? "";
  assert.match(acceptDraftServerAction, /acceptDraftAction\(value\(formData, "id"\), requiredRevision\(formData\)\)/);
  assert.doesNotMatch(acceptDraftServerAction, /value\(formData, "status"\)/, "the client cannot choose the accepted draft's target status");
  assert.match(serverActions, /redirect\("\/login\?error=incorrect-password"\)/);
  assert.doesNotMatch(serverActions, /uploadContentAction|createFileContentItem\(/);
  assert.match(inboxWorkspace, /uploadSelectedFile/);
  assert.match(inboxWorkspace, /new globalThis\.FormData\(form\)/);
  assert.doesNotMatch(inboxWorkspace, /instanceof\s+File\b/);
  assert.match(uploadClient, /instanceof globalThis\.File/);
  assert.match(uploadClient, /fetcher\("\/uploads\/files"/);
  assert.match(uploadRoute, /createFileContentItemFromStream/);
  assert.doesNotMatch(nextConfig, /bodySizeLimit|serverActions/);
  assert.match(inboxWorkspace, /name="revision" value=\{selected\.revision\}/);
  assert.match(actionsWorkspace, /<ActionInspector key=\{selected\.id\}/);
  assert.match(automationsWorkspace, /run\.error_message/);
  assert.match(automationsWorkspace, /run-inspector/);
  assert.doesNotMatch(inboxWorkspace, /quick-viewer-actions/);
  for (const source of [inboxWorkspace, actionsWorkspace, automationsWorkspace, archiveRenderer]) {
    assert.doesNotMatch(source, /import\s*\{[^}]*\bFile\s*(?:,|\})[^}]*\}\s*from\s*["']lucide-react["']/s);
  }
  assert.match(workspaceShell, /resolvePaletteKey\(event\.key, activeResult, candidateCount\)/);
  assert.match(workspaceShell, /setActiveResult\(0\)/);
  assert.match(workspaceShell, /eremite:open-command/);
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) assert.match(paletteKeyboard, new RegExp(key));

  db().close();
  databaseModule = undefined;
  console.log("Workspace regression test passed.");
} finally {
  process.chdir(repositoryRoot);
  if (databaseModule) databaseModule.db().close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
