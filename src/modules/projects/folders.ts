import { all, one, run } from "@/platform/db/database";
import { normalizeKey } from "@/platform/shared/normalization";
import { now, uuidv7 } from "@/platform/shared/ids";
import { assertProjectAcceptsMembers, getProject } from "@/modules/projects/service";
import { decodeCursor, encodeCursor, pageLimit } from "@/platform/shared/pagination";

export type Folder = {
  id: string; project_id: string; parent_id: string | null; restore_parent_id: string | null;
  name: string; name_key: string; trashed_at: string | null; revision: number;
  created_at: string; updated_at: string;
};

export class FolderError extends Error {
  constructor(public readonly code: "invalid_name" | "name_conflict" | "not_found" | "trashed" | "not_trashed" | "cycle" | "project_mismatch" | "revision_conflict") {
    super(code);
    this.name = "FolderError";
  }
}

export function getFolder(id: string) { return one<Folder>("SELECT * FROM folders WHERE id = ?", id); }

export function listChildFolders(projectId: string, parentId: string | null) {
  return parentId
    ? all<Folder>("SELECT * FROM folders WHERE project_id = ? AND parent_id = ? AND trashed_at IS NULL ORDER BY name_key, id", projectId, parentId)
    : all<Folder>("SELECT * FROM folders WHERE project_id = ? AND parent_id IS NULL AND trashed_at IS NULL ORDER BY name_key, id", projectId);
}

export function listChildFoldersPage(projectId: string, parentId: string | null, input: { cursor?: string; limit?: number } = {}) {
  const cursor = decodeCursor(input.cursor); const limit = pageLimit(input.limit, 100);
  const parentFilter = parentId ? "parent_id = ?" : "parent_id IS NULL";
  const cursorFilter = cursor ? "AND (name_key > ? OR (name_key = ? AND id > ?))" : "";
  const rows = all<Folder>(
    `SELECT * FROM folders WHERE project_id = ? AND ${parentFilter} AND trashed_at IS NULL ${cursorFilter}
      ORDER BY name_key, id LIMIT ?`,
    projectId, ...(parentId ? [parentId] : []), ...(cursor ? [cursor.timestamp, cursor.timestamp, cursor.id] : []), limit + 1,
  );
  const hasMore = rows.length > limit; const items = hasMore ? rows.slice(0, limit) : rows; const tail = items.at(-1);
  return { items, nextCursor: hasMore && tail ? encodeCursor({ timestamp: tail.name_key, id: tail.id }) : null };
}

export type FolderDestination = Folder & { depth: number; path: string; ancestor_ids: string };

export function listProjectFolders(projectId: string) {
  return all<Folder>("SELECT * FROM folders WHERE project_id = ? AND trashed_at IS NULL ORDER BY name_key, id", projectId);
}

export function listFolderDestinations() {
  return all<FolderDestination>(
    `WITH RECURSIVE tree(id, project_id, parent_id, restore_parent_id, name, name_key, trashed_at, revision, created_at, updated_at, depth, path, ancestor_ids) AS (
       SELECT id, project_id, parent_id, restore_parent_id, name, name_key, trashed_at, revision, created_at, updated_at, 0, name, '|' || id || '|'
         FROM folders WHERE parent_id IS NULL AND trashed_at IS NULL
       UNION
       SELECT child.id, child.project_id, child.parent_id, child.restore_parent_id, child.name, child.name_key,
              child.trashed_at, child.revision, child.created_at, child.updated_at, tree.depth + 1, tree.path || ' / ' || child.name, tree.ancestor_ids || child.id || '|'
         FROM folders child JOIN tree ON child.parent_id = tree.id
        WHERE child.trashed_at IS NULL
     ) SELECT * FROM tree ORDER BY project_id, path, id`,
  );
}

export function searchFolderMoveTargets(input: { projectId: string; query?: string; excludeSubtreeRootId?: string; limit?: number }) {
  const query = input.query?.normalize("NFKC").trim() ?? "";
  const limit = Math.max(1, Math.min(input.limit ?? 50, 50));
  const excluded = input.excludeSubtreeRootId
    ? `excluded(id) AS (SELECT id FROM folders WHERE id = ? UNION SELECT child.id FROM folders child JOIN excluded ON child.parent_id = excluded.id),`
    : "";
  const searchJoin = [...query].length >= 3 ? "JOIN folder_search_fts fts ON fts.object_id = folder.id" : "";
  const searchWhere = !query ? "folder.parent_id IS NULL" : [...query].length >= 3 ? "folder_search_fts MATCH ?" : "eremite_normalize_key(folder.name) LIKE ? ESCAPE '\\'";
  const rows = all<Folder>(
    `WITH RECURSIVE ${excluded} candidates AS (
       SELECT folder.* FROM folders folder ${searchJoin}
        WHERE folder.project_id = ? AND folder.trashed_at IS NULL AND ${searchWhere}
          ${input.excludeSubtreeRootId ? "AND folder.id NOT IN (SELECT id FROM excluded)" : ""}
        ORDER BY folder.name_key, folder.id LIMIT ?
     ) SELECT * FROM candidates`,
    ...(input.excludeSubtreeRootId ? [input.excludeSubtreeRootId] : []), input.projectId,
    ...(query ? [[...query].length >= 3 ? `"${query.replaceAll('"', '""')}"` : `%${escapeLike(normalizeKey(query))}%`] : []), limit,
  );
  return rows.map((folder) => ({ id: folder.id, name: folder.name, path: getFolderBreadcrumbs(folder.id).map((entry) => entry.name).join(" / ") }));
}

export function listFolderSubtree(folderId: string) {
  return all<Folder>(
    `WITH RECURSIVE subtree(id) AS (
       SELECT id FROM folders WHERE id = ?
       UNION
       SELECT folder.id FROM folders folder JOIN subtree ON folder.parent_id = subtree.id
     ) SELECT folders.* FROM folders JOIN subtree USING (id) ORDER BY folders.id`,
    folderId,
  );
}

export function getFolderBreadcrumbs(folderId: string) {
  return all<Folder & { depth: number }>(
    `WITH RECURSIVE ancestors(id, depth) AS (
       SELECT id, 0 FROM folders WHERE id = ?
       UNION
       SELECT folder.parent_id, ancestors.depth + 1
         FROM folders folder JOIN ancestors ON folder.id = ancestors.id
        WHERE folder.parent_id IS NOT NULL
     )
     SELECT folder.*, ancestors.depth FROM ancestors JOIN folders folder ON folder.id = ancestors.id
     ORDER BY ancestors.depth DESC`,
    folderId,
  );
}

export function listTrashedFolderRoots() {
  return all<Folder>("SELECT * FROM folders WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC, id DESC");
}

export function isFolderAvailable(id: string, projectId?: string) {
  try {
    const folder = requireActiveFolder(id);
    return !projectId || folder.project_id === projectId ? folder : null;
  } catch { return null; }
}

export function createFolder(input: { projectId: string; parentId?: string | null; name: string }) {
  assertProjectAcceptsMembers(input.projectId);
  const parent = input.parentId ? requireActiveFolder(input.parentId) : null;
  if (parent && parent.project_id !== input.projectId) throw new FolderError("project_mismatch");
  const name = cleanFolderName(input.name);
  const id = uuidv7(); const timestamp = now();
  try {
    run("INSERT INTO folders (id, project_id, parent_id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, input.projectId, parent?.id ?? null, name, normalizeKey(name), timestamp, timestamp);
    touchProjects([input.projectId]);
  } catch (error) { rethrowFolderConstraint(error); }
  return id;
}

export function renameFolder(input: { id: string; name: string; expectedRevision: number }) {
  const name = cleanFolderName(input.name);
  const folder = requireActiveFolder(input.id);
  try {
    const result = run("UPDATE folders SET name = ?, name_key = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?", name, normalizeKey(name), now(), input.id, input.expectedRevision);
    if (Number(result.changes) !== 1) throw new FolderError("revision_conflict");
    touchProjects([folder.project_id]);
  } catch (error) { rethrowFolderConstraint(error); }
}

export function planFolderMove(input: { id: string; expectedRevision: number; targetProjectId: string; targetParentId?: string | null }) {
  const folder = requireActiveFolder(input.id);
  if (folder.revision !== input.expectedRevision) throw new FolderError("revision_conflict");
  assertProjectAcceptsMembers(input.targetProjectId);
  const targetParent = input.targetParentId ? requireActiveFolder(input.targetParentId) : null;
  if (targetParent && targetParent.project_id !== input.targetProjectId) throw new FolderError("project_mismatch");
  if (targetParent && isFolderInSubtree(folder.id, targetParent.id)) throw new FolderError("cycle");
  const subtreeIds = listFolderSubtree(folder.id).map((entry) => entry.id);
  return { folder, targetParent, subtreeIds, crossProject: folder.project_id !== input.targetProjectId };
}

/** Must run in the app-level transaction that also updates Inbox content membership. */
export function applyFolderMove(plan: ReturnType<typeof planFolderMove>, targetProjectId: string) {
  const timestamp = now();
  try {
    if (plan.crossProject) {
      const movedRoot = run(
        `UPDATE folders SET project_id = ?, parent_id = ?, revision = revision + 1, updated_at = ?
          WHERE id = ? AND revision = ? AND trashed_at IS NULL`,
        targetProjectId, plan.targetParent?.id ?? null, timestamp, plan.folder.id, plan.folder.revision,
      );
      if (Number(movedRoot.changes) !== 1) throw new FolderError("revision_conflict");
      const descendantIds = plan.subtreeIds.filter((id) => id !== plan.folder.id);
      if (descendantIds.length > 0) {
        const descendantPlaceholders = descendantIds.map(() => "?").join(", ");
        run(
          `UPDATE folders SET project_id = ?, revision = revision + 1, updated_at = ?
            WHERE id IN (${descendantPlaceholders})`,
          targetProjectId, timestamp, ...descendantIds,
        );
      }
    } else {
      const result = run(
        "UPDATE folders SET parent_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?",
        plan.targetParent?.id ?? null, timestamp, plan.folder.id, plan.folder.revision,
      );
      if (Number(result.changes) !== 1) throw new FolderError("revision_conflict");
    }
    touchProjects([plan.folder.project_id, targetProjectId]);
  } catch (error) { rethrowFolderConstraint(error); }
}

export function trashFolder(id: string, expectedRevision: number) {
  const folder = requireActiveFolder(id);
  try {
    const result = run(
      `UPDATE folders
          SET restore_parent_id = parent_id, parent_id = NULL, trashed_at = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ? AND trashed_at IS NULL`,
      now(), now(), id, expectedRevision,
    );
    if (Number(result.changes) !== 1) throw new FolderError("revision_conflict");
    touchProjects([folder.project_id]);
  } catch (error) { rethrowFolderConstraint(error); }
}

export function restoreFolder(id: string, expectedRevision: number) {
  const folder = getFolder(id);
  if (!folder) throw new FolderError("not_found");
  if (!folder.trashed_at) throw new FolderError("not_trashed");
  const project = getProject(folder.project_id);
  if (!project || project.trashed_at || project.archived_at) throw new FolderError("trashed");
  const originalParent = folder.restore_parent_id ? getFolder(folder.restore_parent_id) : null;
  const targetParent = originalParent && !originalParent.trashed_at && originalParent.project_id === folder.project_id ? originalParent : null;
  let name = folder.name;
  if (folderNameExists(folder.project_id, targetParent?.id ?? null, name, folder.id)) name = availableRestoredName(folder.project_id, targetParent?.id ?? null, name, folder.id);
  const result = run(
    `UPDATE folders
        SET parent_id = ?, restore_parent_id = NULL, name = ?, name_key = ?, trashed_at = NULL,
            revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ? AND trashed_at IS NOT NULL`,
    targetParent?.id ?? null, name, normalizeKey(name), now(), id, expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new FolderError("revision_conflict");
  touchProjects([folder.project_id]);
  return { folderId: id, parentId: targetParent?.id ?? null, renamed: name !== folder.name, fallbackToProjectRoot: Boolean(folder.restore_parent_id && !targetParent) };
}

/** Called after Inbox permanently removes all content in the subtree. */
export function deleteFolderSubtreeRecords(folderId: string) {
  const folder = getFolder(folderId);
  if (!folder) throw new FolderError("not_found");
  if (!folder.trashed_at) throw new FolderError("not_trashed");
  run("DELETE FROM folders WHERE id = ?", folderId);
  touchProjects([folder.project_id]);
}

/** Project deletion only: folder hierarchy is removed after members were detached. */
export function deleteAllProjectFolders(projectId: string) {
  run("DELETE FROM folders WHERE project_id = ? AND parent_id IS NULL", projectId);
}

export function countProjectFolders(projectId: string) {
  return Number(one<{ count: number }>("SELECT COUNT(*) AS count FROM folders WHERE project_id = ?", projectId)?.count ?? 0);
}

function isFolderInSubtree(rootId: string, candidateId: string) {
  return Boolean(one(
    `WITH RECURSIVE subtree(id) AS (
       SELECT id FROM folders WHERE id = ?
       UNION
       SELECT folder.id FROM folders folder JOIN subtree ON folder.parent_id = subtree.id
     ) SELECT 1 AS found FROM subtree WHERE id = ?`,
    rootId, candidateId,
  ));
}

function requireActiveFolder(id: string) {
  const folder = getFolder(id);
  if (!folder) throw new FolderError("not_found");
  if (folder.trashed_at || hasTrashedAncestor(id)) throw new FolderError("trashed");
  return folder;
}

function hasTrashedAncestor(id: string) {
  return Boolean(one(
    `WITH RECURSIVE ancestors(id, parent_id, trashed_at) AS (
       SELECT id, parent_id, trashed_at FROM folders WHERE id = ?
       UNION
       SELECT folder.id, folder.parent_id, folder.trashed_at FROM folders folder JOIN ancestors ON folder.id = ancestors.parent_id
     ) SELECT 1 AS found FROM ancestors WHERE trashed_at IS NOT NULL LIMIT 1`,
    id,
  ));
}

function folderNameExists(projectId: string, parentId: string | null, name: string, excludeId?: string) {
  const key = normalizeKey(name);
  return Boolean(parentId
    ? one("SELECT 1 AS found FROM folders WHERE project_id = ? AND parent_id = ? AND name_key = ? AND trashed_at IS NULL AND id <> COALESCE(?, '')", projectId, parentId, key, excludeId ?? null)
    : one("SELECT 1 AS found FROM folders WHERE project_id = ? AND parent_id IS NULL AND name_key = ? AND trashed_at IS NULL AND id <> COALESCE(?, '')", projectId, key, excludeId ?? null));
}

function availableRestoredName(projectId: string, parentId: string | null, original: string, excludeId: string) {
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const candidate = suffix === 1 ? `${original} (restored)` : `${original} (restored ${suffix})`;
    if (!folderNameExists(projectId, parentId, candidate, excludeId)) return candidate.slice(0, 255);
  }
  throw new FolderError("name_conflict");
}

function cleanFolderName(value: string) {
  const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (name.length < 1 || name.length > 255 || /[\u0000-\u001f/\\]/u.test(name) || name === "." || name === "..") throw new FolderError("invalid_name");
  return name;
}

function touchProjects(ids: string[]) {
  for (const id of new Set(ids)) run("UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?", now(), id);
}

function rethrowFolderConstraint(error: unknown): never {
  if (error instanceof FolderError) throw error;
  if (error instanceof Error && /folders_live_(?:root|child)_name_uq|UNIQUE constraint failed: folders/.test(error.message)) throw new FolderError("name_conflict");
  if (error instanceof Error && /folder_cycle/.test(error.message)) throw new FolderError("cycle");
  if (error instanceof Error && /FOREIGN KEY constraint failed/.test(error.message)) throw new FolderError("project_mismatch");
  throw error;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);
