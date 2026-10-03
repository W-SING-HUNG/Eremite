export type WorkspaceContext =
  | { scope: "global"; projectId: null; folderId: null }
  | { scope: "project"; projectId: string; folderId: null }
  | { scope: "folder"; projectId: string; folderId: string };

export const globalWorkspaceContext: WorkspaceContext = { scope: "global", projectId: null, folderId: null };

export function projectWorkspaceContext(projectId: string): WorkspaceContext {
  return { scope: "project", projectId, folderId: null };
}

export function folderWorkspaceContext(projectId: string, folderId: string): WorkspaceContext {
  return { scope: "folder", projectId, folderId };
}

export function contentLocationForContext(context: WorkspaceContext) {
  return { projectId: context.projectId, folderId: context.folderId };
}

export function actionProjectForContext(context: WorkspaceContext) {
  return context.projectId;
}

export function workspaceHref(context: WorkspaceContext, query: Record<string, string | undefined> = {}) {
  const pathname = context.scope === "global"
    ? "/inbox"
    : context.scope === "project"
      ? `/projects/${context.projectId}`
      : `/projects/${context.projectId}/folders/${context.folderId}`;
  const search = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return search.size > 0 ? `${pathname}?${search}` : pathname;
}
