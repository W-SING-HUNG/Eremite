import { all, one, run, transaction } from "@/platform/db/database";
import { normalizeKey } from "@/platform/shared/normalization";
import { now, uuidv7 } from "@/platform/shared/ids";
import { synchronizeContentTagText as writeContentTagProjection } from "@/modules/inbox/service";

export type Tag = { id: string; name: string; name_key: string; color: string | null; revision: number; created_at: string; updated_at: string };
export type TagWithUsage = Tag & { content_count: number; action_count: number; run_count: number };
export type TagObjectType = "content" | "action" | "automation_run";

export class TagError extends Error {
  constructor(public readonly code: "invalid_name" | "name_conflict" | "not_found" | "revision_conflict") { super(code); this.name = "TagError"; }
}

export function listTags() { return all<Tag>("SELECT * FROM tags ORDER BY name_key, id"); }

export function listTagsWithUsage() {
  return all<TagWithUsage>(
    `SELECT tag.*,
            (SELECT COUNT(*) FROM content_item_tags link WHERE link.tag_id = tag.id) AS content_count,
            (SELECT COUNT(*) FROM action_tags link WHERE link.tag_id = tag.id) AS action_count,
            (SELECT COUNT(*) FROM automation_run_tags link WHERE link.tag_id = tag.id) AS run_count
       FROM tags tag ORDER BY tag.name_key, tag.id`,
  );
}

export function createTag(input: { name: string; color?: string }) {
  const name = cleanName(input.name);
  const id = uuidv7(); const timestamp = now();
  try { run("INSERT INTO tags (id, name, name_key, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", id, name, normalizeKey(name), input.color?.trim() || null, timestamp, timestamp); }
  catch (error) { rethrowConstraint(error); }
  return id;
}

export function renameTag(input: { id: string; name: string; color?: string; expectedRevision: number }) {
  const name = cleanName(input.name);
  try {
    transaction(() => {
      const result = run("UPDATE tags SET name = ?, name_key = ?, color = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?", name, normalizeKey(name), input.color?.trim() || null, now(), input.id, input.expectedRevision);
      if (Number(result.changes) !== 1) throw new TagError("revision_conflict");
      synchronizeContentTagTextForTag(input.id);
    });
  } catch (error) { rethrowConstraint(error); }
}

export function assignTag(type: TagObjectType, objectId: string, tagId: string) {
  const { table, objectColumn } = association(type);
  transaction(() => {
    run(`INSERT OR IGNORE INTO ${table} (${objectColumn}, tag_id, created_at) VALUES (?, ?, ?)`, objectId, tagId, now());
    if (type === "content") synchronizeContentTagText(objectId);
  });
}

export function removeTag(type: TagObjectType, objectId: string, tagId: string) {
  const { table, objectColumn } = association(type);
  transaction(() => {
    run(`DELETE FROM ${table} WHERE ${objectColumn} = ? AND tag_id = ?`, objectId, tagId);
    if (type === "content") synchronizeContentTagText(objectId);
  });
}

export function setTagsByNames(type: TagObjectType, objectId: string, names: string[]) {
  const cleaned = [...new Map(names.map((name) => cleanName(name)).map((name) => [normalizeKey(name), name])).values()];
  transaction(() => {
    const tagIds = cleaned.map((name) => {
      const key = normalizeKey(name);
      const existing = one<{ id: string }>("SELECT id FROM tags WHERE name_key = ?", key);
      if (existing) return existing.id;
      return createTag({ name });
    });
    const { table, objectColumn } = association(type);
    run(`DELETE FROM ${table} WHERE ${objectColumn} = ?`, objectId);
    for (const tagId of tagIds) run(`INSERT INTO ${table} (${objectColumn}, tag_id, created_at) VALUES (?, ?, ?)`, objectId, tagId, now());
    if (type === "content") synchronizeContentTagText(objectId);
  });
}

export function listObjectTags(type: TagObjectType, objectId: string) {
  const { table, objectColumn } = association(type);
  return all<Tag>(`SELECT tag.* FROM tags tag JOIN ${table} association ON association.tag_id = tag.id WHERE association.${objectColumn} = ? ORDER BY tag.name_key, tag.id`, objectId);
}

export function listObjectTagsMap(type: TagObjectType, objectIds: string[]) {
  if (objectIds.length === 0) return {} as Record<string, Tag[]>;
  const { table, objectColumn } = association(type);
  const placeholders = objectIds.map(() => "?").join(", ");
  const rows = all<Tag & { object_id: string }>(
    `SELECT tag.*, association.${objectColumn} AS object_id FROM tags tag
      JOIN ${table} association ON association.tag_id = tag.id
     WHERE association.${objectColumn} IN (${placeholders}) ORDER BY tag.name_key, tag.id`,
    ...objectIds,
  );
  return rows.reduce<Record<string, Tag[]>>((result, row) => {
    const { object_id: objectId, ...tag } = row;
    (result[objectId] ??= []).push(tag);
    return result;
  }, {});
}

export function mergeTags(sourceId: string, targetId: string) {
  if (sourceId === targetId || !one("SELECT 1 FROM tags WHERE id = ?", sourceId) || !one("SELECT 1 FROM tags WHERE id = ?", targetId)) throw new TagError("not_found");
  transaction(() => {
    const affectedContent = all<{ id: string }>("SELECT content_item_id AS id FROM content_item_tags WHERE tag_id IN (?, ?)", sourceId, targetId).map((row) => row.id);
    for (const { table, objectColumn } of [association("content"), association("action"), association("automation_run")]) {
      run(`INSERT OR IGNORE INTO ${table} (${objectColumn}, tag_id, created_at) SELECT ${objectColumn}, ?, created_at FROM ${table} WHERE tag_id = ?`, targetId, sourceId);
    }
    run("DELETE FROM tags WHERE id = ?", sourceId);
    for (const id of new Set(affectedContent)) synchronizeContentTagText(id);
  });
}

export function deleteTag(id: string) {
  transaction(() => {
    const affectedContent = all<{ id: string }>("SELECT content_item_id AS id FROM content_item_tags WHERE tag_id = ?", id).map((row) => row.id);
    run("DELETE FROM tags WHERE id = ?", id);
    for (const contentId of affectedContent) synchronizeContentTagText(contentId);
  });
}

function synchronizeContentTagTextForTag(tagId: string) {
  const contentIds = all<{ id: string }>("SELECT content_item_id AS id FROM content_item_tags WHERE tag_id = ?", tagId);
  for (const { id } of contentIds) synchronizeContentTagText(id);
}

function synchronizeContentTagText(contentId: string) {
  const names = all<{ name: string }>(
    `SELECT tag.name FROM tags tag JOIN content_item_tags link ON link.tag_id = tag.id
      WHERE link.content_item_id = ? ORDER BY tag.name_key, tag.id`,
    contentId,
  ).map((row) => row.name);
  writeContentTagProjection(contentId, names);
}

function association(type: TagObjectType) {
  if (type === "content") return { table: "content_item_tags", objectColumn: "content_item_id" };
  if (type === "action") return { table: "action_tags", objectColumn: "action_id" };
  return { table: "automation_run_tags", objectColumn: "automation_run_id" };
}

function cleanName(value: string) {
  const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (name.length < 1 || name.length > 64) throw new TagError("invalid_name");
  return name;
}

function rethrowConstraint(error: unknown): never {
  if (error instanceof TagError) throw error;
  if (error instanceof Error && /UNIQUE constraint failed: tags\.name_key/.test(error.message)) throw new TagError("name_conflict");
  throw error;
}
