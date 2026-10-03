import { createDraftActionsBatch, listContentItemIdsWithActions, type DraftActionBatchResult } from "@/modules/actions/service";
import { getAvailableContentItemSummary, getFileAssetForViewing, listContentPickerPage } from "@/modules/inbox/service";
import { assertProjectAcceptsMembers, getProject } from "@/modules/projects/service";
import { assertUnitOfWork, run, withUnitOfWork, type UnitOfWork } from "@/platform/db/database";
import { CONTENT_TO_ACTION_DRAFTS_TOOL_ID } from "@/modules/automations/tools/catalog";

export type DraftToolInput = {
  contentItemIds: string[];
  projectId: string | null;
  items: Array<{
    id: string;
    title: string;
    kind: "file" | "link";
    projectId: string | null;
    file: ReturnType<typeof getFileAssetForViewing>;
  }>;
};

export type DraftToolOutput = DraftActionBatchResult;

export class AutomationContextError extends Error {
  constructor(public readonly code: "no_inputs" | "input_unavailable" | "mixed_projects" | "project_mismatch" | "unknown_tool" | "idempotency_conflict") {
    super(code);
    this.name = "AutomationContextError";
  }
}

export const contentToActionDraftsServerTool = {
  toolId: CONTENT_TO_ACTION_DRAFTS_TOOL_ID,
  executionPolicy: { mode: "request" as const, staleAfterMs: 15 * 60 * 1000 },
  validateInput(raw: unknown, context: { projectId?: string | null }): DraftToolInput {
    const record = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const uniqueIds = [...new Set(Array.isArray(record.contentItemIds) ? record.contentItemIds.map(String).filter(Boolean) : [])];
    if (uniqueIds.length === 0) throw new AutomationContextError("no_inputs");
    const summaries = uniqueIds.map((id) => getAvailableContentItemSummary(id));
    if (summaries.some((item) => !item || item.status === "archived")) throw new AutomationContextError("input_unavailable");
    const available = summaries as Array<NonNullable<(typeof summaries)[number]>>;
    const inferredProjects = new Set(available.map((item) => item.project_id ?? ""));
    if (inferredProjects.size !== 1) throw new AutomationContextError("mixed_projects");
    const inferredProjectId = [...inferredProjects][0] || null;
    const projectId = context.projectId === undefined ? inferredProjectId : context.projectId;
    if (available.some((item) => item.project_id !== projectId)) throw new AutomationContextError("project_mismatch");
    assertProjectAcceptsMembers(projectId);
    return {
      contentItemIds: uniqueIds,
      projectId,
      items: available.map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        projectId: item.project_id,
        file: item.kind === "file" ? getFileAssetForViewing(item.id) : undefined,
      })),
    };
  },
  encodeInputPayload(input: DraftToolInput) {
    return { contentItemIds: input.contentItemIds };
  },
  decodeInputPayload(payload: unknown, _runVersion: number) {
    const value = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
    return { contentItemIds: Array.isArray(value.contentItemIds) ? value.contentItemIds.map(String) : [] };
  },
  summarizeInput(input: DraftToolInput) {
    return `已选择 ${input.items.length} 条资料`;
  },
  captureInputSnapshot(runId: string, input: DraftToolInput) {
    input.items.forEach((item, ordinal) => {
      run(
        `INSERT INTO automation_run_inputs (
           run_id, ordinal, content_id, content_title_snapshot, file_version_id,
           file_name_snapshot, file_sha256_snapshot, file_byte_size_snapshot
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        runId, ordinal, item.id, item.title, item.file?.versionId ?? null,
        item.file?.originalName ?? null, item.file?.sha256 ?? null, item.file?.byteSize ?? null,
      );
    });
  },
  execute(input: DraftToolInput, persist: (uow: UnitOfWork, output: DraftToolOutput) => void) {
    return withUnitOfWork((uow) => {
      const output = createDraftActionsBatch(uow, {
        projectId: input.projectId,
        items: input.items.map((item) => ({ contentItemId: item.id, title: item.title })),
      });
      persist(uow, output);
      return output;
    });
  },
  encodeOutputPayload(output: DraftToolOutput) {
    return { created: output.created.length, skipped: output.skipped.length };
  },
  decodeOutputPayload(payload: unknown, _runVersion: number) {
    const value = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
    return { created: Number(value.created ?? 0), skipped: Number(value.skipped ?? 0) };
  },
  summarizeOutput(output: DraftToolOutput) {
    return `创建 ${output.created.length} 个草稿；跳过 ${output.skipped.length} 条已有行动的资料。`;
  },
  captureOutputSnapshot(uow: UnitOfWork, runId: string, output: DraftToolOutput) {
    assertUnitOfWork(uow);
    output.created.forEach((item, ordinal) => {
      run(
        "INSERT INTO automation_run_outputs (run_id, ordinal, action_id, action_title_snapshot) VALUES (?, ?, ?, ?)",
        runId, ordinal, item.actionId, item.title,
      );
    });
  },
  mapError(_error: unknown) {
    return { code: "execution_failed", message: "生成行动草稿时发生错误，未创建任何新草稿。" };
  },
  listInputOptions(input: { query?: string; cursor?: string; limit?: number; projectId?: string | null; constrainProject?: boolean }) {
    const page = listContentPickerPage(input);
    const blocked = new Set(listContentItemIdsWithActions(page.items.map((item) => item.id)));
    return {
      items: page.items.filter((item) => !blocked.has(item.id)).map((item) => ({
        ...item,
        project_name: item.project_id ? getProject(item.project_id)?.name ?? "已归入专案" : null,
      })),
      nextCursor: page.nextCursor,
    };
  },
};
