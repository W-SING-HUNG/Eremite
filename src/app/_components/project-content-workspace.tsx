"use client";

import Link from "next/link";
import { Folder, PanelLeft, Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { InboxWorkspace } from "@/app/_components/inbox-workspace";
import { FolderTree } from "@/app/_components/folder-tree";
import { FolderBreadcrumbs } from "@/app/_components/folder-breadcrumbs";
import { folderWorkspaceContext, projectWorkspaceContext } from "@/app/_lib/workspace-context";
import type { ContentItem } from "@/modules/inbox/service";
import type { Folder as FolderRecord } from "@/modules/projects/folders";
import type { Project } from "@/modules/projects/service";
import type { Tag } from "@/modules/tags/service";
import type { DraftActionForContentItem } from "@/modules/actions/service";
import { useDismissableLayer, useFocusScope } from "@/app/_components/ui/overlay";
import { useMediaQuery } from "@/app/_lib/use-media-query";

export function ProjectContentWorkspace({
  project, projects, allFolders, currentFolder, breadcrumbs, childFolders, content, tagsByContent, availableTags, linkedDrafts,
  initialCreate, initialSelectedId, initialPreview, initialProcessing, returnTo, folderCursor, contentCursor, nextFolderCursor, nextContentCursor,
}: {
  project: Project; projects: Project[]; allFolders: FolderRecord[]; currentFolder: FolderRecord | null; breadcrumbs: FolderRecord[];
  childFolders: FolderRecord[]; content: ContentItem[]; tagsByContent: Record<string, Tag[]>; availableTags: Tag[]; linkedDrafts: DraftActionForContentItem[];
  initialCreate: boolean; initialSelectedId?: string; initialPreview: boolean; initialProcessing?: boolean; returnTo: string; folderCursor?: string; contentCursor?: string;
  nextFolderCursor?: string | null; nextContentCursor?: string | null;
}) {
  const [treeOpen, setTreeOpen] = useState(false);
  const treeTriggerRef = useRef<HTMLButtonElement>(null);
  const treePanelRef = useRef<HTMLElement>(null);
  const narrowTree = useMediaQuery("(max-width: 839px)");
  const treeModal = narrowTree && treeOpen;
  const treeLayerId = useDismissableLayer({ open: treeModal, panelRef: treePanelRef, triggerRef: treeTriggerRef, onDismiss: () => setTreeOpen(false), modal: true, returnFocus: true });
  useFocusScope({ open: treeModal, panelRef: treePanelRef, layerId: treeLayerId, initialFocusSelector: "[data-folder-tree-initial-focus]" });
  const context = currentFolder ? folderWorkspaceContext(project.id, currentFolder.id) : projectWorkspaceContext(project.id);
  const active = !project.archived_at && !project.trashed_at;
  const folderPageQuery = new URLSearchParams();
  const contentPageQuery = new URLSearchParams();
  if (nextFolderCursor) folderPageQuery.set("folderCursor", nextFolderCursor);
  if (contentCursor) folderPageQuery.set("contentCursor", contentCursor);
  if (folderCursor) contentPageQuery.set("folderCursor", folderCursor);
  if (nextContentCursor) contentPageQuery.set("contentCursor", nextContentCursor);
  const searchParams = new URLSearchParams({ scope: currentFolder ? "folder" : "project", projectId: project.id });
  if (currentFolder) searchParams.set("folderId", currentFolder.id);

  return <div className={`${active ? "project-resource-shell" : "project-resource-shell read-only"}${treeOpen ? " tree-open" : ""}`}>
    <div className="folder-tree-backdrop" aria-hidden="true" onClick={() => setTreeOpen(false)} />
    <FolderTree projectId={project.id} projects={projects} folders={allFolders} selectedFolderId={currentFolder?.id ?? null} active={active} returnTo={returnTo} onClose={() => setTreeOpen(false)} panelRef={treePanelRef} modal={treeModal} layerId={treeLayerId} />
    <div className="project-resource-main">
      <div className="location-bar">
        <button ref={treeTriggerRef} className="icon-button folder-tree-trigger" type="button" aria-label={treeOpen ? "关闭文件夹" : "打开文件夹"} aria-expanded={treeOpen} onClick={() => setTreeOpen((open) => !open)}>{treeOpen ? <X size={16} /> : <PanelLeft size={16} />}</button>
        <FolderBreadcrumbs projectId={project.id} breadcrumbs={breadcrumbs} />
        <Link className="icon-button" href={`/search?${searchParams}`} aria-label={currentFolder ? "搜索当前文件夹及其子文件夹" : "搜索当前专案"}><Search size={16} /></Link>
      </div>
      {!active && <div className="lifecycle-banner">此专案已归档，当前为只读视图。运行历史与资料身份不会改变。</div>}
      {childFolders.length > 0 && <section className="folder-children" aria-label="当前目录的子文件夹"><h2>文件夹</h2><div>{childFolders.map((folder) => <Link href={`/projects/${project.id}/folders/${folder.id}`} key={folder.id}><Folder size={17} /><span title={folder.name}>{folder.name}</span></Link>)}</div></section>}
      <InboxWorkspace items={content} projects={projects} folders={allFolders} tagsByContent={tagsByContent} availableTags={availableTags} linkedDrafts={linkedDrafts} integrityProblems={[]} initialCreate={active && initialCreate} initialSelectedId={initialSelectedId} initialPreview={initialPreview} initialProcessing={initialProcessing} context={context} title={currentFolder?.name ?? project.name} subtitle="" showHeader={false} mutable={active} />
      <div className="project-page-links">
        {nextFolderCursor && <Link className="page-next" href={`${returnTo}?${folderPageQuery}`}>下一批文件夹</Link>}
        {nextContentCursor && <Link className="page-next" href={`${returnTo}?${contentPageQuery}`}>下一批资料</Link>}
      </div>
    </div>
  </div>;
}
