import { all, assertUnitOfWork, one, run, transaction, type UnitOfWork } from "@/platform/db/database";
import { getAvailableContentItemSummary } from "@/modules/inbox/service";
import { now, uuidv7 } from "@/platform/shared/ids";
import { normalizeKey } from "@/platform/shared/normalization";
import { assertProjectAcceptsMembers, getProject } from "@/modules/projects/service";
import { decodeCursor, encodeCursor, pageLimit } from "@/platform/shared/pagination";

export type ActionStatus = "draft" | "active" | "done" | "cancelled" | "archived";
export type ActionPriority = "low" | "normal" | "high";
export type ActionItem = { id: string; title: string; status: ActionStatus; priority: ActionPriority; due_date: string | null; created_at: string; updated_at: string; completed_at: string | null; source_count: number; project_id: string | null; trashed_at: string | null; revision: number };
export type ActionContentLink = { action_id: string; content_item_id: string };
export type DraftActionForContentItem = Pick<ActionItem, "id" | "title" | "priority" | "due_date" | "project_id" | "revision"> & { content_item_id: string };
export type ActionDraftArtifact = Pick<ActionItem, "id" | "title" | "status" | "priority" | "due_date" | "project_id" | "trashed_at" | "revision"> & { contentItemIds: string[] };

export class ActionContextError extends Error {
  constructor(public readonly code: "invalid_title" | "invalid_priority" | "invalid_due_date" | "content_unavailable" | "too_many_content_items" | "not_found" | "draft_confirmation_required" | "not_draft" | "action_not_active") {
    super(code);
    this.name = "ActionContextError";
  }
}

export function listActions(status?: ActionStatus) {
  return all<ActionItem>(
    `SELECT a.*, COUNT(aci.content_item_id) AS source_count FROM actions a
     LEFT JOIN action_content_items aci ON aci.action_id = a.id
     WHERE a.trashed_at IS NULL ${status ? "AND a.status = ?" : ""}
     GROUP BY a.id ORDER BY CASE a.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, a.due_date IS NULL, a.due_date, a.created_at DESC`,
    ...(status ? [status] : []),
  );
}

export function getAction(id: string) {
  return one<ActionItem>(
    `SELECT a.*, COUNT(aci.content_item_id) AS source_count FROM actions a
       LEFT JOIN action_content_items aci ON aci.action_id = a.id
      WHERE a.id = ? GROUP BY a.id`,
    id,
  );
}

export function listActionsPage(input: { cursor?: string; limit?: number } = {}) {
  const cursor = decodeCursor(input.cursor); const limit = pageLimit(input.limit);
  const cursorValues = cursor?.values;
  const hasValidCursor = Boolean(cursor && cursorValues?.length === 3);
  const rows = all<ActionItem>(
    `SELECT a.*, COUNT(aci.content_item_id) AS source_count FROM actions a
     LEFT JOIN action_content_items aci ON aci.action_id = a.id
     WHERE a.trashed_at IS NULL ${hasValidCursor ? `AND (
       CASE a.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END > ? OR
       (CASE a.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END = ? AND a.due_date IS NULL > ?) OR
       (CASE a.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END = ? AND a.due_date IS NULL = ? AND coalesce(a.due_date, '') > ?) OR
       (CASE a.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END = ? AND a.due_date IS NULL = ? AND coalesce(a.due_date, '') = ? AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?)))
     )` : ""}
     GROUP BY a.id ORDER BY CASE a.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
       a.due_date IS NULL, a.due_date, a.created_at DESC, a.id DESC LIMIT ?`,
    ...(hasValidCursor ? [cursorValues![0], cursorValues![0], cursorValues![1], cursorValues![0], cursorValues![1], cursorValues![2], cursorValues![0], cursorValues![1], cursorValues![2], cursor!.timestamp, cursor!.timestamp, cursor!.id] : []), limit + 1,
  );
  const hasMore = rows.length > limit; const items = hasMore ? rows.slice(0, limit) : rows; const tail = items.at(-1);
  const priorityRank = tail ? tail.priority === "high" ? 0 : tail.priority === "normal" ? 1 : 2 : 0;
  return { items, nextCursor: hasMore && tail ? encodeCursor({ timestamp: tail.created_at, id: tail.id, values: [priorityRank, tail.due_date === null ? 1 : 0, tail.due_date ?? ""] }) : null };
}

export function listProjectActions(projectId: string) {
  return all<ActionItem>(
    `SELECT a.*, COUNT(aci.content_item_id) AS source_count FROM actions a
     LEFT JOIN action_content_items aci ON aci.action_id = a.id
     WHERE a.trashed_at IS NULL AND a.project_id = ?
     GROUP BY a.id ORDER BY a.updated_at DESC, a.id DESC`,
    projectId,
  );
}

/** Bounded read projection for Ask Eremite; never mutates Action state. */
export function listProjectActionsForAI(projectId: string, requestedLimit = 20) {
  const limit = Math.max(1, Math.min(Number.isSafeInteger(requestedLimit) ? requestedLimit : 20, 20));
  return all<Pick<ActionItem, 'id' | 'title' | 'status' | 'priority' | 'due_date' | 'revision'>>(
    `SELECT id, title, status, priority, due_date, revision FROM actions
     WHERE trashed_at IS NULL AND project_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`, projectId, limit,
  );
}

/** Bounded Actions-page read projection for Host-owned AI context. */
export function listActionsForAI(requestedLimit = 20, projectId?: string) {
  const limit = Math.max(1, Math.min(20, Number.isSafeInteger(requestedLimit) ? requestedLimit : 20));
  return all<Pick<ActionItem, 'id' | 'title' | 'status' | 'priority' | 'due_date' | 'revision' | 'project_id'>>(
    "SELECT id, title, status, priority, due_date, revision, project_id FROM actions WHERE status = 'active' AND trashed_at IS NULL AND (? IS NULL OR project_id = ?) ORDER BY updated_at DESC, id DESC LIMIT ?",
    projectId ?? null, projectId ?? null, limit,
  );
}

/** Actions-owned identity read for Host confirmation of name-based AI targets. */
export function listActiveActionReferenceMatches(reference: string) {
  const key = actionReferenceKey(reference);
  if (!key) return [] as Array<Pick<ActionItem, 'id' | 'title' | 'project_id' | 'due_date' | 'priority' | 'revision' | 'created_at'>>;
  return all<Pick<ActionItem, 'id' | 'title' | 'project_id' | 'due_date' | 'priority' | 'revision' | 'created_at'>>(
    "SELECT id, title, project_id, due_date, priority, revision, created_at FROM actions WHERE status = 'active' AND trashed_at IS NULL",
  ).filter(action => actionReferenceKey(action.title) === key);
}

export function actionReferenceKey(title: string) {
  let value = title.normalize('NFKC').trim();
  for (const [open, close] of [['“', '”'], ['‘', '’'], ['《', '》'], ['"', '"'], ["'", "'"]]) {
    if (value.startsWith(open) && value.endsWith(close)) { value = value.slice(open.length, value.length - close.length).trim(); break; }
  }
  return normalizeKey(value);
}

export function listProjectActionsPage(projectId: string, input: { cursor?: string; limit?: number } = {}) {
  const cursor = decodeCursor(input.cursor); const limit = pageLimit(input.limit);
  const rows = all<ActionItem>(
    `SELECT a.*, COUNT(aci.content_item_id) AS source_count FROM actions a
       LEFT JOIN action_content_items aci ON aci.action_id = a.id
      WHERE a.trashed_at IS NULL AND a.project_id = ?
        ${cursor ? "AND (a.updated_at < ? OR (a.updated_at = ? AND a.id < ?))" : ""}
      GROUP BY a.id ORDER BY a.updated_at DESC, a.id DESC LIMIT ?`,
    projectId, ...(cursor ? [cursor.timestamp, cursor.timestamp, cursor.id] : []), limit + 1,
  );
  const hasMore = rows.length > limit; const items = hasMore ? rows.slice(0, limit) : rows; const tail = items.at(-1);
  return { items, nextCursor: hasMore && tail ? encodeCursor({ timestamp: tail.updated_at, id: tail.id }) : null };
}

export function listTrashedActions() {
  return all<ActionItem>(
    `SELECT a.*, COUNT(aci.content_item_id) AS source_count FROM actions a
     LEFT JOIN action_content_items aci ON aci.action_id = a.id
     WHERE a.trashed_at IS NOT NULL GROUP BY a.id ORDER BY a.trashed_at DESC, a.id DESC`,
  );
}

/** Read-only UI query. The app layer resolves these IDs through Inbox's public reads. */
export function listActionContentLinks(actionIds: string[]) {
  if (actionIds.length === 0) return [] as ActionContentLink[];
  const placeholders = actionIds.map(() => "?").join(", ");
  return all<ActionContentLink>(
    `SELECT action_id, content_item_id FROM action_content_items WHERE action_id IN (${placeholders}) ORDER BY created_at ASC`,
    ...actionIds,
  );
}

/** Minimal Actions-owned relation read contract for cross-module orchestration. */
export function actionHasContentItem(actionId: string, contentItemId: string) {
  return Boolean(one<{ found: number }>(
    "SELECT 1 AS found FROM action_content_items WHERE action_id = ? AND content_item_id = ?",
    actionId, contentItemId,
  ));
}

/** Batch read contract for Inbox Processing. Returns only live Draft relations. */
export function listDraftActionsForContentItems(contentItemIds: string[]) {
  const uniqueIds = [...new Set(contentItemIds)];
  if (uniqueIds.length === 0) return [] as DraftActionForContentItem[];
  const placeholders = uniqueIds.map(() => "?").join(", ");
  return all<DraftActionForContentItem>(
    `SELECT relation.content_item_id, action.id, action.title, action.priority,
            action.due_date, action.project_id, action.revision
       FROM action_content_items relation
       JOIN actions action ON action.id = relation.action_id
      WHERE relation.content_item_id IN (${placeholders})
        AND action.status = 'draft' AND action.trashed_at IS NULL
      ORDER BY relation.content_item_id, action.updated_at DESC, action.id DESC`,
    ...uniqueIds,
  );
}

export function createAction(input: { title: string; priority: ActionPriority; dueDate?: string; status?: ActionStatus; contentItemIds?: string[]; projectId?: string | null }) {
  const title = input.title.normalize("NFKC").trim();
  if (!title) throw new ActionContextError("invalid_title");
  if (!(["low", "normal", "high"] as const).includes(input.priority)) throw new ActionContextError("invalid_priority");
  const dueDate = normalizeDueDate(input.dueDate);
  const contentItemIds = [...new Set(input.contentItemIds ?? [])];
  const content = contentItemIds.map((contentItemId) => getAvailableContentItemSummary(contentItemId));
  if (content.some((item) => !item)) throw new ActionContextError("content_unavailable");
  const inferredProjectId = content.length > 0 && content.every((item) => item?.project_id === content[0]?.project_id) ? content[0]?.project_id ?? null : null;
  const projectId = input.projectId === undefined ? inferredProjectId : input.projectId;
  assertProjectAcceptsMembers(projectId);
  const timestamp = now();
  const id = uuidv7();
  transaction(() => {
    run("INSERT INTO actions (id, title, status, priority, due_date, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, title, input.status ?? "active", input.priority, dueDate, projectId ?? null, timestamp, timestamp);
    for (const contentItemId of contentItemIds) linkContentItem(id, contentItemId);
  });
  return id;
}

/** Actions-owned single Draft write contract for Host orchestration. Status is never caller-controlled. */
export function createDraftAction(
  uow: UnitOfWork,
  input: { title: string; priority: ActionPriority; dueDate?: string; contentItemIds?: string[]; projectId?: string | null },
) {
  assertUnitOfWork(uow);
  const contentItemIds = [...new Set(input.contentItemIds ?? [])];
  if (contentItemIds.length > 10) throw new ActionContextError("too_many_content_items");
  const actionId = createAction({ ...input, contentItemIds, status: "draft" });
  const action = getAction(actionId);
  if (!action) throw new ActionContextError("not_found");
  return {
    actionId,
    revision: action.revision,
    title: action.title,
    priority: action.priority,
    dueDate: action.due_date,
    projectId: action.project_id,
    contentItemIds,
    status: "draft" as const,
  };
}

export type DraftActionBatchResult = {
  created: Array<{ actionId: string; contentItemId: string; title: string }>;
  skipped: Array<{ contentItemId: string; title: string }>;
};

/**
 * Public Actions write contract for transactional automation output.
 * The caller owns the outer Unit of Work; Actions retains all validation and table ownership.
 */
export function createDraftActionsBatch(
  uow: UnitOfWork,
  input: { projectId: string | null; items: Array<{ contentItemId: string; title: string }> },
): DraftActionBatchResult {
  assertUnitOfWork(uow);
  const result: DraftActionBatchResult = { created: [], skipped: [] };
  for (const item of input.items) {
    if (hasActionForContentItem(item.contentItemId)) {
      result.skipped.push({ contentItemId: item.contentItemId, title: item.title });
      continue;
    }
    const actionId = createAction({
      title: item.title,
      priority: "normal",
      status: "draft",
      contentItemIds: [item.contentItemId],
      projectId: input.projectId,
    });
    result.created.push({ actionId, contentItemId: item.contentItemId, title: item.title });
  }
  return result;
}

/** Public action write contract. It validates the referenced inbox item first. */
export function linkContentItem(actionId: string, contentItemId: string) {
  if (!getAvailableContentItemSummary(contentItemId)) throw new ActionContextError("content_unavailable");
  run("INSERT OR IGNORE INTO action_content_items (action_id, content_item_id, created_at) VALUES (?, ?, ?)", actionId, contentItemId, now());
}

export function updateActionStatus(id: string, status: ActionStatus, expectedRevision: number) {
  const current = actionStatusMutationState(id, expectedRevision);
  if (current.status === "draft") throw new ActionContextError("draft_confirmation_required");
  const result = run(
    "UPDATE actions SET status = ?, completed_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NULL AND status <> 'draft'",
    status, status === "done" ? now() : null, now(), id, expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new Error("action_revision_conflict");
  return expectedRevision + 1;
}

/** One CAS for a user-approved AI proposal. Only active Actions can enter this path. */
export function applyControlledActionUpdate(input: {
  id: string; expectedRevision: number; title?: string; priority?: ActionPriority;
  dueDate?: string | null; transition?: 'done' | 'cancelled';
}) {
  const current = getAction(input.id);
  if (!current || current.trashed_at || current.revision !== input.expectedRevision) throw new Error('action_revision_conflict');
  if (current.status !== 'active') throw new ActionContextError('action_not_active');
  if (input.title !== undefined || input.priority !== undefined || input.dueDate !== undefined) assertProjectAcceptsMembers(current.project_id);
  const title = input.title === undefined ? current.title : input.title.normalize('NFKC').trim();
  if (!title || title.length > 240) throw new ActionContextError('invalid_title');
  const priority = input.priority ?? current.priority;
  if (!(['low', 'normal', 'high'] as const).includes(priority)) throw new ActionContextError('invalid_priority');
  const dueDate = input.dueDate === undefined ? current.due_date : normalizeDueDate(input.dueDate);
  const status = input.transition ?? current.status;
  const timestamp = now();
  const result = run(
    "UPDATE actions SET title = ?, priority = ?, due_date = ?, status = ?, completed_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NULL AND status = 'active'",
    title, priority, dueDate, status, status === 'done' ? timestamp : null, timestamp, input.id, input.expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new Error('action_revision_conflict');
  return input.expectedRevision + 1;
}

/** Explicit user-confirmation command. Drafts may become active only here. */
export function acceptDraftAction(id: string, expectedRevision: number) {
  const current = actionStatusMutationState(id, expectedRevision);
  if (current.status !== "draft") throw new ActionContextError("not_draft");
  const result = run(
    "UPDATE actions SET status = 'active', completed_at = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NULL AND status = 'draft'",
    now(), id, expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new Error("action_revision_conflict");
  return expectedRevision + 1;
}

/** Recoverable rejection contract. Drafts are moved to Trash and never hard-deleted. */
export function rejectDraftAction(id: string, expectedRevision: number) {
  const current = actionStatusMutationState(id, expectedRevision);
  if (current.status !== "draft") throw new ActionContextError("not_draft");
  const result = run(
    "UPDATE actions SET trashed_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NULL AND status = 'draft'",
    now(), now(), id, expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new Error("action_revision_conflict");
  return expectedRevision + 1;
}

/** Actions-owned read projection for persisted AI Draft cards. */
export function getActionDraftArtifact(id: string): ActionDraftArtifact | undefined {
  const action = getAction(id);
  if (!action) return undefined;
  const contentItemIds = all<{ content_item_id: string }>(
    "SELECT content_item_id FROM action_content_items WHERE action_id = ? ORDER BY created_at, content_item_id",
    id,
  ).map((row) => row.content_item_id);
  return { ...action, contentItemIds };
}

export function updateActionDetails(input: { id: string; title: string; priority: ActionPriority; dueDate?: string | null; projectId: string | null; expectedRevision: number }) {
  const title = input.title.normalize("NFKC").trim();
  if (!title) throw new ActionContextError("invalid_title");
  if (!(["low", "normal", "high"] as const).includes(input.priority)) throw new ActionContextError("invalid_priority");
  const dueDate = normalizeDueDate(input.dueDate);
  assertProjectAcceptsMembers(input.projectId);
  const result = run(
    "UPDATE actions SET title = ?, priority = ?, due_date = ?, project_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NULL",
    title, input.priority, dueDate, input.projectId, now(), input.id, input.expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new Error("action_revision_conflict");
  return input.expectedRevision + 1;
}

export function replaceActionContentItems(input: { id: string; contentItemIds: string[]; expectedRevision: number }) {
  const contentItemIds = [...new Set(input.contentItemIds)];
  const content = contentItemIds.map((contentItemId) => getAvailableContentItemSummary(contentItemId));
  if (content.some((item) => !item)) throw new ActionContextError("content_unavailable");
  return transaction(() => {
    const action = one<Pick<ActionItem, "id">>("SELECT id FROM actions WHERE id = ? AND revision = ? AND trashed_at IS NULL", input.id, input.expectedRevision);
    if (!action) throw new Error("action_revision_conflict");
    run("DELETE FROM action_content_items WHERE action_id = ?", input.id);
    for (const contentItemId of contentItemIds) linkContentItem(input.id, contentItemId);
    const timestamp = now();
    const result = run("UPDATE actions SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NULL", timestamp, input.id, input.expectedRevision);
    if (Number(result.changes) !== 1) throw new Error("action_revision_conflict");
    return input.expectedRevision + 1;
  });
}

export function moveActionsToProject(input: { ids: Array<{ id: string; expectedRevision: number }>; projectId: string | null }) {
  const uniqueActions = [...new Map(input.ids.map((item) => [item.id, item])).values()];
  if (uniqueActions.length === 0) return;
  transaction(() => {
    assertProjectAcceptsMembers(input.projectId);
    const timestamp = now();
    for (const action of uniqueActions) {
      const result = run("UPDATE actions SET project_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NULL", input.projectId, timestamp, action.id, action.expectedRevision);
      if (Number(result.changes) !== 1) throw new Error("action_revision_conflict");
    }
  });
}

export function trashAction(id: string, expectedRevision: number) {
  const result = run("UPDATE actions SET trashed_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NULL", now(), now(), id, expectedRevision);
  if (Number(result.changes) !== 1) throw new Error("action_revision_conflict");
}

export function restoreAction(id: string, expectedRevision: number) {
  const action = one<ActionItem>("SELECT a.*, 0 AS source_count FROM actions a WHERE id = ?", id);
  if (!action?.trashed_at) throw new Error("action_not_trashed");
  const project = action.project_id ? getProject(action.project_id) : null;
  const projectId = project && !project.trashed_at && !project.archived_at ? project.id : null;
  const result = run("UPDATE actions SET project_id = ?, trashed_at = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NOT NULL", projectId, now(), id, expectedRevision);
  if (Number(result.changes) !== 1) throw new Error("action_revision_conflict");
  return { projectId };
}

export function permanentlyDeleteAction(id: string) {
  const result = run("DELETE FROM actions WHERE id = ? AND trashed_at IS NOT NULL", id);
  if (Number(result.changes) !== 1) throw new Error("action_not_trashed");
}

export function detachAllProjectActions(projectId: string) {
  run("UPDATE actions SET project_id = NULL, revision = revision + 1, updated_at = ? WHERE project_id = ?", now(), projectId);
}

export function countProjectActions(projectId: string) {
  return Number(one<{ count: number }>("SELECT COUNT(*) AS count FROM actions WHERE project_id = ?", projectId)?.count ?? 0);
}

export function hasActionForContentItem(contentItemId: string) {
  return Boolean(one<{ action_id: string }>("SELECT action_id FROM action_content_items WHERE content_item_id = ? LIMIT 1", contentItemId));
}

function normalizeDueDate(value?: string | null) {
  const dueDate = value?.trim() ?? "";
  if (!dueDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dueDate);
  if (!match) throw new ActionContextError("invalid_due_date");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    throw new ActionContextError("invalid_due_date");
  }
  return dueDate;
}

function actionStatusMutationState(id: string, expectedRevision: number) {
  const action = one<Pick<ActionItem, "status" | "revision">>(
    "SELECT status, revision FROM actions WHERE id = ? AND trashed_at IS NULL",
    id,
  );
  if (!action || action.revision !== expectedRevision) throw new Error("action_revision_conflict");
  return action;
}

export function listContentItemIdsWithActions(contentItemIds?: string[]) {
  if (contentItemIds === undefined) {
    return all<{ content_item_id: string }>(
      "SELECT DISTINCT content_item_id FROM action_content_items ORDER BY content_item_id",
    ).map((row) => row.content_item_id);
  }
  const uniqueIds = [...new Set(contentItemIds)];
  if (uniqueIds.length === 0) return [] as string[];
  const placeholders = uniqueIds.map(() => "?").join(", ");
  return all<{ content_item_id: string }>(
    `SELECT DISTINCT content_item_id FROM action_content_items WHERE content_item_id IN (${placeholders}) ORDER BY content_item_id`,
    ...uniqueIds,
  ).map((row) => row.content_item_id);
}
