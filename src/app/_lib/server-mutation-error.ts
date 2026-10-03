import { ActionContextError } from "@/modules/actions/service";
import { AutomationContextError } from "@/modules/automations/service";
import { ContentProcessingError, FileLifecycleError, FileVersionConflictError } from "@/modules/inbox/service";
import { FolderError } from "@/modules/projects/folders";
import { ProjectError } from "@/modules/projects/service";
import { TagError } from "@/modules/tags/service";
import { mutationErrorMessage, type MutationErrorCode, type MutationFailure } from "@/app/_lib/mutation-result";
import { InboxProcessingError } from "@/app/_services/inbox-processing";

export class InvalidMutationInputError extends Error {
  constructor() {
    super("invalid_input");
    this.name = "InvalidMutationInputError";
  }
}

export function requiredRevision(data: FormData, key = "revision") {
  const raw = String(data.get(key) ?? "").trim();
  if (!/^\d+$/u.test(raw)) throw new InvalidMutationInputError();
  const revision = Number(raw);
  if (!Number.isSafeInteger(revision)) throw new InvalidMutationInputError();
  return revision;
}

export function mutationFailure(error: unknown): MutationFailure {
  const code = classifyMutationError(error);
  if (!code) throw error;
  return { ok: false, code, message: mutationErrorMessage(code) };
}

export function classifyMutationError(error: unknown): MutationErrorCode | null {
  if (error instanceof InvalidMutationInputError) return "invalid_input";
  if (error instanceof FileVersionConflictError) return "conflict";
  if (error instanceof FileLifecycleError) {
    if (error.code === "revision_conflict") return "conflict";
    if (error.code === "not_found") return "not_found";
    if (error.code === "operation_in_progress") return "blocked";
    if (error.code === "invalid_status_transition") return "blocked";
    return "invalid_input";
  }
  if (error instanceof ContentProcessingError) {
    if (error.code === "revision_conflict") return "conflict";
    if (error.code === "unavailable") return "unavailable";
    return "blocked";
  }
  if (error instanceof InboxProcessingError) return "blocked";
  if (error instanceof ActionContextError) {
    if (error.code === "content_unavailable") return "unavailable";
    if (error.code === "draft_confirmation_required" || error.code === "not_draft") return "blocked";
    return "invalid_input";
  }
  if (error instanceof AutomationContextError) {
    if (error.code === "input_unavailable") return "unavailable";
    return error.code === "no_inputs" ? "invalid_input" : "blocked";
  }
  if (error instanceof FolderError) {
    if (error.code === "revision_conflict") return "conflict";
    if (error.code === "not_found" || error.code === "not_trashed" || error.code === "trashed") return "not_found";
    return "invalid_input";
  }
  if (error instanceof ProjectError) {
    if (error.code === "revision_conflict") return "conflict";
    if (error.code === "not_found" || error.code === "not_trashed") return "not_found";
    if (error.code === "archived") return "blocked";
    return "invalid_input";
  }
  if (error instanceof TagError) {
    if (error.code === "revision_conflict") return "conflict";
    return error.code === "not_found" ? "not_found" : "invalid_input";
  }
  if (error instanceof TypeError && "code" in error && error.code === "ERR_INVALID_URL") return "invalid_input";
  if (!(error instanceof Error)) return null;
  if (["action_revision_conflict", "automation_revision_conflict", "folder_delete_confirmation_stale", "project_delete_confirmation_stale"].includes(error.message)) return "conflict";
  if (["action_not_trashed", "automation_not_trashed", "folder_not_trashed", "project_not_trashed"].includes(error.message)) return "not_found";
  if (["confirmation_mismatch", "invalid_destination"].includes(error.message)) return "invalid_input";
  return null;
}
