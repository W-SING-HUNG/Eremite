"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  moveActionsToProject, permanentlyDeleteAction, restoreAction, trashAction,
} from "@/modules/actions/service";
import {
  permanentlyDeleteAutomationRun, restoreAutomationRun, trashAutomationRun,
} from "@/modules/automations/service";
import {
  moveContentItems, permanentlyDeleteContentItems, restoreContentItem, trashContentItem,
} from "@/modules/inbox/service";
import {
  createFolder, getFolder, renameFolder, restoreFolder, trashFolder,
} from "@/modules/projects/folders";
import {
  archiveProject, createProject, getProject, restoreProject, trashProject, unarchiveProject, updateProject,
} from "@/modules/projects/service";
import { createTag, deleteTag, mergeTags, renameTag, setTagsByNames, type TagObjectType } from "@/modules/tags/service";
import {
  moveFolderTree, permanentlyDeleteFolderTree, permanentlyDeleteProjectWorkspace,
} from "@/app/_services/resource-operations";
import { requireAuthorized } from "@/platform/auth/service";
import { mutationSuccess } from "@/app/_lib/mutation-result";
import { mutationFailure, requiredRevision } from "@/app/_lib/server-mutation-error";

const field = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const count = (data: FormData, key: string) => Number(field(data, key));

async function mutate(data: FormData, operation: () => void) {
  await requireAuthorized();
  const returnTo = safeReturnPath(field(data, "returnTo"));
  try {
    operation();
  } catch (error) {
    const failure = mutationFailure(error);
    redirect(withNotice(returnTo, "error", failure.code));
  }
  revalidatePath("/", "layout");
  redirect(withNotice(returnTo, "success", "saved"));
}

async function mutateForResult<T>(operation: () => T) {
  await requireAuthorized();
  let result: T;
  try {
    result = operation();
  } catch (error) {
    return mutationFailure(error);
  }
  revalidatePath("/", "layout");
  return mutationSuccess(result);
}

async function mutateWithSuccess(data: FormData, operation: () => string) {
  await requireAuthorized();
  const returnTo = safeReturnPath(field(data, "returnTo"));
  let message: string;
  try { message = operation(); }
  catch (error) {
    const failure = mutationFailure(error);
    redirect(withNotice(returnTo, "error", failure.code));
  }
  revalidatePath("/", "layout");
  redirect(withNotice(returnTo, "success", message));
}

export async function createProjectAction(data: FormData) {
  return mutateForResult(() => ({ objectId: createProject({ name: field(data, "name"), description: field(data, "description") }) }));
}
export async function updateProjectAction(data: FormData) {
  return mutate(data, () => updateProject({ id: field(data, "id"), name: field(data, "name"), description: field(data, "description"), expectedRevision: requiredRevision(data) }));
}
export async function archiveProjectAction(data: FormData) { return mutate(data, () => archiveProject(field(data, "id"), requiredRevision(data))); }
export async function unarchiveProjectAction(data: FormData) { return mutate(data, () => unarchiveProject(field(data, "id"), requiredRevision(data))); }
export async function trashProjectAction(data: FormData) { return mutate(data, () => trashProject(field(data, "id"), requiredRevision(data))); }
export async function restoreProjectAction(data: FormData) { return mutateWithSuccess(data, () => { const id = field(data, "id"); const name = getProject(id)?.name ?? "专案"; restoreProject(id, requiredRevision(data)); return `已恢复到专案列表：${name}`; }); }
export async function permanentlyDeleteProjectAction(data: FormData) {
  return mutate(data, () => {
    if (field(data, "confirmation") !== field(data, "projectName")) throw new Error("confirmation_mismatch");
    permanentlyDeleteProjectWorkspace({
      projectId: field(data, "id"), expectedFolders: count(data, "folders"), expectedContent: count(data, "content"),
      expectedActions: count(data, "actions"), expectedRuns: count(data, "runs"),
    });
  });
}

export async function createFolderAction(data: FormData) {
  return mutateForResult(() => ({ objectId: createFolder({ projectId: field(data, "projectId"), parentId: field(data, "parentId") || null, name: field(data, "name") }) }));
}
export async function renameFolderAction(data: FormData) {
  return mutate(data, () => renameFolder({ id: field(data, "id"), name: field(data, "name"), expectedRevision: requiredRevision(data) }));
}
export async function moveFolderAction(data: FormData) {
  return mutate(data, () => {
    const destination = parseDestination(field(data, "destination"));
    moveFolderTree({ id: field(data, "id"), expectedRevision: requiredRevision(data), targetProjectId: destination.projectId, targetParentId: destination.folderId });
  });
}
export async function moveFolderResultAction(data: FormData) {
  return mutateForResult(() => {
    const destination = parseDestination(field(data, "destination"));
    moveFolderTree({ id: field(data, "id"), expectedRevision: requiredRevision(data), targetProjectId: destination.projectId, targetParentId: destination.folderId });
    return { objectId: field(data, "id") };
  });
}
export async function trashFolderAction(data: FormData) { return mutate(data, () => trashFolder(field(data, "id"), requiredRevision(data))); }
export async function restoreFolderAction(data: FormData) { return mutateWithSuccess(data, () => { const id = field(data, "id"); const result = restoreFolder(id, requiredRevision(data)); const folder = getFolder(id); const project = folder ? getProject(folder.project_id) : null; const parent = result.parentId ? getFolder(result.parentId) : null; return `已恢复到：${project?.name ?? "专案"}${parent ? ` / ${parent.name}` : ""}${result.renamed ? `；名称调整为“${folder?.name ?? "恢复的文件夹"}”` : ""}`; }); }
export async function permanentlyDeleteFolderAction(data: FormData) {
  return mutate(data, () => {
    if (field(data, "confirmation") !== "DELETE") throw new Error("confirmation_mismatch");
    permanentlyDeleteFolderTree({ folderId: field(data, "id"), expectedFolders: count(data, "folders"), expectedContent: count(data, "content") });
  });
}

export async function moveContentAction(data: FormData) {
  return mutate(data, () => {
    const raw = field(data, "destination");
    const destination = !raw || raw === "inbox" ? { projectId: null, folderId: null } : parseDestination(raw);
    moveContentItems({ ids: [{ id: field(data, "id"), expectedRevision: requiredRevision(data) }], projectId: destination.projectId, folderId: destination.folderId });
  });
}
export async function moveContentResultAction(data: FormData) {
  return mutateForResult(() => {
    const raw = field(data, "destination");
    const destination = !raw || raw === "inbox" ? { projectId: null, folderId: null } : parseDestination(raw);
    moveContentItems({ ids: [{ id: field(data, "id"), expectedRevision: requiredRevision(data) }], projectId: destination.projectId, folderId: destination.folderId });
    return { objectId: field(data, "id") };
  });
}
export async function trashContentAction(data: FormData) { return mutate(data, () => trashContentItem(field(data, "id"), requiredRevision(data))); }
export async function restoreContentAction(data: FormData) { return mutateWithSuccess(data, () => { const result = restoreContentItem(field(data, "id"), requiredRevision(data)); const project = result.projectId ? getProject(result.projectId) : null; const folder = result.folderId ? getFolder(result.folderId) : null; return `已恢复到：${project ? `${project.name}${folder ? ` / ${folder.name}` : ""}` : "资料库（未归入专案）"}`; }); }
export async function permanentlyDeleteContentAction(data: FormData) { return mutate(data, () => { requireDeleteConfirmation(data); permanentlyDeleteContentItems([field(data, "id")]); }); }
export async function trashActionAction(data: FormData) { return mutate(data, () => trashAction(field(data, "id"), requiredRevision(data))); }
export async function moveActionProjectAction(data: FormData) { return mutate(data, () => moveActionsToProject({ ids: [{ id: field(data, "id"), expectedRevision: requiredRevision(data) }], projectId: field(data, "projectId") || null })); }
export async function restoreActionAction(data: FormData) { return mutateWithSuccess(data, () => { const result = restoreAction(field(data, "id"), requiredRevision(data)); const project = result.projectId ? getProject(result.projectId) : null; return `已恢复到：${project ? `${project.name} / 行动` : "行动台（未归入专案）"}`; }); }
export async function permanentlyDeleteActionAction(data: FormData) { return mutate(data, () => { permanentlyDeleteAction(field(data, "id")); }); }
export async function trashAutomationAction(data: FormData) { return mutate(data, () => trashAutomationRun(field(data, "id"), requiredRevision(data))); }
export async function restoreAutomationAction(data: FormData) { return mutateWithSuccess(data, () => { const result = restoreAutomationRun(field(data, "id"), requiredRevision(data)); return `已恢复运行记录；执行时专案：${result.projectNameSnapshot ?? "未归入专案"}`; }); }
export async function permanentlyDeleteAutomationAction(data: FormData) { return mutate(data, () => { permanentlyDeleteAutomationRun(field(data, "id")); }); }

export async function createTagAction(data: FormData) { return mutateForResult(() => ({ objectId: createTag({ name: field(data, "name") }) })); }
export async function renameTagAction(data: FormData) { return mutate(data, () => renameTag({ id: field(data, "id"), name: field(data, "name"), expectedRevision: requiredRevision(data) })); }
export async function mergeTagsAction(data: FormData) { return mutate(data, () => mergeTags(field(data, "sourceId"), field(data, "targetId"))); }
export async function deleteTagAction(data: FormData) { return mutate(data, () => deleteTag(field(data, "id"))); }
export async function setObjectTagsResultAction(data: FormData) {
  return mutateForResult(() => {
    setTagsByNames(field(data, "type") as TagObjectType, field(data, "id"), field(data, "tags").replaceAll("，", ",").split(",").map((name) => name.trim()).filter(Boolean));
    return { objectId: field(data, "id") };
  });
}

function parseDestination(value: string) {
  const separator = value.indexOf("|");
  if (separator < 1) throw new Error("invalid_destination");
  return { projectId: value.slice(0, separator), folderId: value.slice(separator + 1) || null };
}

function safeReturnPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\n") || value.includes("\r")) return "/inbox";
  return value;
}

function withNotice(path: string, key: string, value: string) {
  const url = new URL(path, "http://eremite.local");
  url.searchParams.set(key, value.slice(0, 160));
  return `${url.pathname}${url.search}`;
}

function requireDeleteConfirmation(data: FormData) { if (field(data, "confirmation") !== "DELETE") throw new Error("confirmation_mismatch"); }
