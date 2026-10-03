"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { acceptDraftAction, createAction, replaceActionContentItems, updateActionDetails, updateActionStatus, type ActionPriority, type ActionStatus } from "@/modules/actions/service";
import { executeExternalTool, executeTool } from "@/modules/automations/service";
import { FILE_CONVERTER_TOOL_ID, PDF_TOOLS_TOOL_ID } from "@/modules/automations/tools/catalog";
import { reconcileInterruptedAutomationRuns } from "@/modules/automations/reconciliation";
import { createLinkContentItem, updateContentItem, type InboxStatus } from "@/modules/inbox/service";
import { setTagsByNames } from "@/modules/tags/service";
import { transaction } from "@/platform/db/database";
import { createBackup } from "@/platform/backup/service";
import { login, logout, requireAuthorized, setupPassword } from "@/platform/auth/service";
import { workspaceRevalidationPaths } from "@/app/_lib/workspace-routes";
import { mutationSuccess } from "@/app/_lib/mutation-result";
import { mutationFailure, requiredRevision } from "@/app/_lib/server-mutation-error";
import { processContentWithAcceptedDraft, processContentWithNewAction, processContentWithoutAction } from "@/app/_services/inbox-processing";

const value = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const revalidateWorkspace = () => workspaceRevalidationPaths.forEach((path) => revalidatePath(path));

export async function setupAction(formData: FormData) {
  try {
    await setupPassword(value(formData, "password"));
  } catch (error) {
    if (error instanceof Error && error.message === "Password must contain at least 12 characters.") {
      redirect("/setup?error=password-too-short");
    }
    if (error instanceof Error && error.message === "Password is already configured.") {
      redirect("/login");
    }
    throw error;
  }
  redirect("/inbox");
}

export async function loginAction(formData: FormData) {
  try {
    await login(value(formData, "password"));
  } catch (error) {
    if (error instanceof Error && error.message === "Incorrect password.") {
      redirect("/login?error=incorrect-password");
    }
    throw error;
  }
  redirect("/inbox");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function createLinkAction(formData: FormData) {
  await requireAuthorized();
  let id: string;
  try {
    id = transaction(() => {
      const tags = splitTags(value(formData, "tags"));
      const createdId = createLinkContentItem({ title: value(formData, "title"), url: value(formData, "url"), projectId: value(formData, "projectId") || null, folderId: value(formData, "folderId") || null });
      setTagsByNames("content", createdId, tags);
      return createdId;
    });
  } catch (error) {
    return mutationFailure(error);
  }
  revalidateWorkspace();
  return mutationSuccess({ objectId: id });
}

export async function updateContentAction(formData: FormData) {
  await requireAuthorized();
  try {
    transaction(() => {
      const id = value(formData, "id");
      const tags = splitTags(value(formData, "tags"));
      updateContentItem({ id, title: value(formData, "title"), status: value(formData, "status") as InboxStatus, expectedRevision: requiredRevision(formData) });
      setTagsByNames("content", id, tags);
    });
  } catch (error) {
    return mutationFailure(error);
  }
  revalidateWorkspace();
  return mutationSuccess(undefined);
}

export async function processContentWithoutActionAction(formData: FormData) {
  await requireAuthorized();
  try {
    const result = processContentWithoutAction({ contentId: value(formData, "contentId"), expectedContentRevision: requiredRevision(formData) });
    revalidateWorkspace();
    return mutationSuccess(result);
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function processContentWithNewActionAction(formData: FormData) {
  await requireAuthorized();
  try {
    const result = processContentWithNewAction({
      contentId: value(formData, "contentId"),
      expectedContentRevision: requiredRevision(formData),
      title: value(formData, "title"),
      priority: value(formData, "priority") as ActionPriority,
      dueDate: value(formData, "dueDate") || null,
      projectId: value(formData, "projectId") || null,
    });
    revalidateWorkspace();
    return mutationSuccess(result);
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function processContentWithAcceptedDraftAction(formData: FormData) {
  await requireAuthorized();
  try {
    const result = processContentWithAcceptedDraft({
      contentId: value(formData, "contentId"),
      expectedContentRevision: requiredRevision(formData),
      actionId: value(formData, "actionId"),
      expectedActionRevision: requiredRevision(formData, "actionRevision"),
    });
    revalidateWorkspace();
    return mutationSuccess(result);
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function createActionAction(formData: FormData) {
  await requireAuthorized();
  let id: string;
  try {
    id = transaction(() => {
      const contentItemIds = formData.getAll("contentItemIds").map(String);
      const createdId = createAction({ title: value(formData, "title"), priority: value(formData, "priority") as ActionPriority, dueDate: value(formData, "dueDate"), contentItemIds, projectId: value(formData, "projectId") || null });
      setTagsByNames("action", createdId, splitTags(value(formData, "tags")));
      return createdId;
    });
  } catch (error) {
    return mutationFailure(error);
  }
  revalidateWorkspace();
  return mutationSuccess({ objectId: id });
}

export async function updateActionStatusAction(formData: FormData) {
  await requireAuthorized();
  try {
    const revision = updateActionStatus(value(formData, "id"), value(formData, "status") as ActionStatus, requiredRevision(formData));
    revalidateWorkspace();
    return mutationSuccess({ revision });
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function acceptActionDraftAction(formData: FormData) {
  await requireAuthorized();
  try {
    const revision = acceptDraftAction(value(formData, "id"), requiredRevision(formData));
    revalidateWorkspace();
    return mutationSuccess({ revision });
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function updateActionDetailsAction(formData: FormData) {
  await requireAuthorized();
  try {
    const revision = updateActionDetails({
      id: value(formData, "id"),
      title: value(formData, "title"),
      priority: value(formData, "priority") as ActionPriority,
      dueDate: value(formData, "dueDate") || null,
      projectId: value(formData, "projectId") || null,
      expectedRevision: requiredRevision(formData),
    });
    revalidateWorkspace();
    return mutationSuccess({ revision });
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function replaceActionContentItemsAction(formData: FormData) {
  await requireAuthorized();
  try {
    const revision = replaceActionContentItems({
      id: value(formData, "id"),
      contentItemIds: formData.getAll("contentItemIds").map(String),
      expectedRevision: requiredRevision(formData),
    });
    revalidateWorkspace();
    return mutationSuccess({ revision });
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function executeAutomationToolAction(formData: FormData) {
  await requireAuthorized();
  try {
    reconcileInterruptedAutomationRuns();
    const toolId = value(formData, "toolId");
    const common = { operationId: value(formData, "operationId"), toolId, projectId: formData.has("projectId") ? value(formData, "projectId") || null : undefined };
    const result = toolId === FILE_CONVERTER_TOOL_ID
      ? await executeExternalTool({ ...common, rawInput: { contentItemId: value(formData, "contentItemId"), conversionId: value(formData, "conversionId"), profile: value(formData, "profile"), folderId: value(formData, "folderId") || null } })
      : toolId === PDF_TOOLS_TOOL_ID
        ? await executeExternalTool({ ...common, rawInput: {
          operation: value(formData, "operation"),
          contentItemIds: formData.getAll("contentItemIds").map(String),
          splitEvery: value(formData, "splitEvery"),
          pageSelector: value(formData, "pageSelector"),
          rotateAngle: value(formData, "rotateAngle"),
          rotateMode: value(formData, "rotateMode"),
          pageOrder: value(formData, "pageOrder"),
          folderId: value(formData, "folderId") || null,
        } })
        : executeTool({ ...common, rawInput: { contentItemIds: formData.getAll("contentItemIds").map(String) } });
    revalidateWorkspace();
    return mutationSuccess({ objectId: result.runId, reused: result.reused, status: result.status });
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function backupAction() {
  await requireAuthorized();
  await createBackup();
  revalidateWorkspace();
}

const splitTags = (tags: string) => tags.replaceAll("，", ",").split(",").map((tag) => tag.trim()).filter(Boolean);
