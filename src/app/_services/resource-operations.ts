import { transaction } from "@/platform/db/database";
import { countProjectActions, detachAllProjectActions } from "@/modules/actions/service";
import { countProjectRuns, detachAllProjectRuns } from "@/modules/automations/service";
import {
  countProjectContent,
  detachAllProjectContent,
  listContentIdsInFolders,
  permanentlyDeleteContentItems,
  reassignFolderSubtreeContent,
} from "@/modules/inbox/service";
import {
  applyFolderMove,
  countProjectFolders,
  deleteAllProjectFolders,
  deleteFolderSubtreeRecords,
  getFolder,
  listFolderSubtree,
  planFolderMove,
} from "@/modules/projects/folders";
import { getProject, permanentDeleteProject } from "@/modules/projects/service";

export function moveFolderTree(input: { id: string; expectedRevision: number; targetProjectId: string; targetParentId?: string | null }) {
  const plan = planFolderMove(input);
  transaction(() => {
    if (plan.crossProject) reassignFolderSubtreeContent(plan.subtreeIds, input.targetProjectId);
    applyFolderMove(plan, input.targetProjectId);
  });
  return { movedFolders: plan.subtreeIds.length, crossProject: plan.crossProject };
}

export function describeFolderPermanentDeletion(folderId: string) {
  const folder = getFolder(folderId);
  if (!folder?.trashed_at) throw new Error("folder_not_trashed");
  const folderIds = listFolderSubtree(folderId).map((entry) => entry.id);
  const contentIds = listContentIdsInFolders(folderIds);
  return { folderId, folders: folderIds.length, content: contentIds.length };
}

export function permanentlyDeleteFolderTree(input: { folderId: string; expectedFolders: number; expectedContent: number }) {
  const description = describeFolderPermanentDeletion(input.folderId);
  if (description.folders !== input.expectedFolders || description.content !== input.expectedContent) throw new Error("folder_delete_confirmation_stale");
  transaction(() => {
    const folderIds = listFolderSubtree(input.folderId).map((entry) => entry.id);
    const contentIds = listContentIdsInFolders(folderIds);
    permanentlyDeleteContentItems(contentIds, { allowInheritedFolderTrash: true });
    deleteFolderSubtreeRecords(input.folderId);
  });
  return description;
}

export function describeProjectPermanentDeletion(projectId: string) {
  const project = getProject(projectId);
  if (!project?.trashed_at) throw new Error("project_not_trashed");
  return {
    projectId,
    folders: countProjectFolders(projectId),
    content: countProjectContent(projectId),
    actions: countProjectActions(projectId),
    runs: countProjectRuns(projectId),
  };
}

export function permanentlyDeleteProjectWorkspace(input: { projectId: string; expectedFolders: number; expectedContent: number; expectedActions: number; expectedRuns: number }) {
  const description = describeProjectPermanentDeletion(input.projectId);
  if (description.folders !== input.expectedFolders || description.content !== input.expectedContent || description.actions !== input.expectedActions || description.runs !== input.expectedRuns) {
    throw new Error("project_delete_confirmation_stale");
  }
  transaction(() => {
    detachAllProjectContent(input.projectId);
    detachAllProjectActions(input.projectId);
    detachAllProjectRuns(input.projectId);
    deleteAllProjectFolders(input.projectId);
    permanentDeleteProject(input.projectId);
  });
  return description;
}
