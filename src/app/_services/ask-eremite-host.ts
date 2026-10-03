import 'server-only';

import { z } from 'zod';
import { getContentForAI, getFileAssetForViewing } from '@/modules/inbox/service';
import { listAcceptedFileConversionsForSource } from '@/modules/automations/tools/file-converter/authority';
import { inferFileConverterSource } from '@/modules/automations/tools/file-converter/server-tool';
import { getProjectForAI, ProjectError } from '@/modules/projects/service';
import { ActionContextError, getAction, listActionsForAI, listProjectActionsForAI } from '@/modules/actions/service';
import { searchContentForAI } from '@/modules/search/service';
import type { AIChatHost, AIResolvedChatContext, AIContextBuildOptions } from '@/modules/ai/context';
import type { AIContextTarget, AISource } from '@/modules/ai/chat-contracts';
import { AskEremiteActionDraftError, createActionDraftInputSchema, createAskEremiteActionDraft, type CreateActionDraftInput } from '@/app/_services/ask-eremite-action-drafts';
import { proposeActionUpdateInputSchema, proposeAskEremiteActionUpdate, type ProposeActionUpdateInput } from '@/app/_services/ask-eremite-action-updates';
import type { AIDraftWriteToolAdapter, AIReadOnlyToolAdapter, AIUpdateProposalToolAdapter } from '@/modules/ai/tools';
import type { AIToolRunProposalAdapter } from '@/modules/ai/tools';
import { AIToolExecutionError } from '@/modules/ai/tools';
import { proposeAskEremiteToolRun, proposeToolRunInputSchema, AskEremiteToolRunError } from '@/app/_services/ask-eremite-tool-runs';

const idSchema = z.string().uuid();
const querySchema = z.string().trim().min(1).max(500);

export class AskEremiteContextError extends Error {
  constructor() { super('ai_context_unavailable'); }
}

export function createAskEremiteHost(): AIChatHost {
  const budget = { remaining: 24_000, executions: 20, draftWrites: 3, updateProposals: 3 };
  const adapters: readonly AIReadOnlyToolAdapter<any, unknown>[] = [searchContent, getContent, getProject, listProjectActions];
  return Object.freeze({
    async resolveContext(target: AIContextTarget, options?: AIContextBuildOptions) {
      const result = await resolveContext(target, options);
      const localNow = new Date();
      const prompt = `Host local date: ${localNow.toLocaleDateString('sv-SE')} (${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(localNow)}).\n${result.prompt}`;
      budget.remaining = Math.max(0, budget.remaining - prompt.length);
      return { ...result, prompt };
    },
    tools: Object.freeze([...adapters.map(adapter => budgeted(adapter, budget)), budgetedDraftWrite(createActionDraft, budget), budgetedUpdateProposal(proposeActionUpdate, budget), budgetedToolRunProposal(proposeToolRun, budget)]),
  });
}

async function resolveContext(target: AIContextTarget, options: AIContextBuildOptions = {}): Promise<AIResolvedChatContext> {
  options.abortSignal?.throwIfAborted();
  if (target.kind === 'global') return { target, prompt: 'Current Eremite page context: global.', sources: [] };
  if (target.kind === 'content') {
    const item = await getContent.execute({ id: target.id }, options);
    return { target, prompt: `Current Eremite Content:\n${boundedJSON(item.data, 14_000)}`, sources: item.sources };
  }
  if (target.kind === 'project') {
    const item = await getProject.execute({ id: target.id }, options);
    return { target, prompt: `Current Eremite Project:\n${boundedJSON(item.data, 4_000)}`, sources: item.sources };
  }
  if (target.id) {
    options.abortSignal?.throwIfAborted();
    const action = getAction(target.id);
    if (!action || action.trashed_at || target.projectId && action.project_id !== target.projectId) throw new AskEremiteContextError();
    const source = actionSource(action);
    return { target, prompt: `Current Eremite Action:\n${boundedJSON({ id: action.id, title: action.title, status: action.status, priority: action.priority, dueDate: action.due_date, projectId: action.project_id, revision: action.revision }, 4_000)}`, sources: [source] };
  }
  if (target.projectId && !getProjectForAI(target.projectId)) throw new AskEremiteContextError();
  const actions = listActionsForAI(20, target.projectId);
  return { target, prompt: `Current Eremite ${target.projectId ? 'Project' : ''} Actions page (up to 20 active Actions):\n${boundedJSON(actions.map(action => ({ id: action.id, title: action.title, priority: action.priority, dueDate: action.due_date, projectId: action.project_id, revision: action.revision })), 8_000)}`, sources: actions.map(actionSource) };
}

const searchContent: AIReadOnlyToolAdapter<{ query: string; limit?: number }, unknown> = {
  access: 'read',
  definition: { name: 'search_content', description: 'Search Eremite Content by title and indexed metadata. Returns at most 10 compact matches.', inputSchema: z.object({ query: querySchema, limit: z.number().int().min(1).max(10).optional() }).strict() },
  async execute(input, context) {
    context?.abortSignal?.throwIfAborted();
    const parsed = this.definition.inputSchema.parse(input);
    const matches = searchContentForAI(parsed.query, Math.min(parsed.limit ?? 10, 10));
    const data = matches.map(result => ({ id: result.id.slice('content:'.length), title: result.title.slice(0, 240), meta: result.meta.slice(0, 300), projectId: result.projectId, folderId: result.folderId, revision: result.revision }));
    return { data, sources: data.map(contentSource) };
  },
};

const getContent: AIReadOnlyToolAdapter<{ id: string }, unknown> = {
  access: 'read',
  definition: { name: 'get_content', description: 'Read one available Eremite Content item. Text is bounded; binary bytes are never provided. For convertible files, returns exact Host-approved availableFileConversions IDs and target formats; use these IDs when proposing conversion.', inputSchema: z.object({ id: idSchema }).strict() },
  async execute(input, context) {
    context?.abortSignal?.throwIfAborted();
    const parsed = this.definition.inputSchema.parse(input);
    const item = await getContentForAI(parsed.id);
    context?.abortSignal?.throwIfAborted();
    if (!item) throw new AskEremiteContextError();
    const asset = item.kind === 'file' && item.fileVersionId ? getFileAssetForViewing(item.id, item.fileVersionId) : null;
    const sourceFormat = asset ? inferFileConverterSource(asset.originalName, asset.declaredMimeType) : null;
    const availableFileConversions = sourceFormat ? listAcceptedFileConversionsForSource(sourceFormat).slice(0, 18).map(conversion => ({
      id: conversion.id, target: conversion.target, profiles: [...conversion.profiles], defaultProfile: conversion.defaultProfile,
    })) : [];
    const { text, ...summary } = item;
    return { data: item.kind === 'file' ? { ...summary, availableFileConversions, ...(text ? { text } : {}) } : item, sources: [contentSource(item)] };
  },
};

const getProject: AIReadOnlyToolAdapter<{ id: string }, unknown> = {
  access: 'read',
  definition: { name: 'get_project', description: 'Read one available Eremite Project summary.', inputSchema: z.object({ id: idSchema }).strict() },
  async execute(input, context) {
    context?.abortSignal?.throwIfAborted();
    const parsed = this.definition.inputSchema.parse(input);
    const project = getProjectForAI(parsed.id);
    if (!project) throw new AskEremiteContextError();
    return { data: { id: project.id, name: project.name, description: project.description.slice(0, 2_000), revision: project.revision, archived: Boolean(project.archived_at) }, sources: [projectSource(project)] };
  },
};

const listProjectActions: AIReadOnlyToolAdapter<{ projectId: string; limit?: number }, unknown> = {
  access: 'read',
  definition: { name: 'list_project_actions', description: 'List up to 20 live Actions in one available Eremite Project.', inputSchema: z.object({ projectId: idSchema, limit: z.number().int().min(1).max(20).optional() }).strict() },
  async execute(input, context) {
    context?.abortSignal?.throwIfAborted();
    const parsed = this.definition.inputSchema.parse(input);
    if (!getProjectForAI(parsed.projectId)) throw new AskEremiteContextError();
    const actions = listProjectActionsForAI(parsed.projectId, parsed.limit ?? 20);
    return { data: actions.map(action => ({ id: action.id, title: action.title.slice(0, 240), status: action.status, priority: action.priority, dueDate: action.due_date, revision: action.revision })), sources: actions.map(action => actionSource({ ...action, project_id: parsed.projectId })) };
  },
};

const createActionDraft: AIDraftWriteToolAdapter<CreateActionDraftInput, ReturnType<typeof createAskEremiteActionDraft>> = {
  access: 'draft-write',
  definition: {
    name: 'create_action_draft',
    description: 'Create exactly one pending Action Draft for one explicit user-requested task. Copy the complete task title from the latest user message into title; do not abbreviate it or take a title from Project context. Put priority and due date in their own fields. For current Content, omit projectId and contentItemIds because the Host links the current Content and infers its Project. Other IDs must first be observed through the matching read Tool. Call once, inspect the structured result, and say it remains a Draft until the user confirms it. If the Tool fails, say no Draft was created.',
    inputSchema: createActionDraftInputSchema,
    strict: true,
  },
  async execute(input, context) {
    try {
      const draft = createAskEremiteActionDraft(input, context);
      return { data: { ...draft, outcome: 'draft_created' as const, requiresConfirmation: true }, sources: [] };
    } catch (error) {
      if (context.abortSignal?.aborted) throw error;
      if (error instanceof z.ZodError) throw new AIToolExecutionError('ai_tool_invalid_arguments');
      if (error instanceof AskEremiteActionDraftError) {
        if (error.reason === 'unobserved_content') throw new AIToolExecutionError('ai_tool_unobserved_content');
        if (error.reason === 'unobserved_project') throw new AIToolExecutionError('ai_tool_unobserved_project');
        throw new AIToolExecutionError('ai_tool_host_rejected');
      }
      if (error instanceof ActionContextError || error instanceof ProjectError) throw new AIToolExecutionError('ai_tool_host_rejected');
      throw new AIToolExecutionError('ai_tool_execution_failed');
    }
  },
};

const proposeToolRun: AIToolRunProposalAdapter<z.infer<typeof proposeToolRunInputSchema>, Awaited<ReturnType<typeof proposeAskEremiteToolRun>>> = {
  access: 'tool-run-proposal',
  definition: { name: 'propose_tool_run', description: 'For an explicit supported file conversion or PDF operation request with sufficient Host observation, MUST call this tool to create one pending proposal; do not merely answer in text. For File Converter, conversionId MUST be an exact availableFileConversions id from get_content or current Content context; NEVER guess one. After search_content, call get_content first for current revision, file version and capabilities, then propose in this AI run. Only an actual tool error means the Host rejected the proposal. A proposal does not execute; never claim completion before user confirmation and a completed real Run.', inputSchema: proposeToolRunInputSchema, strict: true },
  async execute(input, context) {
    try { return { data: await proposeAskEremiteToolRun(input, context), sources: [] }; }
    catch (error) {
      if (context.abortSignal?.aborted) throw error;
      if (error instanceof z.ZodError) throw new AIToolExecutionError('ai_tool_invalid_arguments');
      if (error instanceof AskEremiteToolRunError) {
        const diagnostic = ({
          ai_tool_run_unobserved_source: 'ai_tool_run_unobserved_source',
          ai_tool_run_source_unavailable: 'ai_tool_run_source_unavailable',
          ai_tool_run_unsupported_capability: 'ai_tool_run_unsupported_capability',
          ai_tool_run_invalid_parameters: 'ai_tool_run_invalid_parameters',
          ai_tool_run_unavailable: 'ai_tool_run_unavailable',
        } as const)[error.code as 'ai_tool_run_unobserved_source' | 'ai_tool_run_source_unavailable' | 'ai_tool_run_unsupported_capability' | 'ai_tool_run_invalid_parameters' | 'ai_tool_run_unavailable'];
        throw new AIToolExecutionError(error.code === 'ai_tool_run_internal_failure' ? 'ai_tool_execution_failed' : 'ai_tool_host_rejected', diagnostic);
      }
      throw new AIToolExecutionError('ai_tool_execution_failed');
    }
  },
};

const proposeActionUpdate: AIUpdateProposalToolAdapter<ProposeActionUpdateInput, ReturnType<typeof proposeAskEremiteActionUpdate>> = {
  access: 'update-proposal',
  definition: { name: 'propose_action_update', description: 'Propose a change to an observed active Action. This only creates a pending proposal; the user must click Apply. For a natural-language target, pass targetName exactly as the user named the EXISTING Action, not a guessed ID. The Host resolves all matching targets. If ambiguous it returns needs_disambiguation and stops this run so the user can pick in the UI; do not retry. Use actionId only for an explicitly selected observed Action or a user-specified unambiguous ID. Provide only changed fields or a done/cancelled transition. For a rename, title is the new title; ordinary surrounding quotation or book-title marks delimit the value and are removed unless preserveTitleQuotes=true because the user explicitly wants them stored. Internal punctuation is preserved. Never claim the Action has changed yet.', inputSchema: proposeActionUpdateInputSchema, strict: true },
  async execute(input, context) { return { data: proposeAskEremiteActionUpdate(input, context), sources: [] }; },
};

function contentSource(item: { id: string; title: string; revision?: number; fileVersionId?: string; projectId?: string | null; folderId?: string | null }): AISource {
  const base = item.projectId ? `/projects/${encodeURIComponent(item.projectId)}${item.folderId ? `/folders/${encodeURIComponent(item.folderId)}` : ''}` : '/inbox';
  return { module: 'inbox', entity: 'content', id: item.id, ...(item.revision === undefined ? {} : { revision: item.revision }), ...(item.fileVersionId ? { fileVersionId: item.fileVersionId } : {}), label: item.title, href: `${base}?selected=${encodeURIComponent(item.id)}` };
}
function projectSource(project: { id: string; name: string; revision: number }): AISource { return { module: 'projects', entity: 'project', id: project.id, revision: project.revision, label: project.name, href: `/projects/${encodeURIComponent(project.id)}` }; }
function actionSource(action: { id: string; title: string; revision: number; project_id?: string | null }): AISource { const base = action.project_id ? `/projects/${encodeURIComponent(action.project_id)}?tab=actions&` : '/actions?'; return { module: 'actions', entity: 'action', id: action.id, revision: action.revision, label: action.title, href: `${base}selected=${encodeURIComponent(action.id)}` }; }
function boundedJSON(value: unknown, maximum: number) { const text = JSON.stringify(value); return text.length <= maximum ? text : `${text.slice(0, maximum)}…`; }

function budgeted<INPUT>(adapter: AIReadOnlyToolAdapter<INPUT, unknown>, budget: { remaining: number; executions: number }): AIReadOnlyToolAdapter<INPUT, unknown> {
  return {
    ...adapter,
    async execute(input, context) {
      if (budget.remaining < 128 || budget.executions <= 0) return { data: { truncated: true, reason: 'context_budget_exhausted' }, sources: [] };
      budget.executions -= 1;
      const result = await adapter.execute(input, context);
      const fitted = fitData(result.data, budget.remaining);
      const serialized = JSON.stringify(fitted);
      budget.remaining = Math.max(0, budget.remaining - serialized.length);
      const ids = new Set(Array.isArray(fitted) ? fitted.flatMap(value => value && typeof value === 'object' && 'id' in value ? [String(value.id)] : []) : fitted && typeof fitted === 'object' && 'id' in fitted ? [String(fitted.id)] : []);
      return { data: fitted, sources: ids.size > 0 ? result.sources.filter(source => ids.has(source.id)) : result.sources.slice(0, fitted && typeof fitted === 'object' && 'truncated' in fitted ? 0 : 50) };
    },
  };
}

function budgetedDraftWrite<INPUT, OUTPUT>(adapter: AIDraftWriteToolAdapter<INPUT, OUTPUT>, budget: { remaining: number; executions: number; draftWrites: number }): AIDraftWriteToolAdapter<INPUT, OUTPUT> {
  const attempts = new Map<string, ReturnType<typeof adapter.execute>>();
  return {
    ...adapter,
    async execute(input, context) {
      if (budget.remaining < 128 || budget.executions <= 0) throw new Error('ai_draft_write_limit');
      budget.executions -= 1;
      const key = JSON.stringify(input, Object.keys(input as object).sort());
      const previous = attempts.get(key);
      if (previous) return previous;
      if (budget.draftWrites <= 0) throw new Error('ai_draft_write_limit');
      budget.draftWrites -= 1;
      const attempt = adapter.execute(input, context);
      attempts.set(key, attempt);
      try {
        const result = await attempt;
        // Retain the resolved promise only after Actions and provenance commit.
        // Concurrent or later identical calls receive the same receipt.
        budget.remaining = Math.max(0, budget.remaining - JSON.stringify(result.data).length);
        return result;
      } catch (error) {
        attempts.delete(key);
        throw error;
      }
    },
  };
}

function budgetedUpdateProposal<INPUT, OUTPUT>(adapter: AIUpdateProposalToolAdapter<INPUT, OUTPUT>, budget: { remaining: number; executions: number; updateProposals: number }): AIUpdateProposalToolAdapter<INPUT, OUTPUT> {
  let previous = Promise.resolve();
  let disambiguation: Awaited<ReturnType<typeof adapter.execute>> | null = null;
  return { ...adapter, async execute(input, context) {
    const turn = previous;
    let release = () => {};
    previous = new Promise<void>(resolve => { release = resolve; });
    await turn;
    try {
      if (disambiguation) return disambiguation;
      if (budget.remaining < 128 || budget.executions <= 0 || budget.updateProposals <= 0) throw new Error('ai_update_proposal_limit');
      budget.executions -= 1;
      budget.updateProposals -= 1;
      const result = await adapter.execute(input, context);
      if (result.data && typeof result.data === 'object' && 'kind' in result.data && result.data.kind === 'needs_disambiguation') disambiguation = result;
      budget.remaining = Math.max(0, budget.remaining - JSON.stringify(result.data).length);
      return result;
    } finally { release(); }
  } };
}

function budgetedToolRunProposal<INPUT, OUTPUT>(adapter: AIToolRunProposalAdapter<INPUT, OUTPUT>, budget: { remaining: number; executions: number }): AIToolRunProposalAdapter<INPUT, OUTPUT> {
  return { ...adapter, async execute(input, context) {
    if (budget.remaining < 128 || budget.executions <= 0) throw new Error('ai_tool_run_limit');
    budget.executions -= 1;
    const result = await adapter.execute(input, context);
    budget.remaining = Math.max(0, budget.remaining - JSON.stringify(result.data).length);
    return result;
  } };
}

function fitData(data: unknown, limit: number): unknown {
  if (JSON.stringify(data).length <= limit) return data;
  if (Array.isArray(data)) {
    const fitted = [];
    for (const item of data) {
      if (JSON.stringify([...fitted, item]).length > limit - 40) break;
      fitted.push(item);
    }
    return fitted;
  }
  if (data && typeof data === 'object' && 'text' in data && typeof data.text === 'string') {
    const base = { ...data, text: '' };
    const available = Math.max(0, limit - JSON.stringify(base).length - 20);
    return { ...base, text: data.text.slice(0, available), truncated: true };
  }
  return { truncated: true, reason: 'context_budget_exhausted' };
}
