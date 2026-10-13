import { all, one, run, transaction } from "@/platform/db/database";
import { now, uuidv7 } from "@/platform/shared/ids";
import { decodeCursor, encodeCursor, pageLimit } from "@/platform/shared/pagination";
import { getProject } from "@/modules/projects/service";
import { getServerTool, getToolMetadata } from "@/modules/automations/registry";
import { AutomationContextError, contentToActionDraftsServerTool } from "@/modules/automations/tools/content-to-action-drafts";
import { CONTENT_TO_ACTION_DRAFTS_TOOL_ID, FILE_CONVERTER_TOOL_ID, PDF_TOOLS_TOOL_ID } from "@/modules/automations/tools/catalog";
import { hasFileCreationReceiptWithPrefix } from "@/modules/inbox/service";
import { ToolRetryError } from "@/modules/automations/tools/retry-snapshot";

export type AutomationRunStatus = "running" | "completed" | "failed";
export type AutomationRun = {
  id: string; automation_key: string; target_id: string; target_version: number;
  target_name_snapshot: string; operation_id: string; status: AutomationRunStatus;
  input_summary: string; input_payload_json: string; output_summary: string | null;
  output_payload_json: string | null; error_code: string | null; error_message: string | null;
  project_id: string | null; project_name_snapshot: string | null; output_action_id: string | null;
  trashed_at: string | null; revision: number; created_at: string; completed_at: string | null;
  retry_of_run_id: string | null;
  retry?: { allowed: boolean; reason: string | null; childRunId: string | null; childTrashed?: boolean; parentTrashed?: boolean };
};

export type ExecuteToolResult = { runId: string; reused: boolean; status: AutomationRunStatus };
export { AutomationContextError };

type ExternalToolInput = { projectId: string | null };
type ExternalToolRegistration = {
  executionPolicy: { mode: "request"; runner: "external"; staleAfterMs: number };
  validateInput(raw: unknown, context: { projectId?: string | null }): ExternalToolInput;
  validateRetryInput(payload: unknown): ExternalToolInput;
  encodeInputPayload(input: ExternalToolInput): unknown;
  summarizeInput(input: ExternalToolInput): string;
  captureInputSnapshot(runId: string, input: ExternalToolInput): void;
  executeExternal(input: ExternalToolInput, context: { runId: string; writePending(payload: unknown): void; assertRunning(): void }): Promise<unknown>;
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

export function getAutomationRunView(id: string) {
  const item = getAutomationRun(id);
  return item ? { ...item, retry: getAutomationRetryEligibility(id) } : undefined;
}

function requireRetryParent(id: string) {
  const parent = getAutomationRun(id);
  if (!parent || parent.status !== "failed" || parent.trashed_at || (parent.target_id !== FILE_CONVERTER_TOOL_ID && parent.target_id !== PDF_TOOLS_TOOL_ID)) throw new ToolRetryError("retry_not_allowed");
  if (parent.output_payload_json !== null || parent.output_summary !== null || parent.output_action_id !== null || one("SELECT run_id FROM automation_run_outputs WHERE run_id = ? LIMIT 1", id) || hasFileCreationReceiptWithPrefix(`automation:${id}:output:`)) throw new ToolRetryError("retry_output_exists");
  const metadata = getToolMetadata(parent.target_id); const registered = getServerTool(parent.target_id);
  if (!metadata || !registered || metadata.version !== parent.target_version || !("runner" in registered.executionPolicy) || registered.executionPolicy.runner !== "external") throw new ToolRetryError("retry_stale_tool");
  const tool = registered as unknown as ExternalToolRegistration;
  let payload: unknown;
  try { payload = JSON.parse(parent.input_payload_json); } catch { throw new ToolRetryError("retry_snapshot_incomplete"); }
  let validated: ExternalToolInput;
  try { validated = tool.validateRetryInput(payload); }
  catch (error) { if (error instanceof ToolRetryError) throw error; throw new ToolRetryError("retry_snapshot_incomplete"); }
  const inputs = all<{ ordinal: number; content_id: string | null; file_version_id: string | null; file_sha256_snapshot: string | null; file_byte_size_snapshot: number | null }>("SELECT ordinal, content_id, file_version_id, file_sha256_snapshot, file_byte_size_snapshot FROM automation_run_inputs WHERE run_id = ? ORDER BY ordinal", id);
  const evidence = (payload as { retryEvidence: { sources: Array<{ contentId: string; versionId: string; sha256: string; byteSize: number }> } }).retryEvidence;
  if (inputs.length !== evidence.sources.length || inputs.some((entry, index) => entry.ordinal !== index || entry.content_id !== evidence.sources[index].contentId || entry.file_version_id !== evidence.sources[index].versionId || entry.file_sha256_snapshot !== evidence.sources[index].sha256 || entry.file_byte_size_snapshot !== evidence.sources[index].byteSize)) throw new ToolRetryError("retry_snapshot_incomplete");
  return { parent, validated };
}

export function getAutomationRetryEligibility(id: string) {
  const child = one<{ id: string; trashed_at: string | null }>("SELECT id, trashed_at FROM automation_runs WHERE retry_of_run_id = ?", id);
  const item = getAutomationRun(id);
  const parentTrashed = Boolean(item?.retry_of_run_id && getAutomationRun(item.retry_of_run_id)?.trashed_at);
  if (child) return { allowed: false, reason: null, childRunId: child.id, childTrashed: Boolean(child.trashed_at), parentTrashed };
  try { requireRetryParent(id); return { allowed: true, reason: null, childRunId: null, parentTrashed }; }
  catch (error) { return { allowed: false, reason: error instanceof ToolRetryError ? error.code : "retry_not_allowed", childRunId: null, parentTrashed }; }
}

/** Host entry: user authorization belongs to the calling Server Action. */
export async function retryExternalTool(id: string): Promise<ExecuteToolResult> {
  const parent = getAutomationRun(id);
  if (!parent || (parent.target_id !== FILE_CONVERTER_TOOL_ID && parent.target_id !== PDF_TOOLS_TOOL_ID)) throw new ToolRetryError("retry_not_allowed");
  const child = one<AutomationRun>("SELECT * FROM automation_runs WHERE retry_of_run_id = ?", id);
  if (child) return { runId: child.id, status: child.status, reused: true };
  const registered = getServerTool(parent.target_id);
  if (!getToolMetadata(parent.target_id) || !registered || !("runner" in registered.executionPolicy) || registered.executionPolicy.runner !== "external") throw new ToolRetryError("retry_stale_tool");
  return executeExternalTool({ operationId: uuidv7(), toolId: parent.target_id, rawInput: null, retryOfRunId: id });
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
  input: { operationId: string; toolId: string; rawInput: unknown; projectId?: string | null; retryOfRunId?: string },
  acceptance?: { onAccepted(runId: string, validated: unknown): void; onExisting?(runId: string): void },
): Promise<ExecuteToolResult> {
  const operationId = normalizeOperationId(input.operationId);
  const metadata = getToolMetadata(input.toolId); const registered = getServerTool(input.toolId);
  if (!metadata || !registered) throw new AutomationContextError("unknown_tool");
  if (!("runner" in registered.executionPolicy) || registered.executionPolicy.runner !== "external") throw new AutomationContextError("unknown_tool");
  const tool = registered as unknown as ExternalToolRegistration;
  const accepted = transaction(() => {
    if (input.retryOfRunId) {
      const child = one<AutomationRun>("SELECT * FROM automation_runs WHERE retry_of_run_id = ?", input.retryOfRunId);
      if (child) return { run: child, created: false, validated: null };
    }
    // Validate and accept under the same write lock. The optional Host gate
    // binds a user-confirmed proposal to this exact Run before execution.
    const retry = input.retryOfRunId ? requireRetryParent(input.retryOfRunId) : null;
    if (retry && retry.parent.target_id !== metadata.id) throw new ToolRetryError("retry_stale_tool");
    const validated = retry ? retry.validated : tool.validateInput(input.rawInput, { projectId: input.projectId });
    // Retry was fully revalidated above; preserve the parent's exact historical encoding (v1 or v2).
    const inputPayloadJson = encodePayload(tool.encodeInputPayload(validated), retry?.parent.input_payload_json); const inputSummary = tool.summarizeInput(validated);
    const projectNameSnapshot = validated.projectId ? getProject(validated.projectId)?.name ?? null : null;
    const existing = one<AutomationRun>("SELECT * FROM automation_runs WHERE operation_id = ?", operationId);
    if (existing) {
      if (existing.target_id !== metadata.id || existing.target_version !== metadata.version || existing.project_id !== validated.projectId || existing.input_payload_json !== inputPayloadJson) throw new AutomationContextError("idempotency_conflict");
      acceptance?.onExisting?.(existing.id);
      return { run: existing, created: false, validated: null };
    }
    const runId = uuidv7(); const timestamp = now();
    run(`INSERT INTO automation_runs (id, automation_key, target_id, target_version, target_name_snapshot, operation_id, status, input_summary, input_payload_json, project_id, project_name_snapshot, created_at, retry_of_run_id) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`, runId, metadata.id, metadata.id, metadata.version, metadata.name, operationId, inputSummary, inputPayloadJson, validated.projectId, projectNameSnapshot, timestamp, input.retryOfRunId ?? null);
    tool.captureInputSnapshot(runId, validated);
    acceptance?.onAccepted(runId, validated);
    return { run: one<AutomationRun>("SELECT * FROM automation_runs WHERE id = ?", runId)!, created: true, validated };
  });
  if (!accepted.created) return { runId: accepted.run.id, reused: true, status: accepted.run.status };
  const validated = accepted.validated!;
  try {
    const output = await tool.executeExternal(validated, { runId: accepted.run.id, assertRunning() { if (!one("SELECT id FROM automation_runs WHERE id = ? AND status = 'running'", accepted.run.id)) throw new Error("automation_run_output_commit_conflict"); }, writePending(payload) { const result = run("UPDATE automation_runs SET output_payload_json = ?, revision = revision + 1 WHERE id = ? AND status = 'running'", encodePayload(payload), accepted.run.id); if (Number(result.changes) !== 1) throw new Error("automation_run_pending_conflict"); } });
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
  if (one("SELECT id FROM automation_runs WHERE (id = ? AND retry_of_run_id IS NOT NULL) OR retry_of_run_id = ? LIMIT 1", id, id)) throw new ToolRetryError("retry_history_required");
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
  return { items: items.map(item => ({ ...item, retry: getAutomationRetryEligibility(item.id) })), nextCursor: hasMore && tail ? encodeCursor({ timestamp: tail.created_at, id: tail.id }) : null };
}

function normalizeOperationId(value: string) {
  const operationId = value.normalize("NFKC").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(operationId)) throw new AutomationContextError("idempotency_conflict");
  return operationId.toLowerCase();
}

function encodePayload(payload: unknown, frozenJson?: string) {
  const json = frozenJson ?? JSON.stringify(payload);
  if (!json || json.length > 65_536) throw new AutomationContextError("input_unavailable");
  return json;
}
