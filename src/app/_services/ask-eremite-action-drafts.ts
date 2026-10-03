import 'server-only';

import { z } from 'zod';
import { acceptDraftAction, createDraftAction, getActionDraftArtifact, rejectDraftAction } from '@/modules/actions/service';
import { getContentItemSummary } from '@/modules/inbox/service';
import { getProject } from '@/modules/projects/service';
import {
  getAIActionDraftRelation,
  getAIThread,
  listAIMessageActionDraftRelations,
  recordAIActionDraft,
} from '@/modules/ai/chat-store';
import type { AIActionDraftArtifact, AIContextTarget, AISource, AIThreadDetail } from '@/modules/ai/chat-contracts';
import type { AIChatToolExecutionContext } from '@/modules/ai/tools';
import { attachToolRunProposals } from '@/app/_services/ask-eremite-tool-runs';
import { transaction, withUnitOfWork } from '@/platform/db/database';
import { attachActionDisambiguations, attachActionUpdateProposals } from '@/app/_services/ask-eremite-action-updates';

const identifier = z.string().uuid();

export const createActionDraftInputSchema = z.object({
  title: z.string().min(1).max(240).regex(/^[\s\S]*\S[\s\S]*$/u).describe('Required full task title from the latest user request. Preserve every meaningful word, CJK character, space, and version number. Exclude only separate priority and due-date clauses. Never shorten a longer requested title to one letter, an initial, or a version prefix.'),
  priority: z.enum(['low', 'normal', 'high']).describe('Required priority: low, normal, or high.'),
  dueDate: z.string().trim().min(1).max(10).optional().describe('Optional YYYY-MM-DD due date. Omit when the user did not specify a date.'),
  projectId: identifier.optional().describe('Optional observed Project ID. Omit for a current Content item; the Host infers its Project. Only supply an ID returned by get_project or from the current Project context.'),
  contentItemIds: z.array(identifier).max(10).optional().describe('Optional observed Content IDs, at most 10. Omit for the current Content item; the Host links it automatically. Other IDs must come from search_content or get_content.'),
}).strict();

export type CreateActionDraftInput = z.infer<typeof createActionDraftInputSchema>;

export class AskEremiteActionDraftError extends Error {
  constructor(public readonly code: 'ai_action_draft_not_found' | 'ai_action_draft_not_pending' | 'ai_action_draft_not_allowed',
    public readonly reason?: 'unobserved_content' | 'unobserved_project') {
    super(code);
    this.name = 'AskEremiteActionDraftError';
  }
}

export function createAskEremiteActionDraft(input: unknown, context: AIChatToolExecutionContext) {
  context.abortSignal?.throwIfAborted();
  const parsed = createActionDraftInputSchema.parse(input);
  const normalized = { ...parsed, title: parsed.title.normalize('NFKC').trim().replace(/\s+/gu, ' '), contentItemIds: parsed.contentItemIds ? [...new Set(parsed.contentItemIds)] : undefined };
  const resolved = applyContextDefaults(normalized, context.currentContext);
  assertObservedIds(resolved, context.currentContext, context.observedSources);
  context.abortSignal?.throwIfAborted();
  return withUnitOfWork((uow) => {
    const draft = createDraftAction(uow, resolved);
    recordAIActionDraft(uow, {
      ...context.identity,
      actionId: draft.actionId,
      actionRevision: draft.revision,
    });
    return draft;
  });
}

export function getAskEremiteThread(id: string, before = Number.MAX_SAFE_INTEGER): AIThreadDetail {
  const detail = getAIThread(id, before);
  const relations = listAIMessageActionDraftRelations(detail.messages.map((message) => message.id));
  return attachToolRunProposals(attachActionDisambiguations(attachActionUpdateProposals({
    ...detail,
    messages: detail.messages.map((message) => ({
      ...message,
      actionDrafts: relations.filter((relation) => relation.message_id === message.id).map((relation) => toArtifact(relation)),
    })),
  })));
}

export function confirmAskEremiteActionDraft(input: DraftCommandInput) {
  return transaction(() => {
    requireRelation(input);
    const action = requirePendingDraft(input.actionId, input.expectedRevision);
    return { actionId: action.id, revision: acceptDraftAction(action.id, input.expectedRevision), lifecycle: 'confirmed' as const };
  });
}

export function rejectAskEremiteActionDraft(input: DraftCommandInput) {
  return transaction(() => {
    requireRelation(input);
    const action = requirePendingDraft(input.actionId, input.expectedRevision);
    return { actionId: action.id, revision: rejectDraftAction(action.id, input.expectedRevision), lifecycle: 'rejected' as const };
  });
}

type DraftCommandInput = { threadId: string; messageId: string; actionId: string; expectedRevision: number };

function requireRelation(input: DraftCommandInput) {
  const relation = getAIActionDraftRelation(input);
  if (!relation) throw new AskEremiteActionDraftError('ai_action_draft_not_found');
  return relation;
}

function requirePendingDraft(actionId: string, expectedRevision: number) {
  const action = getActionDraftArtifact(actionId);
  if (!action || action.trashed_at || action.status !== 'draft') throw new AskEremiteActionDraftError('ai_action_draft_not_pending');
  if (action.revision !== expectedRevision) throw new Error('action_revision_conflict');
  return action;
}

function applyContextDefaults(input: CreateActionDraftInput, target: AIContextTarget) {
  const contentItemIds = input.contentItemIds ?? (target.kind === 'content' ? [target.id] : []);
  const projectId = input.projectId ?? (target.kind === 'project' ? target.id : undefined);
  return { ...input, contentItemIds, ...(projectId === undefined ? {} : { projectId }) };
}

function assertObservedIds(input: { projectId?: string; contentItemIds: string[] }, target: AIContextTarget, sources: readonly AISource[]) {
  const contentIds = new Set(sources.filter((source) => source.module === 'inbox' && source.entity === 'content').map((source) => source.id));
  const projectIds = new Set(sources.filter((source) => source.module === 'projects' && source.entity === 'project').map((source) => source.id));
  if (target.kind === 'content') contentIds.add(target.id);
  if (target.kind === 'project') projectIds.add(target.id);
  if (input.contentItemIds.some((id) => !contentIds.has(id))) throw new AskEremiteActionDraftError('ai_action_draft_not_allowed', 'unobserved_content');
  if (input.projectId && !projectIds.has(input.projectId)) throw new AskEremiteActionDraftError('ai_action_draft_not_allowed', 'unobserved_project');
}

function toArtifact(relation: ReturnType<typeof listAIMessageActionDraftRelations>[number]): AIActionDraftArtifact {
  const action = getActionDraftArtifact(relation.action_id);
  if (!action) return unavailableArtifact(relation);
  const lifecycle = action.status === 'draft' && !action.trashed_at
    ? 'pending'
    : action.status === 'active' && !action.trashed_at
      ? 'confirmed'
      : action.status === 'draft' && Boolean(action.trashed_at)
        ? 'rejected'
        : 'unavailable';
  const project = action.project_id ? getProject(action.project_id) : undefined;
  return {
    actionId: action.id,
    revision: action.revision,
    actionRevisionAtCreation: relation.action_revision_at_creation,
    createdAt: relation.created_at,
    title: action.title,
    priority: action.priority,
    dueDate: action.due_date,
    project: project ? { id: project.id, name: project.name } : null,
    linkedContent: action.contentItemIds.map((id) => {
      const content = getContentItemSummary(id);
      return { id, title: content?.title ?? '不可用资料', available: Boolean(content && !content.trashed_at) };
    }),
    lifecycle,
    actionStatus: action.status,
  };
}

function unavailableArtifact(relation: ReturnType<typeof listAIMessageActionDraftRelations>[number]): AIActionDraftArtifact {
  return {
    actionId: relation.action_id,
    revision: relation.action_revision_at_creation,
    actionRevisionAtCreation: relation.action_revision_at_creation,
    createdAt: relation.created_at,
    title: '不可用的行动草稿',
    priority: 'normal',
    dueDate: null,
    project: null,
    linkedContent: [],
    lifecycle: 'unavailable',
    actionStatus: 'unavailable',
  };
}
