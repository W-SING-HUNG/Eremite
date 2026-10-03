import { redirect } from "next/navigation";
import { ProjectWorkspaceHeader } from "@/app/_components/project-workspace-header";
import { ProjectContentWorkspace } from "@/app/_components/project-content-workspace";
import { listContentItemsInFolderPage } from "@/modules/inbox/service";
import { getFolder, getFolderBreadcrumbs, isFolderAvailable, listChildFoldersPage, listProjectFolders } from "@/modules/projects/folders";
import { getProject, listProjects } from "@/modules/projects/service";
import { listObjectTagsMap, listTags } from "@/modules/tags/service";
import { mutationNoticeMessage } from "@/app/_lib/mutation-result";
import { listDraftActionsForContentItems } from "@/modules/actions/service";

export default async function FolderPage({ params, searchParams }: {
  params: Promise<{ id: string; folderId: string }>;
  searchParams: Promise<{ error?: string; success?: string; create?: string; selected?: string; preview?: string; processing?: string; folderCursor?: string; contentCursor?: string }>;
}) {
  const [{ id, folderId }, query] = await Promise.all([params, searchParams]);
  const project = getProject(id);
  if (!project || project.trashed_at) redirect("/projects?error=project_unavailable");
  const folder = isFolderAvailable(folderId, id);
  if (!folder || getFolder(folderId)?.project_id !== id) redirect(`/projects/${id}?error=folder_unavailable`);
  const returnTo = `/projects/${id}/folders/${folderId}`;
  const folderPage = listChildFoldersPage(id, folderId, { cursor: query.folderCursor, limit: 50 });
  const contentPage = listContentItemsInFolderPage(id, folderId, { cursor: query.contentCursor, limit: 50 });
  return <section className="workspace-view resource-page">
    <ProjectWorkspaceHeader project={project} activeTab="content" />
    {query.error && <div className="integrity-notice">{mutationNoticeMessage(query.error)}</div>}
    {query.success && <div className="success-notice">操作已完成。</div>}
    <ProjectContentWorkspace project={project} projects={listProjects()} allFolders={listProjectFolders(id)} currentFolder={folder} breadcrumbs={getFolderBreadcrumbs(folderId)} childFolders={folderPage.items} content={contentPage.items} tagsByContent={listObjectTagsMap("content", contentPage.items.map((item) => item.id))} availableTags={listTags()} linkedDrafts={listDraftActionsForContentItems(contentPage.items.map((item) => item.id))} initialCreate={query.create === "1"} initialSelectedId={query.selected} initialPreview={query.preview === "1"} initialProcessing={query.processing === "1"} returnTo={returnTo} folderCursor={query.folderCursor} contentCursor={query.contentCursor} nextFolderCursor={folderPage.nextCursor} nextContentCursor={contentPage.nextCursor} />
  </section>;
}
