import 'server-only';

import { z } from 'zod';
import { actionReferenceKey, applyControlledActionUpdate, getAction, listActiveActionReferenceMatches } from '@/modules/actions/service';
import { getProjectForAI } from '@/modules/projects/service';
import { normalizeKey } from '@/platform/shared/normalization';
import {
  getAIActionUpdateProposal, listAIActionUpdateProposals, recordAIActionUpdateProposal,
  setAIActionUpdateProposalLifecycle, getAIActionDisambiguation, listAIActionDisambiguations,
  recordAIActionDisambiguation, recordAIActionUpdateProposalFromSelection, setAIActionDisambiguationLifecycle,
  type AIActionUpdateProposalRow, type AIActionDisambiguationRow, type AIActionDisambiguationCandidateRow,
} from '@/modules/ai/chat-store';
import type { AIActionDisambiguationArtifact, AIActionUpdateArtifact, AIThreadDetail } from '@/modules/ai/chat-contracts';
import type { AIChatToolExecutionContext } from '@/modules/ai/tools';
import { withUnitOfWork } from '@/platform/db/database';

const date = z.union([z.iso.date(), z.null()]);
export const proposeActionUpdateInputSchema = z.object({
  actionId: z.string().uuid().optional().describe('Use only when the user explicitly selected an observed Action in the UI or gave an unambiguous observed ID.'),
  targetName: z.string().min(1).max(240).optional().describe('The existing Action name as stated by the user. Use this for natural-language references; the Host resolves all matching Actions and asks the user to choose if needed. Do not guess an Action ID.'),
  title: z.string().min(1).max(240).regex(/^[\s\S]*\S[\s\S]*$/u).optional().describe('Full new Action title as expressed by the user. Surrounding “...” or 《...》 in ordinary rename requests only delimit the value; the Host removes one matching outer pair unless preserveTitleQuotes is true.'),
  preserveTitleQuotes: z.boolean().optional().describe('Set true ONLY if the user explicitly wants surrounding quotation/book-title characters stored as part of the Action title, e.g. says 引号也要保留. Omit otherwise. Internal quotation marks are always preserved.'),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  dueDate: date.optional(),
  transition: z.enum(['done', 'cancelled']).optional(),
}).strict().refine(value => (value.actionId === undefined) !== (value.targetName === undefined))
  .refine(value => value.title !== undefined || value.priority !== undefined || value.dueDate !== undefined || value.transition !== undefined)
  .refine(value => value.transition === undefined || value.title === undefined && value.priority === undefined && value.dueDate === undefined)
  .refine(value => value.title !== undefined || value.preserveTitleQuotes === undefined);

export type ProposeActionUpdateInput = z.infer<typeof proposeActionUpdateInputSchema>;

export class AskEremiteActionUpdateError extends Error {
  constructor(public readonly code: 'ai_action_update_not_allowed' | 'ai_action_update_not_found' | 'ai_action_update_not_pending' | 'ai_action_update_stale' | 'ai_action_update_ambiguous') {
    super(code);
  }
}

export function proposeAskEremiteActionUpdate(input: unknown, context: AIChatToolExecutionContext): AIActionUpdateArtifact | { kind: 'needs_disambiguation'; disambiguationId: string } {
  context.abortSignal?.throwIfAborted();
  const parsed = proposeActionUpdateInputSchema.parse(input);
  return withUnitOfWork(uow => {
    context.abortSignal?.throwIfAborted();
    const nameMatches = parsed.targetName === undefined ? null : resolveActionCandidates(parsed.targetName, context, parsed.dueDate);
    const namedKey = parsed.targetName === undefined ? null : actionReferenceKey(parsed.targetName);
    if (namedKey && !normalizeKey(context.userRequest ?? '').includes(namedKey)) throw new AskEremiteActionUpdateError('ai_action_update_not_allowed');
    const observed = context.observedSources.filter(item => item.module === 'actions' && item.entity === 'action' && item.revision !== undefined);
    const lookupId = parsed.actionId ?? nameMatches?.find(item => observed.some(source => source.id === item.id && source.revision === item.revision))?.id;
    if (!lookupId || !observed.some(source => source.id === lookupId)) throw new AskEremiteActionUpdateError('ai_action_update_not_allowed');
    const source = observed.find(item => item.id === lookupId);
    const action = getAction(lookupId);
    if (!action || action.trashed_at || action.status !== 'active') throw new AskEremiteActionUpdateError('ai_action_update_not_allowed');
    if (!source || action.revision !== source.revision) throw new AskEremiteActionUpdateError('ai_action_update_stale');
    if (namedKey && actionReferenceKey(action.title) !== namedKey) throw new AskEremiteActionUpdateError('ai_action_update_not_allowed');
    const title = parsed.title === undefined ? undefined : parsed.preserveTitleQuotes === true
      ? parsed.title.normalize('NFKC').trim() : removeOneDeclaredDelimiter(parsed.title.normalize('NFKC').trim());
    if (title !== undefined && (!title || title.length > 240)) throw new AskEremiteActionUpdateError('ai_action_update_not_allowed');
    const candidates = nameMatches ?? resolveActionCandidates(action.title, context, parsed.dueDate);
    if (!candidates.some(candidate => candidate.id === action.id)) throw new AskEremiteActionUpdateError('ai_action_update_not_allowed');
    if (candidates.length > 1) {
      const id = recordAIActionDisambiguation(uow, {
        ...context.identity, referenceKey: actionReferenceKey(action.title),
        ...(title === undefined ? {} : { patchTitle: title }),
        ...(parsed.priority === undefined ? {} : { patchPriority: parsed.priority }),
        patchDueDateSet: parsed.dueDate !== undefined, patchDueDate: parsed.dueDate ?? null,
        ...(parsed.transition === undefined ? {} : { transition: parsed.transition }),
        candidates: candidates.map(candidate => ({ actionId: candidate.id, revision: candidate.revision, title: candidate.title,
          projectId: candidate.project_id, projectName: candidate.project_id ? getProjectForAI(candidate.project_id)?.name ?? null : null,
          dueDate: candidate.due_date, priority: candidate.priority, createdAt: candidate.created_at })),
      });
      return { kind: 'needs_disambiguation', disambiguationId: id };
    }
    const changed = (title !== undefined && title !== action.title) || (parsed.priority !== undefined && parsed.priority !== action.priority) ||
      (parsed.dueDate !== undefined && parsed.dueDate !== action.due_date) || parsed.transition !== undefined;
    if (!changed) throw new AskEremiteActionUpdateError('ai_action_update_not_allowed');
    const id = recordAIActionUpdateProposal(uow, {
      ...context.identity, actionId: action.id, actionRevision: action.revision,
      beforeTitle: action.title, beforePriority: action.priority, beforeDueDate: action.due_date,
      ...(title === undefined ? {} : { patchTitle: title }),
      ...(parsed.priority === undefined ? {} : { patchPriority: parsed.priority }),
      patchDueDateSet: parsed.dueDate !== undefined, patchDueDate: parsed.dueDate ?? null,
      ...(parsed.transition === undefined ? {} : { transition: parsed.transition }),
    });
    const row = getAIActionUpdateProposal({ threadId: context.identity.threadId, messageId: context.identity.messageId, proposalId: id });
    if (!row) throw new AskEremiteActionUpdateError('ai_action_update_not_found');
    return toArtifact(row);
  });
}

function resolveActionCandidates(referenceTitle: string, context: AIChatToolExecutionContext, proposedDueDate?: string | null) {
  const request = context.userRequest?.trim() ?? '';
  const requestKey = normalizeKey(request);
  const selectedKey = actionReferenceKey(referenceTitle);
  const quotedReference = firstQuotedReference(request);
  if (quotedReference && listActiveActionReferenceMatches(quotedReference).length > 0 && actionReferenceKey(quotedReference) !== selectedKey) throw new AskEremiteActionUpdateError('ai_action_update_not_allowed');
  if (!selectedKey) throw new AskEremiteActionUpdateError('ai_action_update_not_allowed');
  let matches = listActiveActionReferenceMatches(referenceTitle);
  if (!matches.length) throw new AskEremiteActionUpdateError('ai_action_update_not_allowed');
  const uiSelected = context.currentContext.kind === 'actions' && context.currentContext.id;
  if (!request || !requestKey.includes(selectedKey)) return uiSelected && matches.some(candidate => candidate.id === uiSelected)
    ? matches.filter(candidate => candidate.id === uiSelected) : matches;

  let qualified = false;
  const projectId = context.currentContext.kind === 'project' ? context.currentContext.id
    : context.currentContext.kind === 'actions' ? context.currentContext.projectId : undefined;
  if (projectId) { matches = matches.filter(candidate => candidate.project_id === projectId); qualified = true; }
  const namedProjects = [...new Set(matches.map(candidate => candidate.project_id).filter((id): id is string => Boolean(id)))]
    .filter(id => { const project = getProjectForAI(id); return project && requestKey.includes(normalizeKey(project.name)); });
  if (namedProjects.length > 0) { matches = matches.filter(candidate => candidate.project_id !== null && namedProjects.includes(candidate.project_id)); qualified = true; }
  const mentionedDates = [...request.matchAll(/\b\d{4}-\d{2}-\d{2}\b/gu)].map(match => match[0]).filter(date => date !== proposedDueDate);
  if (mentionedDates.length > 0) { matches = matches.filter(candidate => candidate.due_date !== null && mentionedDates.includes(candidate.due_date)); qualified = true; }
  if (qualified && !matches.length) throw new AskEremiteActionUpdateError('ai_action_update_not_allowed');
  return !qualified && uiSelected && matches.some(candidate => candidate.id === uiSelected)
    ? matches.filter(candidate => candidate.id === uiSelected) : matches;
}

function firstQuotedReference(request: string) {
  const matches = [/“([^”]+)”/u, /‘([^’]+)’/u, /《([^》]+)》/u, /"([^"]+)"/u, /'([^']+)'/u]
    .map(pattern => pattern.exec(request)).filter((match): match is RegExpExecArray => Boolean(match));
  return matches.sort((left, right) => left.index - right.index)[0]?.[1];
}

function removeOneDeclaredDelimiter(title: string) {
  for (const [open, close] of [['“', '”'], ['‘', '’'], ['《', '》'], ['"', '"'], ["'", "'"]]) {
    if (title.startsWith(open) && title.endsWith(close)) return title.slice(open.length, title.length - close.length).trim();
  }
  return title;
}

export function attachActionUpdateProposals(detail: AIThreadDetail): AIThreadDetail {
  const rows = listAIActionUpdateProposals(detail.messages.map(message => message.id));
  return { ...detail, messages: detail.messages.map(message => ({ ...message,
    actionUpdates: rows.filter(row => row.message_id === message.id).map(row => toArtifact(refreshLifecycle(row))),
  })) };
}

export function attachActionDisambiguations(detail: AIThreadDetail): AIThreadDetail {
  const rows = listAIActionDisambiguations(detail.messages.map(message => message.id));
  return { ...detail, messages: detail.messages.map(message => ({ ...message,
    actionDisambiguations: rows.filter(row => row.message_id === message.id).map(toDisambiguationArtifact),
  })) };
}

export function chooseAskEremiteActionTarget(input: { threadId: string; messageId: string; disambiguationId: string; actionId: string; expectedRevision: number }) {
  try {
    return withUnitOfWork(uow => {
      const outcome = getAIActionDisambiguation(input);
      if (!outcome) throw new AskEremiteActionUpdateError('ai_action_update_not_found');
      if (outcome.lifecycle !== 'pending') throw new AskEremiteActionUpdateError('ai_action_update_not_pending');
      const candidate = outcome.candidates.find(item => item.action_id === input.actionId);
      if (!candidate) throw new AskEremiteActionUpdateError('ai_action_update_not_found');
      const action = getAction(input.actionId);
      if (!action || action.trashed_at || action.status !== 'active' || action.revision !== input.expectedRevision ||
        candidate.action_revision !== input.expectedRevision || actionReferenceKey(action.title) !== outcome.reference_key) {
        throw new AskEremiteActionUpdateError('ai_action_update_stale');
      }
      const changed = (outcome.patch_title !== null && outcome.patch_title !== action.title) ||
        (outcome.patch_priority !== null && outcome.patch_priority !== action.priority) ||
        (outcome.patch_due_date_set === 1 && outcome.patch_due_date !== action.due_date) || outcome.transition !== null;
      if (!changed) throw new AskEremiteActionUpdateError('ai_action_update_not_allowed');
      const proposalId = recordAIActionUpdateProposalFromSelection(uow, {
        disambiguationId: outcome.id, threadId: outcome.thread_id, messageId: outcome.message_id, runId: outcome.run_id,
        actionId: action.id, actionRevision: action.revision, beforeTitle: action.title, beforePriority: action.priority,
        beforeDueDate: action.due_date, ...(outcome.patch_title === null ? {} : { patchTitle: outcome.patch_title }),
        ...(outcome.patch_priority === null ? {} : { patchPriority: outcome.patch_priority }),
        patchDueDateSet: outcome.patch_due_date_set === 1, patchDueDate: outcome.patch_due_date,
        ...(outcome.transition === null ? {} : { transition: outcome.transition }),
      });
      if (!setAIActionDisambiguationLifecycle(uow, outcome.id, 'pending', 'resolved', action.id)) throw new AskEremiteActionUpdateError('ai_action_update_not_pending');
      const proposal = getAIActionUpdateProposal({ threadId: input.threadId, messageId: input.messageId, proposalId });
      if (!proposal) throw new AskEremiteActionUpdateError('ai_action_update_not_found');
      return toArtifact(proposal);
    });
  } catch (error) {
    if (error instanceof AskEremiteActionUpdateError && error.code === 'ai_action_update_stale') {
      withUnitOfWork(uow => {
        const outcome = getAIActionDisambiguation(input);
        if (outcome?.lifecycle === 'pending') setAIActionDisambiguationLifecycle(uow, outcome.id, 'pending', 'stale');
      });
    }
    throw error;
  }
}

function toDisambiguationArtifact(row: AIActionDisambiguationRow & { candidates: AIActionDisambiguationCandidateRow[] }): AIActionDisambiguationArtifact {
  return { id: row.id, lifecycle: row.lifecycle, selectedActionId: row.selected_action_id,
    candidates: row.candidates.map(candidate => ({ actionId: candidate.action_id, revision: candidate.action_revision,
      title: candidate.title_snapshot, projectName: candidate.project_name_snapshot, dueDate: candidate.due_date_snapshot,
      priority: candidate.priority_snapshot, createdAt: candidate.created_at_snapshot })),
    patch: { ...(row.patch_title === null ? {} : { title: row.patch_title }),
      ...(row.patch_priority === null ? {} : { priority: row.patch_priority }),
      ...(row.patch_due_date_set ? { dueDate: row.patch_due_date } : {}),
      ...(row.transition === null ? {} : { transition: row.transition }) },
  };
}

export function applyAskEremiteActionUpdate(input: { threadId: string; messageId: string; proposalId: string }) {
  try {
    return withUnitOfWork(uow => {
      const row = requirePending(input);
      const action = getAction(row.action_id);
      if (!action || action.trashed_at || action.status !== 'active' || action.revision !== row.action_revision) throw new AskEremiteActionUpdateError('ai_action_update_stale');
      if (!setAIActionUpdateProposalLifecycle(uow, row.id, 'pending', 'applying')) throw new AskEremiteActionUpdateError('ai_action_update_not_pending');
      const revision = applyControlledActionUpdate({ id: row.action_id, expectedRevision: row.action_revision,
        ...(row.patch_title === null ? {} : { title: row.patch_title }),
        ...(row.patch_priority === null ? {} : { priority: row.patch_priority }),
        ...(row.patch_due_date_set ? { dueDate: row.patch_due_date } : {}),
        ...(row.transition === null ? {} : { transition: row.transition }),
      });
      if (!setAIActionUpdateProposalLifecycle(uow, row.id, 'applying', 'applied', revision)) throw new Error('ai_update_lifecycle_conflict');
      return { proposalId: row.id, actionId: row.action_id, revision, lifecycle: 'applied' as const };
    });
  } catch (error) {
    if (error instanceof AskEremiteActionUpdateError && error.code === 'ai_action_update_stale' || error instanceof Error && error.message === 'action_revision_conflict') {
      markStale(input);
      throw new AskEremiteActionUpdateError('ai_action_update_stale');
    }
    if (!(error instanceof AskEremiteActionUpdateError && (error.code === 'ai_action_update_not_found' || error.code === 'ai_action_update_not_pending'))) {
      try { markFailure(input); } catch { /* Preserve the original failure if storage is unavailable. */ }
    }
    throw error;
  }
}

export function rejectAskEremiteActionUpdate(input: { threadId: string; messageId: string; proposalId: string }) {
  return withUnitOfWork(uow => {
    const row = requirePending(input);
    if (!setAIActionUpdateProposalLifecycle(uow, row.id, 'pending', 'rejected')) throw new AskEremiteActionUpdateError('ai_action_update_not_pending');
    return { proposalId: row.id, actionId: row.action_id, lifecycle: 'rejected' as const };
  });
}

function requirePending(input: { threadId: string; messageId: string; proposalId: string }) {
  const row = getAIActionUpdateProposal(input);
  if (!row) throw new AskEremiteActionUpdateError('ai_action_update_not_found');
  if (row.lifecycle !== 'pending') throw new AskEremiteActionUpdateError('ai_action_update_not_pending');
  return row;
}

function markStale(input: { threadId: string; messageId: string; proposalId: string }) {
  withUnitOfWork(uow => {
    const row = getAIActionUpdateProposal(input);
    if (row?.lifecycle === 'pending') setAIActionUpdateProposalLifecycle(uow, row.id, 'pending', 'stale');
  });
}

function markFailure(input: { threadId: string; messageId: string; proposalId: string }) {
  withUnitOfWork(uow => {
    const row = getAIActionUpdateProposal(input);
    if (row?.lifecycle === 'pending') setAIActionUpdateProposalLifecycle(uow, row.id, 'pending', 'error');
  });
}

function refreshLifecycle(row: AIActionUpdateProposalRow): AIActionUpdateProposalRow {
  if (row.lifecycle !== 'pending') return row;
  const action = getAction(row.action_id);
  const next: 'unavailable' | 'stale' | null = !action || action.trashed_at ? 'unavailable' : action.revision !== row.action_revision || action.status !== 'active' ? 'stale' : null;
  if (!next) return row;
  const changed = withUnitOfWork(uow => setAIActionUpdateProposalLifecycle(uow, row.id, 'pending', next));
  return changed ? { ...row, lifecycle: next } : getAIActionUpdateProposal({ threadId: row.thread_id, messageId: row.message_id, proposalId: row.id }) ?? row;
}

function toArtifact(row: AIActionUpdateProposalRow): AIActionUpdateArtifact {
  return { id: row.id, actionId: row.action_id, actionRevision: row.action_revision, createdAt: row.created_at,
    before: { title: row.before_title, priority: row.before_priority, dueDate: row.before_due_date, status: row.before_status },
    patch: { ...(row.patch_title === null ? {} : { title: row.patch_title }), ...(row.patch_priority === null ? {} : { priority: row.patch_priority }),
      ...(row.patch_due_date_set ? { dueDate: row.patch_due_date } : {}), ...(row.transition === null ? {} : { transition: row.transition }) },
    lifecycle: row.lifecycle, appliedRevision: row.applied_revision,
  };
}
