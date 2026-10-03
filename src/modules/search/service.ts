import { all, db } from "@/platform/db/database";
import { normalizeKey } from "@/platform/shared/normalization";

export type SearchScope = "global" | "project" | "folder";
export type SearchResult = {
  id: string;
  type: "content" | "action" | "automation" | "project" | "folder";
  group: string;
  title: string;
  meta: string;
  href: string;
  projectId: string | null;
  folderId: string | null;
  updatedAt: string;
  revision?: number;
  score: number;
};

const contentStatusLabel: Record<string, string> = { inbox: "新资料", processed: "已处理", archived: "已归档" };
const actionStatusLabel: Record<string, string> = { draft: "草稿", active: "进行中", done: "已完成", cancelled: "已取消", archived: "已归档" };
const priorityLabel: Record<string, string> = { high: "高优先级", normal: "普通优先级", low: "低优先级" };
const runStatusLabel: Record<string, string> = { running: "运行中", completed: "完成", failed: "失败" };
const formatRunInput = (summary: string) => summary.replace(/^(\d+) selected item\(s\)$/, "已选择 $1 条资料");

type SearchInput = { query: string; scope?: SearchScope; projectId?: string; folderId?: string; tagId?: string; limit?: number; grouped?: boolean };

export function searchWorkspace(input: SearchInput) {
  const query = input.query.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!query && !input.tagId) return { results: [] as SearchResult[], groups: {} as Record<string, SearchResult[]> };
  if ((input.scope === "project" && !input.projectId) || (input.scope === "folder" && (!input.projectId || !input.folderId))) {
    return { results: [] as SearchResult[], groups: {} as Record<string, SearchResult[]> };
  }
  const requestedLimit = Number.isSafeInteger(input.limit) ? input.limit! : (input.grouped ? 10 : 30);
  const limit = Math.max(1, Math.min(requestedLimit, 50));
  const candidates = [
    ...searchContent(query, input, limit),
    ...searchActions(query, input, limit),
    ...searchRuns(query, input, limit),
    ...searchProjects(query, input, limit),
    ...searchFolders(query, input, limit),
  ].sort((a, b) => a.score - b.score || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  if (input.grouped) {
    const groups: Record<string, SearchResult[]> = {};
    for (const result of candidates) {
      const group = groups[result.group] ??= [];
      if (group.length < limit) group.push(result);
    }
    return { results: Object.values(groups).flat(), groups };
  }
  return { results: candidates.slice(0, limit), groups: {} as Record<string, SearchResult[]> };
}

/** Bounded Content-only search projection for read-only AI Host adapters. */
export function searchContentForAI(rawQuery: string, requestedLimit = 10) {
  const query = rawQuery.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!query) return [] as SearchResult[];
  const limit = Math.max(1, Math.min(Number.isSafeInteger(requestedLimit) ? requestedLimit : 10, 10));
  return searchContent(query, { query, scope: 'global' }, limit);
}

export function rebuildSearchIndexes() {
  const connection = db();
  connection.exec(`
    DELETE FROM content_search_fts;
    INSERT INTO content_search_fts (object_id, title, metadata)
      SELECT id, title, coalesce(tags, '') || ' ' || coalesce(source_url, '') || ' ' || status || ' ' || kind FROM content_items;
    DELETE FROM action_search_fts;
    INSERT INTO action_search_fts (object_id, title, metadata)
      SELECT id, title, status || ' ' || priority || ' ' || coalesce(due_date, '') FROM actions;
    DELETE FROM automation_search_fts;
    INSERT INTO automation_search_fts (object_id, title, metadata)
      SELECT id, target_name_snapshot, target_id || ' ' || status || ' ' || input_summary || ' ' || coalesce(output_summary, '') || ' ' || coalesce(error_message, '') FROM automation_runs;
    DELETE FROM project_search_fts;
    INSERT INTO project_search_fts (object_id, title, metadata) SELECT id, name, description FROM projects;
    DELETE FROM folder_search_fts;
    INSERT INTO folder_search_fts (object_id, title, metadata) SELECT id, name, '' FROM folders;
  `);
}

export function searchIndexDrift() {
  const checks = [
    ["content_items", "content_search_fts"], ["actions", "action_search_fts"],
    ["automation_runs", "automation_search_fts"], ["projects", "project_search_fts"], ["folders", "folder_search_fts"],
  ];
  return checks.filter(([table, fts]) => {
    const base = Number((db().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
    const indexed = Number((db().prepare(`SELECT COUNT(*) AS count FROM ${fts}`).get() as { count: number }).count);
    return base !== indexed;
  }).map(([table]) => table);
}

function searchContent(query: string, input: SearchInput, limit: number) {
  const params: unknown[] = [];
  const matcher = query ? searchPredicate("content_search_fts", "ci.title", "ci.tags", query, params) : matchAll();
  const scope = contentScope(input, params);
  const tag = input.tagId ? "AND EXISTS (SELECT 1 FROM content_item_tags cit WHERE cit.content_item_id = ci.id AND cit.tag_id = ?)" : "";
  if (input.tagId) params.push(input.tagId);
  params.push(limit);
  const rows = all<any>(
    `WITH RECURSIVE folder_scope(id) AS (
       SELECT id FROM folders WHERE id = ? AND project_id = ?
       UNION
       SELECT folder.id FROM folders folder JOIN folder_scope ON folder.parent_id = folder_scope.id
     ), effectively_trashed_folders(id) AS (
       SELECT id FROM folders WHERE trashed_at IS NOT NULL
       UNION
       SELECT folder.id FROM folders folder JOIN effectively_trashed_folders trashed ON folder.parent_id = trashed.id
     )
     SELECT ci.id, ci.title, ci.kind, ci.status, ci.project_id, ci.folder_id, ci.updated_at, ci.revision,
            ${matcher.score} AS score
       FROM content_items ci ${matcher.join}
      WHERE ci.trashed_at IS NULL
        AND (ci.folder_id IS NULL OR ci.folder_id NOT IN (SELECT id FROM effectively_trashed_folders))
        AND ${matcher.where} ${scope} ${tag}
      ORDER BY score, ci.updated_at DESC, ci.id DESC LIMIT ?`,
    input.folderId ?? "", input.projectId ?? "", ...params,
  );
  return rows.map((row: any): SearchResult => ({
    id: `content:${row.id}`, type: "content", group: "资料", title: row.title,
    meta: `${row.kind === "file" ? "文件" : "链接"} · ${contentStatusLabel[row.status] ?? row.status}`,
    href: row.project_id ? `/projects/${row.project_id}${row.folder_id ? `/folders/${row.folder_id}` : ""}?selected=${row.id}` : `/inbox?selected=${row.id}`,
    projectId: row.project_id, folderId: row.folder_id, updatedAt: row.updated_at, revision: row.revision, score: Number(row.score),
  }));
}

function searchActions(query: string, input: SearchInput, limit: number) {
  if (input.scope === "folder") return [];
  const params: unknown[] = [];
  const matcher = query ? searchPredicate("action_search_fts", "a.title", "a.status || ' ' || a.priority", query, params) : matchAll();
  const project = input.scope === "project" && input.projectId ? "AND a.project_id = ?" : "";
  if (project) params.push(input.projectId);
  const tag = input.tagId ? "AND EXISTS (SELECT 1 FROM action_tags at WHERE at.action_id = a.id AND at.tag_id = ?)" : "";
  if (input.tagId) params.push(input.tagId);
  params.push(limit);
  const rows = all<any>(`SELECT a.id, a.title, a.status, a.priority, a.project_id, a.updated_at, ${matcher.score} AS score FROM actions a ${matcher.join} WHERE a.trashed_at IS NULL AND ${matcher.where} ${project} ${tag} ORDER BY score, a.updated_at DESC, a.id DESC LIMIT ?`, ...params);
  return rows.map((row: any): SearchResult => ({ id: `action:${row.id}`, type: "action", group: "行动", title: row.title, meta: `${actionStatusLabel[row.status] ?? row.status} · ${priorityLabel[row.priority] ?? row.priority}`, href: row.project_id ? `/projects/${row.project_id}?tab=actions&selected=${row.id}` : `/actions?selected=${row.id}`, projectId: row.project_id, folderId: null, updatedAt: row.updated_at, score: Number(row.score) }));
}

function searchRuns(query: string, input: SearchInput, limit: number) {
  if (input.scope === "folder") return [];
  const params: unknown[] = [];
  const matcher = query ? searchPredicate("automation_search_fts", "r.target_name_snapshot", "r.input_summary || ' ' || coalesce(r.output_summary, '') || ' ' || coalesce(r.error_message, '')", query, params) : matchAll();
  const project = input.scope === "project" && input.projectId ? "AND r.project_id = ?" : "";
  if (project) params.push(input.projectId);
  const tag = input.tagId ? "AND EXISTS (SELECT 1 FROM automation_run_tags art WHERE art.automation_run_id = r.id AND art.tag_id = ?)" : "";
  if (input.tagId) params.push(input.tagId);
  params.push(limit);
  const rows = all<any>(`SELECT r.id, r.target_name_snapshot AS title, r.input_summary, r.status, r.project_id, r.created_at AS updated_at, ${matcher.score} AS score FROM automation_runs r ${matcher.join} WHERE r.trashed_at IS NULL AND ${matcher.where} ${project} ${tag} ORDER BY score, r.created_at DESC, r.id DESC LIMIT ?`, ...params);
  return rows.map((row: any): SearchResult => ({ id: `run:${row.id}`, type: "automation", group: "运行记录", title: row.title, meta: `${runStatusLabel[row.status] ?? row.status} · ${formatRunInput(row.input_summary)}`, href: row.project_id ? `/projects/${row.project_id}?tab=automations&selected=${row.id}` : `/automations?selected=${row.id}`, projectId: row.project_id, folderId: null, updatedAt: row.updated_at, score: Number(row.score) }));
}

function searchProjects(query: string, input: SearchInput, limit: number) {
  if (input.scope !== undefined && input.scope !== "global") return [];
  if (!query || input.tagId) return [];
  const params: unknown[] = [];
  const matcher = searchPredicate("project_search_fts", "p.name", "p.description", query, params);
  params.push(limit);
  const rows = all<any>(`SELECT p.id, p.name AS title, p.description, p.updated_at, ${matcher.score} AS score FROM projects p ${matcher.join} WHERE p.trashed_at IS NULL AND ${matcher.where} ORDER BY score, p.updated_at DESC, p.id DESC LIMIT ?`, ...params);
  return rows.map((row: any): SearchResult => ({ id: `project:${row.id}`, type: "project", group: "专案", title: row.title, meta: row.description || "专案", href: `/projects/${row.id}`, projectId: row.id, folderId: null, updatedAt: row.updated_at, score: Number(row.score) }));
}

function searchFolders(query: string, input: SearchInput, limit: number) {
  if (!query || input.tagId) return [];
  const params: unknown[] = [];
  const matcher = searchPredicate("folder_search_fts", "f.name", "''", query, params);
  let scope = "";
  if (input.scope === "project" && input.projectId) { scope = "AND f.project_id = ?"; params.push(input.projectId); }
  if (input.scope === "folder" && input.folderId) { scope = "AND f.id IN (SELECT id FROM folder_scope WHERE id <> ?)"; params.push(input.folderId); }
  params.push(limit);
  const rows = all<any>(`WITH RECURSIVE folder_scope(id) AS (
    SELECT id FROM folders WHERE id = ? AND project_id = ?
    UNION SELECT child.id FROM folders child JOIN folder_scope ON child.parent_id = folder_scope.id
  ) SELECT f.id, f.name AS title, f.project_id, f.parent_id, f.updated_at, ${matcher.score} AS score FROM folders f ${matcher.join} WHERE f.trashed_at IS NULL AND ${matcher.where} ${scope} ORDER BY score, f.updated_at DESC, f.id DESC LIMIT ?`, input.folderId ?? "", input.projectId ?? "", ...params);
  return rows.map((row: any): SearchResult => ({ id: `folder:${row.id}`, type: "folder", group: "文件夹", title: row.title, meta: "文件夹", href: `/projects/${row.project_id}/folders/${row.id}`, projectId: row.project_id, folderId: row.id, updatedAt: row.updated_at, score: Number(row.score) }));
}

function searchPredicate(fts: string, title: string, metadata: string, query: string, params: unknown[]) {
  if ([...query].length < 3) {
    params.push(`%${escapeLike(normalizeKey(query))}%`, `%${escapeLike(normalizeKey(query))}%`);
    return { join: "", where: `(eremite_normalize_key(${title}) LIKE ? ESCAPE '\\' OR eremite_normalize_key(${metadata}) LIKE ? ESCAPE '\\')`, score: "0.0" };
  }
  params.push(`"${query.replaceAll('"', '""')}"`);
  return { join: `JOIN ${fts} ON ${fts}.object_id = ${fts.startsWith("content") ? "ci" : fts.startsWith("action") ? "a" : fts.startsWith("automation") ? "r" : fts.startsWith("project") ? "p" : "f"}.id`, where: `${fts} MATCH ?`, score: `bm25(${fts})` };
}

function matchAll() { return { join: "", where: "1 = 1", score: "0.0" }; }

function contentScope(input: SearchInput, params: unknown[]) {
  if (input.scope === "folder" && input.folderId) return "AND ci.folder_id IN (SELECT id FROM folder_scope)";
  if (input.scope === "project" && input.projectId) { params.push(input.projectId); return "AND ci.project_id = ?"; }
  return "";
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);
