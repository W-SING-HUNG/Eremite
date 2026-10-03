import { all, one, run } from "@/platform/db/database";
import { normalizeKey } from "@/platform/shared/normalization";
import { now, uuidv7 } from "@/platform/shared/ids";

export type Project = {
  id: string; name: string; name_key: string; description: string; color: string | null;
  pinned_at: string | null; archived_at: string | null; trashed_at: string | null;
  revision: number; created_at: string; updated_at: string;
};

export class ProjectError extends Error {
  constructor(public readonly code: "invalid_name" | "invalid_description" | "name_conflict" | "not_found" | "archived" | "not_trashed" | "revision_conflict") {
    super(code);
    this.name = "ProjectError";
  }
}

export function listProjects(options: { includeArchived?: boolean; trashOnly?: boolean } = {}) {
  const where = options.trashOnly
    ? "trashed_at IS NOT NULL"
    : `trashed_at IS NULL ${options.includeArchived ? "" : "AND archived_at IS NULL"}`;
  return all<Project>(`SELECT * FROM projects WHERE ${where} ORDER BY pinned_at IS NULL, pinned_at DESC, updated_at DESC, id DESC`);
}

export function getProject(id: string) { return one<Project>("SELECT * FROM projects WHERE id = ?", id); }

/** Minimal public projection used by read-only AI Host adapters. */
export function getProjectForAI(id: string) {
  return one<Pick<Project, 'id' | 'name' | 'description' | 'revision' | 'archived_at'>>(
    'SELECT id, name, description, revision, archived_at FROM projects WHERE id = ? AND trashed_at IS NULL', id,
  );
}

export function createProject(input: { name: string; description?: string; color?: string }) {
  const values = validateProject(input);
  const id = uuidv7();
  const timestamp = now();
  try {
    run("INSERT INTO projects (id, name, name_key, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, values.name, values.nameKey, values.description, input.color?.trim() || null, timestamp, timestamp);
  } catch (error) { rethrowProjectConstraint(error); }
  return id;
}

export function updateProject(input: { id: string; name: string; description?: string; color?: string; expectedRevision: number }) {
  const values = validateProject(input);
  try {
    const result = run("UPDATE projects SET name = ?, name_key = ?, description = ?, color = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?", values.name, values.nameKey, values.description, input.color?.trim() || null, now(), input.id, input.expectedRevision);
    if (Number(result.changes) !== 1) throw new ProjectError("revision_conflict");
  } catch (error) { rethrowProjectConstraint(error); }
}

export function setProjectPinned(id: string, pinned: boolean) { requireProject(id); run("UPDATE projects SET pinned_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?", pinned ? now() : null, now(), id); }
export function archiveProject(id: string, expectedRevision: number) {
  const timestamp = now();
  const result = run(
    "UPDATE projects SET archived_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND archived_at IS NULL AND trashed_at IS NULL",
    timestamp, timestamp, id, expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new ProjectError("revision_conflict");
}

export function unarchiveProject(id: string, expectedRevision: number) {
  const result = run(
    "UPDATE projects SET archived_at = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND archived_at IS NOT NULL AND trashed_at IS NULL",
    now(), id, expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new ProjectError("revision_conflict");
}

export function trashProject(id: string, expectedRevision: number) {
  const timestamp = now();
  const result = run(
    "UPDATE projects SET trashed_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NULL",
    timestamp, timestamp, id, expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new ProjectError("revision_conflict");
}

export function restoreProject(id: string, expectedRevision: number) {
  const result = run(
    "UPDATE projects SET trashed_at = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NOT NULL",
    now(), id, expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new ProjectError("revision_conflict");
}

export function permanentDeleteProject(id: string) {
  const project = requireProject(id);
  if (!project.trashed_at) throw new ProjectError("not_trashed");
  run("DELETE FROM projects WHERE id = ?", id);
}

export function assertProjectAcceptsMembers(projectId: string | null | undefined) {
  if (!projectId) return null;
  const project = requireProject(projectId);
  if (project.archived_at || project.trashed_at) throw new ProjectError("archived");
  return project;
}

function requireProject(id: string) {
  const project = getProject(id);
  if (!project) throw new ProjectError("not_found");
  return project;
}

function validateProject(input: { name: string; description?: string }) {
  const name = input.name.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const description = input.description?.trim() ?? "";
  if (name.length < 1 || name.length > 120) throw new ProjectError("invalid_name");
  if (description.length > 2000) throw new ProjectError("invalid_description");
  return { name, nameKey: normalizeKey(name), description };
}

function rethrowProjectConstraint(error: unknown): never {
  if (error instanceof ProjectError) throw error;
  if (error instanceof Error && /UNIQUE constraint failed: projects\.name_key/.test(error.message)) throw new ProjectError("name_conflict");
  throw error;
}
