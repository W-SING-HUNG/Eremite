import { all, one, run, transaction } from "@/platform/db/database";
import { now, uuidv7 } from "@/platform/shared/ids";
import { decodeCursor, encodeCursor, pageLimit } from "@/platform/shared/pagination";
import { getProject } from "@/modules/projects/service";
import { getServerTool, getToolMetadata } from "@/modules/automations/registry";
import { AutomationContextError, contentToActionDraftsServerTool } from "@/modules/automations/tools/content-to-action-drafts";
import { CONTENT_TO_ACTION_DRAFTS_TOOL_ID } from "@/modules/automations/tools/catalog";

export type AutomationRunStatus = "running" | "completed" | "failed";
export type AutomationRun = {
  id: string; automation_key: string; target_id: string; target_version: number;
  target_name_snapshot: string; operation_id: string; status: AutomationRunStatus;
  input_summary: string; input_payload_json: string; output_summary: string | null;
  output_payload_json: string | null; error_code: string | null; error_message: string | null;
  project_id: string | null; project_name_snapshot: string | null; output_action_id: string | null;
  trashed_at: string | null; revision: number; created_at: string; completed_at: string | null;
};

export type ExecuteToolResult = { runId: string; reused: boolean; status: AutomationRunStatus };
export { AutomationContextError };

type ExternalToolInput = { projectId: string | null };
type ExternalToolRegistration = {
  executionPolicy: { mode: "request"; runner: "external"; staleAfterMs: number };
  validateInput(raw: unknown, context: { projectId?: string | null }): ExternalToolInput;
  encodeInputPayload(input: ExternalToolInput): unknown;
  summarizeInput(input: ExternalToolInput): string;
  captureInputSnapshot(runId: string, input: ExternalToolInput): void;
  executeExternal(input: ExternalToolInput, context: { runId: string; writePending(payload: unknown): void }): Promise<unknown>;
  summarizeOutput(output: unknown): string;
  encodeOutputPayload(output: unknown): unknown;
  mapError(error: unknown): { code: string; message: string };
};

export function listAutomationRuns() {
  return all<AutomationRun>("SELECT * FROM automation_runs WHERE trashed_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 20");
}

export function getAutomationRun(id: string) {
  return one<AutomationRun>('SELECT * FROM automation_runs WHERE id = ?', id);
}

export function listAutomationRunsPage(input: { cursor?: string; limit?: number; targetId?: string; status?: AutomationRunStatus } = {}) {
  const cursor = decodeCursor(input.cursor); const limit = pageLimit(input.limit);
  const filters: string[] = ["trashed_at IS NULL"]; const params: unknown[] = [];
  if (input.targetId) { filters.push("target_id = ?"); params.push(input.targetId); }
  if (input.status) { filters.push("status = ?"); params.push(input.status); }
  if (cursor) { filters.push("(created_at < ? OR (created_at = ? AND id < ?))"); params.push(cursor.timestamp, cursor.timestamp, cursor.id); }
  params.push(limit + 1);
  return pageResult(all<AutomationRun>(`SELECT * FROM automation_runs WHERE ${filters.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`, ...params), limit);
}

export function listProjectAutomationRuns(projectId: string) {
  return all<AutomationRun>("SELECT * FROM automation_runs WHERE trashed_at IS NULL AND project_id = ? ORDER BY created_at DESC, id DESC LIMIT 100", projectId);
}

export function listProjectAutomationRunsPage(projectId: string, input: { cursor?: string; limit?: number; targetId?: string; status?: AutomationRunStatus } = {}) {
  const cursor = decodeCursor(input.cursor); const limit = pageLimit(input.limit);
  const filters = ["trashed_at IS NULL", "project_id = ?"]; const params: unknown[] = [projectId];
  if (input.targetId) { filters.push("target_id = ?"); params.push(input.targetId); }
  if (input.status) { filters.push("status = ?"); params.push(input.status); }
  if (cursor) { filters.push("(created_at < ? OR (created_at = ? AND id < ?))"); params.push(cursor.timestamp, cursor.timestamp, cursor.id); }
  params.push(limit + 1);
  return pageResult(all<AutomationRun>(`SELECT * FROM automation_runs WHERE ${filters.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`, ...params), limit);
}

export function listTrashedAutomationRuns() {
  return all<AutomationRun>("SELECT * FROM automation_runs WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC, id DESC");
}

export function executeTool(input: { operationId: string; toolId: string; rawInput: unknown; projectId?: string | null }): ExecuteToolResult {
  const operationId = normalizeOperationId(input.operationId);
  const metadata = getToolMetadata(input.toolId); const tool = getServerTool(input.toolId);
  if (!metadata || !tool) throw new AutomationContextError("unknown_tool");
  if ("runner" in tool.executionPolicy && tool.executionPolicy.runner === "external") throw new AutomationContextError("input_unavailable");
  const transactionalTool = tool as typeof contentToActionDraftsServerTool;
  const validated = transactionalTool.validateInput(input.rawInput, { projectId: input.projectId });
  const inputPayloadJson = encodePayload(transactionalTool.encodeInputPayload(validated));
  const inputSummary = transactionalTool.summarizeInput(validated);
  const projectNameSnapshot = validated.projectId ? getProject(validated.projectId)?.name ?? null : null;

  const accepted = transaction(() => {
    const existing = one<AutomationRun>("SELECT * FROM automation_runs WHERE operation_id = ?", operationId);
    if (existing) {
      if (existing.target_id !== metadata.id || existing.target_version !== metadata.version || existing.project_id !== validated.projectId || existing.input_payload_json !== inputPayloadJson) throw new AutomationContextError("idempotency_conflict");
      return { run: existing, created: false };
    }
    const runId = uuidv7(); const timestamp = now();
    run(
      `INSERT INTO automation_runs (
         id, automation_key, target_id, target_version, target_name_snapshot, operation_id,
         status, input_summary, input_payload_json, project_id, project_name_snapshot, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
      runId, metadata.id, metadata.id, metadata.version, metadata.name, operationId,
      inputSummary, inputPayloadJson, validated.projectId, projectNameSnapshot, timestamp,
    );
    transactionalTool.captureInputSnapshot(runId, validated);
    return { run: one<AutomationRun>("SELECT * FROM automation_runs WHERE id = ?", runId)!, created: true };
  });
  if (!accepted.created) return { runId: accepted.run.id, reused: true, status: accepted.run.status };

  try {
    transactionalTool.execute(validated, (uow, output) => {
      transactionalTool.captureOutputSnapshot(uow, accepted.run.id, output);
      const result = run(
        `UPDATE automation_runs SET status = 'completed', output_summary = ?, output_payload_json = ?,
           error_code = NULL, error_message = NULL, completed_at = ?, revision = revision + 1
         WHERE id = ? AND status = 'running'`,
        transactionalTool.summarizeOutput(output), encodePayload(transactionalTool.encodeOutputPayload(output)), now(), accepted.run.id,
      );
      if (Number(result.changes) !== 1) throw new Error("automation_run_completion_conflict");
    });
  } catch (error) {
    const safe = transactionalTool.mapError(error);
    transaction(() => {
      run(`UPDATE automation_runs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?, revision = revision + 1 WHERE id = ? AND status = 'running'`, safe.code, safe.message, now(), accepted.run.id);
    });
  }
  const finished = one<AutomationRun>("SELECT * FROM automation_runs WHERE id = ?", accepted.run.id)!;
  return { runId: finished.id, reused: false, status: finished.status };
}

/** Generic request-bound async coordinator for registered external tools. */
export async function executeExternalTool(
  input: { operationId: string; toolId: string; rawInput: unknown; projectId?: string | null },
  acceptance?: { onAccepted(runId: string, validated: unknown): void; onExisting?(runId: string): void },
): Promise<ExecuteToolResult> {
  const operationId = normalizeOperationId(input.operationId);
  const metadata = getToolMetadata(input.toolId); const registered = getServerTool(input.toolId);
  if (!metadata || !registered) throw new AutomationContextError("unknown_tool");
  if (!("runner" in registered.executionPolicy) || registered.executionPolicy.runner !== "external") throw new AutomationContextError("unknown_tool");
  const tool = registered as unknown as ExternalToolRegistration;
  const accepted = transaction(() => {
    // Validate and accept under the same write lock. The optional Host gate
    // binds a user-confirmed proposal to this exact Run before execution.
    const validated = tool.validateInput(input.rawInput, { projectId: input.projectId });
    const inputPayloadJson = encodePayload(tool.encodeInputPayload(validated)); const inputSummary = tool.summarizeInput(validated);
    const projectNameSnapshot = validated.projectId ? getProject(validated.projectId)?.name ?? null : null;
    const existing = one<AutomationRun>("SELECT * FROM automation_runs WHERE operation_id = ?", operationId);
    if (existing) {
      if (existing.target_id !== metadata.id || existing.target_version !== metadata.version || existing.project_id !== validated.projectId || existing.input_payload_json !== inputPayloadJson) throw new AutomationContextError("idempotency_conflict");
      acceptance?.onExisting?.(existing.id);
      return { run: existing, created: false, validated: null };
    }
    const runId = uuidv7(); const timestamp = now();
    run(`INSERT INTO automation_runs (id, automation_key, target_id, target_version, target_name_snapshot, operation_id, status, input_summary, input_payload_json, project_id, project_name_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`, runId, metadata.id, metadata.id, metadata.version, metadata.name, operationId, inputSummary, inputPayloadJson, validated.projectId, projectNameSnapshot, timestamp);
    tool.captureInputSnapshot(runId, validated);
    acceptance?.onAccepted(runId, validated);
    return { run: one<AutomationRun>("SELECT * FROM automation_runs WHERE id = ?", runId)!, created: true, validated };
  });
  if (!accepted.created) return { runId: accepted.run.id, reused: true, status: accepted.run.status };
  const validated = accepted.validated!;
  try {
    const output = await tool.executeExternal(validated, { runId: accepted.run.id, writePending(payload) { const result = run("UPDATE automation_runs SET output_payload_json = ?, revision = revision + 1 WHERE id = ? AND status = 'running'", encodePayload(payload), accepted.run.id); if (Number(result.changes) !== 1) throw new Error("automation_run_pending_conflict"); } });
    transaction(() => {
      const result = run(`UPDATE automation_runs SET status = 'completed', output_summary = ?, output_payload_json = ?, error_code = NULL, error_message = NULL, completed_at = ?, revision = revision + 1 WHERE id = ? AND status = 'running'`, tool.summarizeOutput(output), encodePayload(tool.encodeOutputPayload(output)), now(), accepted.run.id);
      if (Number(result.changes) !== 1) throw new Error("automation_run_completion_conflict");
    });
  } catch (error) {
    const safe = tool.mapError(error);
    transaction(() => { run(`UPDATE automation_runs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?, revision = revision + 1 WHERE id = ? AND status = 'running'`, safe.code, safe.message, now(), accepted.run.id); });
  }
  const finished = one<AutomationRun>("SELECT * FROM automation_runs WHERE id = ?", accepted.run.id)!;
  return { runId: finished.id, reused: false, status: finished.status };
}

/** Compatibility entrypoint; all writes flow through the registered tool coordinator. */
export function runInboxToDrafts(contentItemIds: string[], requestedProjectId?: string | null) {
  return executeTool({ operationId: uuidv7(), toolId: CONTENT_TO_ACTION_DRAFTS_TOOL_ID, rawInput: { contentItemIds }, projectId: requestedProjectId }).runId;
}

export function trashAutomationRun(id: string, expectedRevision: number) {
  const result = run("UPDATE automation_runs SET trashed_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND trashed_at IS NULL", now(), id, expectedRevision);
  if (Number(result.changes) !== 1) throw new Error("automation_revision_conflict");
}

export function restoreAutomationRun(id: string, expectedRevision: number) {
  const existing = one<AutomationRun>("SELECT * FROM automation_runs WHERE id = ?", id);
  if (!existing?.trashed_at) throw new Error("automation_not_trashed");
  const result = run("UPDATE automation_runs SET trashed_at = NULL, revision = revision + 1 WHERE id = ? AND revision = ? AND trashed_at IS NOT NULL", id, expectedRevision);
  if (Number(result.changes) !== 1) throw new Error("automation_revision_conflict");
  return { projectId: existing.project_id, projectNameSnapshot: existing.project_name_snapshot };
}

export function permanentlyDeleteAutomationRun(id: string) {
  const result = run("DELETE FROM automation_runs WHERE id = ? AND trashed_at IS NOT NULL", id);
  if (Number(result.changes) !== 1) throw new Error("automation_not_trashed");
}

export function detachAllProjectRuns(projectId: string) {
  run("UPDATE automation_runs SET project_id = NULL, revision = revision + 1 WHERE project_id = ?", projectId);
}

export function countProjectRuns(projectId: string) {
  return Number(one<{ count: number }>("SELECT COUNT(*) AS count FROM automation_runs WHERE project_id = ?", projectId)?.count ?? 0);
}

function pageResult(rows: AutomationRun[], limit: number) {
  const hasMore = rows.length > limit; const items = hasMore ? rows.slice(0, limit) : rows; const tail = items.at(-1);
  return { items, nextCursor: hasMore && tail ? encodeCursor({ timestamp: tail.created_at, id: tail.id }) : null };
}

function normalizeOperationId(value: string) {
  const operationId = value.normalize("NFKC").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(operationId)) throw new AutomationContextError("idempotency_conflict");
  return operationId.toLowerCase();
}

function encodePayload(payload: unknown) {
  const json = JSON.stringify(payload);
  if (!json || json.length > 65_536) throw new AutomationContextError("input_unavailable");
  return json;
}
