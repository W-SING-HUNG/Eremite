import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectWorkspaceHeader } from "@/app/_components/project-workspace-header";
import { ProjectContentWorkspace } from "@/app/_components/project-content-workspace";
import { ActionsWorkspace } from "@/app/_components/actions-workspace";
import { AutomationsWorkspace } from "@/app/_components/automations-workspace";
import { updateProjectAction } from "@/app/resource-actions";
import { listActionContentLinks, listDraftActionsForContentItems, listProjectActionsPage } from "@/modules/actions/service";
import { listProjectAutomationRunsPage } from "@/modules/automations/service";
import { reconcileInterruptedAutomationRuns } from "@/modules/automations/reconciliation";
import { listTools } from "@/modules/automations/registry";
import { listAvailableContentItemsByIds, listContentItemsInFolderPage } from "@/modules/inbox/service";
import { listChildFoldersPage, listProjectFolders } from "@/modules/projects/folders";
import { getProject, listProjects } from "@/modules/projects/service";
import { listObjectTagsMap, listTags } from "@/modules/tags/service";
import { mutationNoticeMessage } from "@/app/_lib/mutation-result";

export default async function ProjectPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; view?: string; tool?: string; error?: string; success?: string; create?: string; selected?: string; preview?: string; processing?: string; folderCursor?: string; contentCursor?: string; actionCursor?: string; runCursor?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const project = getProject(id);
  if (!project || project.trashed_at) notFound();
  const tab = ["content", "actions", "automations", "settings"].includes(query.tab ?? "") ? query.tab! : "content";
  const projects = listProjects();
  const availableTags = listTags();
  const folderPage = tab === "content" ? listChildFoldersPage(id, null, { cursor: query.folderCursor, limit: 50 }) : null;
  const contentPage = tab === "content" ? listContentItemsInFolderPage(id, null, { cursor: query.contentCursor, limit: 50 }) : null;
  const actionPage = tab === "actions" ? listProjectActionsPage(id, { cursor: query.actionCursor, limit: 50 }) : null;
  if (tab === "automations") reconcileInterruptedAutomationRuns();
  const runPage = tab === "automations" ? listProjectAutomationRunsPage(id, { cursor: query.runCursor, limit: 50 }) : null;
  const actionLinks = actionPage ? listActionContentLinks(actionPage.items.map((item) => item.id)) : [];
  const actionContent = listAvailableContentItemsByIds(actionLinks.map((link) => link.content_item_id));
  const archived = Boolean(project.archived_at);

  return <section className="workspace-view resource-page">
    <ProjectWorkspaceHeader project={project} activeTab={tab as "content" | "actions" | "automations" | "settings"} />
    {query.error && <div className="integrity-notice">{mutationNoticeMessage(query.error)}</div>}
    {query.success && <div className="success-notice">操作已完成。</div>}
    {tab === "content" && folderPage && contentPage && <ProjectContentWorkspace project={project} projects={projects} allFolders={listProjectFolders(id)} currentFolder={null} breadcrumbs={[]} childFolders={folderPage.items} content={contentPage.items} tagsByContent={listObjectTagsMap("content", contentPage.items.map((item) => item.id))} availableTags={availableTags} linkedDrafts={listDraftActionsForContentItems(contentPage.items.map((item) => item.id))} initialCreate={query.create === "1"} initialSelectedId={query.selected} initialPreview={query.preview === "1"} initialProcessing={query.processing === "1"} returnTo={`/projects/${id}`} folderCursor={query.folderCursor} contentCursor={query.contentCursor} nextFolderCursor={folderPage.nextCursor} nextContentCursor={contentPage.nextCursor} />}
    {tab === "actions" && actionPage && <><ActionsWorkspace actions={actionPage.items} content={actionContent} projects={projects} tagsByAction={listObjectTagsMap("action", actionPage.items.map((item) => item.id))} availableTags={availableTags} links={actionLinks} initialCreate={query.create === "1"} initialSelectedId={query.selected} contextProjectId={id} compactHeader readOnly={archived} />{actionPage.nextCursor && <Link className="page-next" href={`/projects/${id}?tab=actions&actionCursor=${encodeURIComponent(actionPage.nextCursor)}`}>下一页</Link>}</>}
    {tab === "automations" && runPage && <><AutomationsWorkspace tools={listTools("project")} tagsByRun={listObjectTagsMap("automation_run", runPage.items.map((item) => item.id))} availableTags={availableTags} runs={runPage.items} initialView={query.view === "runs" ? "runs" : "tools"} initialToolId={query.tool} initialSelectedId={query.selected} contextProjectId={id} compactHeader readOnly={archived} />{runPage.nextCursor && <Link className="page-next" href={`/projects/${id}?tab=automations&view=runs&runCursor=${encodeURIComponent(runPage.nextCursor)}`}>下一页</Link>}</>}
    {tab === "settings" && <div className="project-settings">
      <section><header><h2>专案信息</h2><p>名称会显示在专案导航中，说明用于概括这项工作的用途。</p></header><form action={updateProjectAction} className="drawer-form"><input type="hidden" name="id" value={id} /><input type="hidden" name="revision" value={project.revision} /><input type="hidden" name="returnTo" value={`/projects/${id}?tab=settings`} /><label>名称<input name="name" defaultValue={project.name} required /></label><label>用途说明<textarea name="description" defaultValue={project.description} rows={4} /></label><button className="primary-button">保存更改</button></form></section>
    </div>}
  </section>;
}
