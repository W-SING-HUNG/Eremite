import 'server-only';
import { z } from 'zod';
import { getAvailableContentItemSummary, getFileAssetForViewing } from '@/modules/inbox/service';
import { getAutomationRun, executeExternalTool } from '@/modules/automations/service';
import { fileConverterServerTool, inferFileConverterSource } from '@/modules/automations/tools/file-converter/server-tool';
import { pdfToolsServerTool } from '@/modules/automations/tools/pdf-tools/server-tool';
import { getAcceptedFileConversion } from '@/modules/automations/tools/file-converter/authority';
import { getAcceptedPdfToolsCapability } from '@/modules/automations/tools/pdf-tools/authority';
import { FILE_CONVERTER_TOOL_ID, PDF_TOOLS_TOOL_ID, getToolMetadata } from '@/modules/automations/tools/catalog';
import { getFileConverterAvailability } from '@/modules/automations/tools/file-converter/availability';
import { getPdfToolsAvailability } from '@/modules/automations/tools/pdf-tools/availability';
import { getProject, ProjectError } from '@/modules/projects/service';
import { getFolderBreadcrumbs, FolderError } from '@/modules/projects/folders';
import { getAIToolRunProposal, hasAIToolRunProposal, listAIToolRunProposals, recordAIToolRunProposal, resolveAIToolRunProposal, type AIToolRunProposalRow } from '@/modules/ai/tool-run-store';
import { AutomationContextError } from '@/modules/automations/tools/content-to-action-drafts';
import type { AIChatToolExecutionContext } from '@/modules/ai/tools';
import type { AIToolRunProposalArtifact, AIThreadDetail } from '@/modules/ai/chat-contracts';
import { withUnitOfWork } from '@/platform/db/database';

export const AI_NATIVE_TOOL_ALLOWLIST = Object.freeze([FILE_CONVERTER_TOOL_ID, PDF_TOOLS_TOOL_ID] as const);

const identifier = z.string().uuid();
const converterInput = z.object({ kind: z.literal('file_converter'), contentItemId: identifier, conversionId: z.string().min(1).max(96), profile: z.string().min(1).max(40).optional() }).strict();
const pdfInput = z.object({ kind: z.literal('pdf_tools'), operation: z.enum(['pdf.merge', 'pdf.split', 'pdf.extract', 'pdf.rotate', 'pdf.reorder']), contentItemIds: z.array(identifier).min(1).max(32), splitEvery: z.number().int().min(1).max(10000).optional(), pageSelector: z.string().min(1).max(1000).optional(), rotateAngle: z.union([z.literal(90), z.literal(180), z.literal(270)]).optional(), rotateMode: z.enum(['relative', 'absolute']).optional(), pageOrder: z.string().min(1).max(1000).optional() }).strict();
export const proposeToolRunInputSchema = z.discriminatedUnion('kind', [converterInput, pdfInput]);

type ProposalInput = z.infer<typeof proposeToolRunInputSchema>;
type SourceSnapshot = { contentId: string; revision: number; versionId: string; sha256: string; byteSize: number; projectId: string | null; folderId: string | null; title: string; originalName: string };
type StoredInput = { rawInput: Record<string, unknown>; sources: SourceSnapshot[]; destination: { projectId: string | null; folderId: string | null; label: string }; operationLabel: string; parametersLabel: string };
type ProposalKey = { threadId: string; messageId: string; proposalId: string };

export class AskEremiteToolRunError extends Error {
  constructor(public readonly code: 'ai_tool_run_not_found' | 'ai_tool_run_not_pending' | 'ai_tool_run_unobserved_source' | 'ai_tool_run_source_unavailable' | 'ai_tool_run_unsupported_capability' | 'ai_tool_run_invalid_parameters' | 'ai_tool_run_unavailable' | 'ai_tool_run_limit' | 'ai_tool_run_stale_source' | 'ai_tool_run_stale_tool' | 'ai_tool_run_internal_failure') { super(code); }
}

function toolIdFor(kind: ProposalInput['kind']): AIToolRunProposalRow['tool_id'] {
  return kind === 'file_converter' ? FILE_CONVERTER_TOOL_ID : PDF_TOOLS_TOOL_ID;
}

function sourceSnapshot(ids: string[]) {
  return ids.map(contentId => {
    const item = getAvailableContentItemSummary(contentId);
    const asset = item?.kind === 'file' ? getFileAssetForViewing(contentId) : null;
    if (!item || !asset || item.status === 'archived') throw new AskEremiteToolRunError('ai_tool_run_source_unavailable');
    return { contentId, revision: item.revision, versionId: asset.versionId, sha256: asset.sha256, byteSize: asset.byteSize,
      projectId: item.project_id, folderId: item.folder_id, title: item.title, originalName: asset.originalName } satisfies SourceSnapshot;
  });
}

function rawInputFor(input: ProposalInput): Record<string, unknown> {
  if (input.kind === 'file_converter') return { contentItemId: input.contentItemId, conversionId: input.conversionId, ...(input.profile ? { profile: input.profile } : {}) };
  const { kind: _kind, ...raw } = input;
  return raw;
}

function assertPdfShape(input: ProposalInput) {
  if (input.kind !== 'pdf_tools') return;
  const parameters = ['splitEvery', 'pageSelector', 'rotateAngle', 'rotateMode', 'pageOrder'] as const;
  const allowed = input.operation === 'pdf.split' ? ['splitEvery'] : input.operation === 'pdf.extract' ? ['pageSelector']
    : input.operation === 'pdf.rotate' ? ['pageSelector', 'rotateAngle', 'rotateMode'] : input.operation === 'pdf.reorder' ? ['pageOrder'] : [];
  if (parameters.some(key => (input[key] !== undefined) !== allowed.includes(key))) throw new AskEremiteToolRunError('ai_tool_run_invalid_parameters');
}

function idsFor(input: ProposalInput) { return input.kind === 'file_converter' ? [input.contentItemId] : input.contentItemIds; }

function validatedToolInput(toolId: AIToolRunProposalRow['tool_id'], rawInput: Record<string, unknown>, projectId: string | null) {
  return toolId === FILE_CONVERTER_TOOL_ID
    ? fileConverterServerTool.validateInput(rawInput, { projectId })
    : pdfToolsServerTool.validateInput(rawInput, { projectId });
}

function destinationFor(validated: ReturnType<typeof validatedToolInput>) {
  const projectId = validated.projectId;
  const folderId = validated.folderId;
  const projectName = projectId ? getProject(projectId)?.name ?? '来源专案' : null;
  const folderPath = folderId ? getFolderBreadcrumbs(folderId).map(folder => folder.name).join(' / ') : null;
  return { projectId, folderId, label: projectName ? folderPath ? `${projectName} / ${folderPath}` : `${projectName} / 根目录` : '未归入专案' };
}

function storedInput(input: ProposalInput, sources: SourceSnapshot[]): StoredInput {
  const toolId = toolIdFor(input.kind);
  const rawInput = rawInputFor(input);
  const validated = validatedToolInput(toolId, rawInput, sources[0]!.projectId);
  const destination = destinationFor(validated);
  // Persist the Host-resolved default, never a model-specified destination.
  rawInput.folderId = destination.folderId;
  if (input.kind === 'file_converter') {
    const conversion = validated as ReturnType<typeof fileConverterServerTool.validateInput>;
    rawInput.profile = conversion.profile;
    return { rawInput, sources, destination, operationLabel: `转换为 ${conversion.conversionId.split('-to-').at(-1)?.toUpperCase() ?? '目标格式'}`, parametersLabel: `转换方式：${conversion.profile}` };
  }
  const pdf = validated as ReturnType<typeof pdfToolsServerTool.validateInput>;
  const labels: Record<string, string> = { 'pdf.merge': '合并 PDF', 'pdf.split': '拆分 PDF', 'pdf.extract': '提取页面', 'pdf.rotate': '旋转页面', 'pdf.reorder': '重排页面' };
  const parametersLabel = input.operation === 'pdf.extract' ? `页码：${input.pageSelector}`
    : input.operation === 'pdf.rotate' ? `页码：${input.pageSelector}；角度：${input.rotateAngle}°；方式：${input.rotateMode === 'absolute' ? '绝对' : '相对'}`
      : input.operation === 'pdf.reorder' ? `页面顺序：${input.pageOrder}` : input.operation === 'pdf.split' ? `每份 ${input.splitEvery} 页` : '按所列顺序合并';
  return { rawInput, sources, destination, operationLabel: labels[pdf.operation], parametersLabel };
}

function assertSnapshot(expected: StoredInput, toolId: AIToolRunProposalRow['tool_id']) {
  let current: SourceSnapshot[];
  try { current = sourceSnapshot(expected.sources.map(source => source.contentId)); }
  catch (error) { if (error instanceof AskEremiteToolRunError && error.code === 'ai_tool_run_source_unavailable') throw new AskEremiteToolRunError('ai_tool_run_stale_source'); throw error; }
  if (JSON.stringify(current) !== JSON.stringify(expected.sources)) throw new AskEremiteToolRunError('ai_tool_run_stale_source');
  try {
    const validated = validatedToolInput(toolId, expected.rawInput, expected.destination.projectId);
    const destination = destinationFor(validated);
    if (destination.projectId !== expected.destination.projectId || destination.folderId !== expected.destination.folderId || destination.label !== expected.destination.label) throw new AskEremiteToolRunError('ai_tool_run_stale_tool');
  } catch (error) {
    if (error instanceof AskEremiteToolRunError) throw error;
    if (error instanceof AutomationContextError || error instanceof ProjectError || error instanceof FolderError) throw new AskEremiteToolRunError('ai_tool_run_stale_tool');
    throw new AskEremiteToolRunError('ai_tool_run_internal_failure');
  }
}

function parseStored(row: AIToolRunProposalRow): StoredInput { return JSON.parse(row.input_json) as StoredInput; }

export function assertAskToolAvailable(available: boolean, atConfirmation = false) {
  if (!available) throw new AskEremiteToolRunError(atConfirmation ? 'ai_tool_run_stale_tool' : 'ai_tool_run_unavailable');
}

export async function proposeAskEremiteToolRun(input: unknown, context: AIChatToolExecutionContext): Promise<AIToolRunProposalArtifact> {
  context.abortSignal?.throwIfAborted();
  if (input && typeof input === 'object' && 'kind' in input && input.kind === 'pdf_tools' && 'operation' in input
    && typeof input.operation === 'string' && !getAcceptedPdfToolsCapability(input.operation)) throw new AskEremiteToolRunError('ai_tool_run_unsupported_capability');
  const parsed = proposeToolRunInputSchema.parse(input);
  assertPdfShape(parsed);
  const ids = idsFor(parsed);
  const observed = context.observedSources.filter(source => source.module === 'inbox' && source.entity === 'content'
    && Number.isSafeInteger(source.revision) && typeof source.fileVersionId === 'string');
  if (ids.some(id => !observed.some(source => source.id === id))) throw new AskEremiteToolRunError('ai_tool_run_unobserved_source');
  try { if (hasAIToolRunProposal(context.identity.runId)) throw new AskEremiteToolRunError('ai_tool_run_limit'); }
  catch (error) { if (error instanceof AskEremiteToolRunError) throw error; throw new AskEremiteToolRunError('ai_tool_run_internal_failure'); }
  const toolId = toolIdFor(parsed.kind);
  if (!AI_NATIVE_TOOL_ALLOWLIST.includes(toolId)) throw new AskEremiteToolRunError('ai_tool_run_unsupported_capability');
  let availability: Awaited<ReturnType<typeof getFileConverterAvailability>> | Awaited<ReturnType<typeof getPdfToolsAvailability>>;
  try { availability = parsed.kind === 'file_converter' ? await getFileConverterAvailability() : await getPdfToolsAvailability(); }
  catch { throw new AskEremiteToolRunError('ai_tool_run_internal_failure'); }
  assertAskToolAvailable(availability.available);
  context.abortSignal?.throwIfAborted();
  try {
    return withUnitOfWork(uow => {
      const sources = sourceSnapshot(ids);
      if (sources.some(source => !observed.some(evidence => evidence.id === source.contentId
        && evidence.revision === source.revision && evidence.fileVersionId === source.versionId))) {
        throw new AskEremiteToolRunError('ai_tool_run_unobserved_source');
      }
      if (parsed.kind === 'file_converter') {
        const sourceFormat = inferFileConverterSource(sources[0]!.originalName, getFileAssetForViewing(sources[0]!.contentId)!.declaredMimeType);
        const capability = getAcceptedFileConversion(parsed.conversionId);
        if (!sourceFormat || !capability || capability.source !== sourceFormat) throw new AskEremiteToolRunError('ai_tool_run_unsupported_capability');
      } else if (!getAcceptedPdfToolsCapability(parsed.operation) || sources.some(source => !source.originalName.toLowerCase().endsWith('.pdf') && getFileAssetForViewing(source.contentId)?.declaredMimeType.toLowerCase().split(';', 1)[0] !== 'application/pdf')) {
        throw new AskEremiteToolRunError('ai_tool_run_unsupported_capability');
      }
      const stored = storedInput(parsed, sources);
      const inputJson = JSON.stringify(stored);
      if (inputJson.length > 32768) throw new AskEremiteToolRunError('ai_tool_run_invalid_parameters');
      const metadata = getToolMetadata(toolId);
      if (!metadata) throw new AskEremiteToolRunError('ai_tool_run_unavailable');
      const proposalId = recordAIToolRunProposal(uow, { ...context.identity, toolId, toolVersion: metadata.version, inputJson });
      const row = getAIToolRunProposal({ threadId: context.identity.threadId, messageId: context.identity.messageId, proposalId })!;
      return toArtifact(row);
    });
  } catch (error) {
    if (error instanceof AskEremiteToolRunError) throw error;
    if (error instanceof AutomationContextError && (error.code === 'input_unavailable' || error.code === 'project_mismatch')) throw new AskEremiteToolRunError('ai_tool_run_invalid_parameters');
    throw new AskEremiteToolRunError('ai_tool_run_internal_failure');
  }
}

export async function confirmAskEremiteToolRun(input: ProposalKey) {
  let row: AIToolRunProposalRow | undefined;
  try { row = getAIToolRunProposal(input); }
  catch { throw new AskEremiteToolRunError('ai_tool_run_internal_failure'); }
  if (!row) throw new AskEremiteToolRunError('ai_tool_run_not_found');
  if (row.lifecycle === 'accepted' && row.automation_run_id) return { proposalId: row.id, runId: row.automation_run_id, reused: true };
  if (row.lifecycle !== 'pending') throw new AskEremiteToolRunError('ai_tool_run_not_pending');
  try {
    if (!AI_NATIVE_TOOL_ALLOWLIST.includes(row.tool_id) || getToolMetadata(row.tool_id)?.version !== row.tool_version) throw new AskEremiteToolRunError('ai_tool_run_stale_tool');
    const available = row.tool_id === FILE_CONVERTER_TOOL_ID ? await getFileConverterAvailability(true) : await getPdfToolsAvailability(true);
    assertAskToolAvailable(available.available, true);
    const stored = parseStored(row);
    assertSnapshot(stored, row.tool_id);
    const result = await executeExternalTool({ operationId: row.operation_id, toolId: row.tool_id, rawInput: stored.rawInput, projectId: stored.destination.projectId }, {
      onExisting(runId) {
        const current = getAIToolRunProposal(input);
        if (current?.lifecycle !== 'accepted' || current.automation_run_id !== runId) throw new AskEremiteToolRunError('ai_tool_run_not_pending');
      },
      onAccepted(runId) {
        const fresh = getAIToolRunProposal(input);
        if (!fresh || fresh.lifecycle !== 'pending') throw new AskEremiteToolRunError('ai_tool_run_not_pending');
        assertSnapshot(stored, row.tool_id);
        withUnitOfWork(uow => {
          if (!resolveAIToolRunProposal(uow, row.id, 'accepted', runId)) throw new AskEremiteToolRunError('ai_tool_run_not_pending');
        });
      },
    });
    return { proposalId: row.id, runId: result.runId, reused: result.reused };
  } catch (error) {
    let latest: AIToolRunProposalRow | undefined;
    try { latest = getAIToolRunProposal(input); }
    catch { throw new AskEremiteToolRunError('ai_tool_run_internal_failure'); }
    if (latest?.lifecycle === 'accepted' && latest.automation_run_id) return { proposalId: row.id, runId: latest.automation_run_id, reused: true };
    if (error instanceof AskEremiteToolRunError && error.code === 'ai_tool_run_not_pending') throw error;
    if (error instanceof AutomationContextError) {
      try { assertSnapshot(parseStored(row), row.tool_id); }
      catch (recheck) { if (recheck instanceof AskEremiteToolRunError) error = recheck; }
    }
    if (error instanceof AskEremiteToolRunError && (error.code === 'ai_tool_run_stale_source' || error.code === 'ai_tool_run_stale_tool')) {
      withUnitOfWork(uow => resolveAIToolRunProposal(uow, row.id, 'stale'));
      throw error;
    }
    throw new AskEremiteToolRunError('ai_tool_run_internal_failure');
  }
}

export function rejectAskEremiteToolRun(input: ProposalKey) {
  try {
    return withUnitOfWork(uow => {
      const row = getAIToolRunProposal(input);
      if (!row) throw new AskEremiteToolRunError('ai_tool_run_not_found');
      if (row.lifecycle === 'rejected') return { proposalId: row.id, lifecycle: 'rejected' as const };
      if (row.lifecycle !== 'pending' || !resolveAIToolRunProposal(uow, row.id, 'rejected')) throw new AskEremiteToolRunError('ai_tool_run_not_pending');
      return { proposalId: row.id, lifecycle: 'rejected' as const };
    });
  } catch (error) {
    if (error instanceof AskEremiteToolRunError) throw error;
    throw new AskEremiteToolRunError('ai_tool_run_internal_failure');
  }
}

export function attachToolRunProposals(detail: AIThreadDetail): AIThreadDetail {
  const rows = listAIToolRunProposals(detail.messages.map(message => message.id));
  return { ...detail, messages: detail.messages.map(message => ({ ...message,
    toolRunProposals: rows.filter(row => row.message_id === message.id).map(toArtifact),
  })) };
}

function toArtifact(row: AIToolRunProposalRow): AIToolRunProposalArtifact {
  const stored = parseStored(row);
  const run = row.automation_run_id ? getAutomationRun(row.automation_run_id) : undefined;
  let outputs: Array<{ contentId: string; originalName: string; previewable: boolean }> = [];
  if (run?.status === 'completed' && run.output_payload_json) {
    try {
      const payload = JSON.parse(run.output_payload_json);
      const candidates = row.tool_id === FILE_CONVERTER_TOOL_ID ? [payload] : payload.outputs;
      if (Array.isArray(candidates)) outputs = candidates.filter(value => typeof value?.contentId === 'string' && typeof value?.originalName === 'string').map(value => ({ contentId: value.contentId, originalName: value.originalName, previewable: row.tool_id === PDF_TOOLS_TOOL_ID || value.previewable === true }));
    } catch { /* A damaged payload never becomes a success link. */ }
  }
  return { id: row.id, toolId: row.tool_id, toolName: row.tool_id === FILE_CONVERTER_TOOL_ID ? '文件格式转换器' : 'PDF 工具',
    lifecycle: row.lifecycle, sources: stored.sources.map(source => ({ contentId: source.contentId, title: source.title, originalName: source.originalName })),
    operationLabel: stored.operationLabel, parametersLabel: stored.parametersLabel, destinationLabel: stored.destination.label,
    run: run ? { id: run.id, status: run.status, errorMessage: run.status === 'failed' ? run.error_message : null, outputs } : null };
}
