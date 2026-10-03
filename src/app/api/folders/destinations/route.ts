import { NextResponse } from "next/server";
import { getFolder, getFolderBreadcrumbs, listChildFolders, listFolderSubtree } from "@/modules/projects/folders";
import { getProject } from "@/modules/projects/service";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await isAuthorized())) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const parentId = url.searchParams.get("parentId") || null;
  const excludeSubtreeRootId = url.searchParams.get("exclude") ?? undefined;
  const project = getProject(projectId);
  if (!project || project.archived_at || project.trashed_at) return NextResponse.json({ code: "invalid_destination" }, { status: 400 });
  const parent = parentId ? getFolder(parentId) : null;
  if (parentId && (!parent || parent.project_id !== projectId || parent.trashed_at)) return NextResponse.json({ code: "invalid_destination" }, { status: 400 });
  const excluded = new Set(excludeSubtreeRootId ? listFolderSubtree(excludeSubtreeRootId).map((folder) => folder.id) : []);
  if (parentId && excluded.has(parentId)) return NextResponse.json({ code: "invalid_destination" }, { status: 400 });
  const folders = listChildFolders(projectId, parentId)
    .filter((folder) => !excluded.has(folder.id))
    .map((folder) => ({ id: folder.id, name: folder.name, path: [...(parentId ? getFolderBreadcrumbs(parentId) : []), folder].map((entry) => entry.name).join(" / ") }));
  const breadcrumbs = parentId ? getFolderBreadcrumbs(parentId).map(({ id, name }) => ({ id, name })) : [];
  return NextResponse.json({ folders, breadcrumbs }, { headers: { "Cache-Control": "private, no-store" } });
}
