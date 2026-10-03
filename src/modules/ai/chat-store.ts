import "server-only";

import { all, assertUnitOfWork, one, run, transaction, type UnitOfWork } from '@/platform/db/database';
import { now, uuidv7 } from '@/platform/shared/ids';
import type { AIThread, AIChatMessage, AIChatErrorCode, AIThreadDetail, AISource, AIDurableActivity } from './chat-contracts';

export class AIChatStoreError extends Error {
  constructor(public readonly code: 'ai_not_found' | 'ai_revision_conflict' | 'ai_run_active' | 'ai_duplicate_request' | 'ai_invalid_input') { super(code); }
}

export function createAIThread(): AIThread {
  const id = uuidv7(); const stamp = now();
  run('INSERT INTO ai_threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', id, '新对话', stamp, stamp);
  return requireThread(id);
}

export function listAIThreads(offset = 0): AIThread[] {
  return all<AIThread>('SELECT * FROM ai_threads ORDER BY updated_at DESC, id DESC LIMIT 40 OFFSET ?', Math.max(0, Math.min(offset, 1_000_000)));
}

function requireThread(id: string) {
  const thread = one<AIThread>('SELECT * FROM ai_threads WHERE id = ?', id);
  if (!thread) throw new AIChatStoreError('ai_not_found');
  return thread;
}

/** Recovery is bounded by each request's hard deadline, never by a worker. */
export function recoverExpiredAIRuns(threadId: string) {
  transaction(() => {
    const expired = all<{ id: string }>("SELECT id FROM ai_runs WHERE thread_id = ? AND status = 'running' AND deadline_at <= ?", threadId, now());
    for (const entry of expired) finishAIRun({ runId: entry.id, status: 'failed', errorCode: 'ai_interrupted' });
  });
}

export function getAIThread(id: string, before = Number.MAX_SAFE_INTEGER): AIThreadDetail {
  recoverExpiredAIRuns(id);
  const thread = requireThread(id);
  const messages = all<AIChatMessage>(`SELECT m.*, r.id AS run_id, r.status, r.error_code, r.model
    FROM ai_messages m LEFT JOIN ai_runs r ON r.message_id = m.id
    WHERE m.thread_id = ? AND m.ordinal < ? ORDER BY m.ordinal DESC LIMIT 101`, id, before);
  const hasOlder = messages.length > 100;
  const selected = messages.slice(0, 100).reverse();
  const sources = selected.length === 0 ? [] : all<{ message_id: string; module: AISource['module']; entity: AISource['entity']; entity_id: string; revision: number | null; label: string; href: string }>(
    `SELECT message_id, module, entity, entity_id, revision, label, href FROM ai_message_sources WHERE message_id IN (${selected.map(() => '?').join(', ')}) ORDER BY rowid`,
    ...selected.map(message => message.id),
  );
  const activities = selected.length === 0 ? [] : all<{ message_id: string; ordinal: number; kind: AIDurableActivity['kind']; state: AIDurableActivity['state']; code: AIDurableActivity['code'] | null }>(
    `SELECT message_id, ordinal, kind, state, code FROM ai_message_activities WHERE message_id IN (${selected.map(() => '?').join(', ')}) ORDER BY message_id, ordinal`,
    ...selected.map(message => message.id),
  );
  return { thread, messages: selected.map(message => ({ ...message, sources: sources.filter(source => source.message_id === message.id).map(source => ({ module: source.module, entity: source.entity, id: source.entity_id, ...(source.revision === null ? {} : { revision: source.revision }), label: source.label, href: source.href })), activities: activities.filter(activity => activity.message_id === message.id).map(({ kind, state, code }) => ({ kind, state, ...(code ? { code } : {}) })), actionDrafts: [], actionUpdates: [], actionDisambiguations: [], toolRunProposals: [] })), hasOlder };
}

export type AIActionDraftRelation = {
  message_id: string; run_id: string; action_id: string; action_revision_at_creation: number; created_at: string;
};

/** AI-owned provenance write; the app Host must call this in the same UoW as Actions creation. */
export function recordAIActionDraft(
  uow: UnitOfWork,
  input: { threadId: string; messageId: string; runId: string; actionId: string; actionRevision: number },
) {
  assertUnitOfWork(uow);
  const active = one<{ id: string }>(
    "SELECT id FROM ai_runs WHERE id = ? AND thread_id = ? AND message_id = ? AND status = 'running'",
    input.runId, input.threadId, input.messageId,
  );
  if (!active) throw new AIChatStoreError('ai_not_found');
  run(
    'INSERT INTO ai_message_action_drafts (message_id, run_id, action_id, action_revision_at_creation, created_at) VALUES (?, ?, ?, ?, ?)',
    input.messageId, input.runId, input.actionId, input.actionRevision, now(),
  );
}

export function listAIMessageActionDraftRelations(messageIds: string[]): AIActionDraftRelation[] {
  const unique = [...new Set(messageIds)];
  if (unique.length === 0) return [];
  return all<AIActionDraftRelation>(
    `SELECT message_id, run_id, action_id, action_revision_at_creation, created_at
       FROM ai_message_action_drafts
      WHERE message_id IN (${unique.map(() => '?').join(', ')})
      ORDER BY created_at, action_id`,
    ...unique,
  );
}

export function getAIActionDraftRelation(input: { threadId: string; messageId: string; actionId: string }) {
  return one<AIActionDraftRelation>(
    `SELECT relation.message_id, relation.run_id, relation.action_id,
            relation.action_revision_at_creation, relation.created_at
       FROM ai_message_action_drafts relation
       JOIN ai_messages message ON message.id = relation.message_id
       JOIN ai_runs run_record ON run_record.id = relation.run_id AND run_record.message_id = message.id
      WHERE message.thread_id = ? AND relation.message_id = ? AND relation.action_id = ?`,
    input.threadId, input.messageId, input.actionId,
  );
}

export type AIActionUpdateProposalRow = {
  id: string; thread_id: string; message_id: string; run_id: string; action_id: string; action_revision: number;
  before_title: string; before_priority: 'low' | 'normal' | 'high'; before_due_date: string | null; before_status: 'active';
  patch_title: string | null; patch_priority: 'low' | 'normal' | 'high' | null; patch_due_date_set: number; patch_due_date: string | null;
  transition: 'done' | 'cancelled' | null; lifecycle: 'pending' | 'applying' | 'applied' | 'rejected' | 'stale' | 'unavailable' | 'error';
  created_at: string; resolved_at: string | null; applied_revision: number | null;
};

export type AIActionDisambiguationRow = {
  id: string; thread_id: string; message_id: string; run_id: string; reference_key: string;
  patch_title: string | null; patch_priority: 'low' | 'normal' | 'high' | null;
  patch_due_date_set: number; patch_due_date: string | null; transition: 'done' | 'cancelled' | null;
  lifecycle: 'pending' | 'resolved' | 'stale'; selected_action_id: string | null; created_at: string; resolved_at: string | null;
};
export type AIActionDisambiguationCandidateRow = {
  disambiguation_id: string; action_id: string; action_revision: number; title_snapshot: string;
  project_id: string | null; project_name_snapshot: string | null; due_date_snapshot: string | null;
  priority_snapshot: 'low' | 'normal' | 'high'; created_at_snapshot: string;
};

export function recordAIActionDisambiguation(uow: UnitOfWork, input: {
  threadId: string; messageId: string; runId: string; referenceKey: string;
  patchTitle?: string; patchPriority?: 'low' | 'normal' | 'high'; patchDueDateSet: boolean; patchDueDate: string | null;
  transition?: 'done' | 'cancelled';
  candidates: Array<{ actionId: string; revision: number; title: string; projectId: string | null; projectName: string | null; dueDate: string | null; priority: 'low' | 'normal' | 'high'; createdAt: string }>;
}) {
  assertUnitOfWork(uow);
  const active = one<{ id: string }>("SELECT id FROM ai_runs WHERE id = ? AND thread_id = ? AND message_id = ? AND status = 'running'", input.runId, input.threadId, input.messageId);
  if (!active) throw new AIChatStoreError('ai_not_found');
  const existing = one<{ id: string }>('SELECT id FROM ai_action_disambiguations WHERE message_id = ?', input.messageId);
  if (existing) return existing.id;
  const id = uuidv7();
  run(`INSERT INTO ai_action_disambiguations
    (id, thread_id, message_id, run_id, reference_key, patch_title, patch_priority, patch_due_date_set, patch_due_date, transition, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, input.threadId, input.messageId, input.runId, input.referenceKey,
    input.patchTitle ?? null, input.patchPriority ?? null, input.patchDueDateSet ? 1 : 0, input.patchDueDate,
    input.transition ?? null, now());
  for (const candidate of input.candidates) run(`INSERT INTO ai_action_disambiguation_candidates
    (disambiguation_id, action_id, action_revision, title_snapshot, project_id, project_name_snapshot, due_date_snapshot, priority_snapshot, created_at_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, candidate.actionId, candidate.revision, candidate.title,
    candidate.projectId, candidate.projectName, candidate.dueDate, candidate.priority, candidate.createdAt);
  return id;
}

export function listAIActionDisambiguations(messageIds: string[]) {
  const unique = [...new Set(messageIds)];
  if (!unique.length) return [] as Array<AIActionDisambiguationRow & { candidates: AIActionDisambiguationCandidateRow[] }>;
  const rows = all<AIActionDisambiguationRow>(`SELECT * FROM ai_action_disambiguations WHERE message_id IN (${unique.map(() => '?').join(', ')}) ORDER BY created_at, id`, ...unique);
  const candidates = all<AIActionDisambiguationCandidateRow>(`SELECT candidate.* FROM ai_action_disambiguation_candidates candidate JOIN ai_action_disambiguations outcome ON outcome.id = candidate.disambiguation_id WHERE outcome.message_id IN (${unique.map(() => '?').join(', ')}) ORDER BY candidate.title_snapshot, candidate.action_id`, ...unique);
  return rows.map(row => ({ ...row, candidates: candidates.filter(candidate => candidate.disambiguation_id === row.id) }));
}

export function getAIActionDisambiguation(input: { threadId: string; messageId: string; disambiguationId: string }) {
  const row = one<AIActionDisambiguationRow>(`SELECT outcome.* FROM ai_action_disambiguations outcome
    JOIN ai_messages message ON message.id = outcome.message_id AND message.thread_id = outcome.thread_id
    JOIN ai_runs run_record ON run_record.id = outcome.run_id AND run_record.message_id = outcome.message_id AND run_record.thread_id = outcome.thread_id
    WHERE outcome.id = ? AND outcome.thread_id = ? AND outcome.message_id = ?`, input.disambiguationId, input.threadId, input.messageId);
  if (!row) return undefined;
  const candidates = all<AIActionDisambiguationCandidateRow>('SELECT * FROM ai_action_disambiguation_candidates WHERE disambiguation_id = ? ORDER BY title_snapshot, action_id', row.id);
  return { ...row, candidates };
}

export function setAIActionDisambiguationLifecycle(uow: UnitOfWork, id: string, from: AIActionDisambiguationRow['lifecycle'], to: AIActionDisambiguationRow['lifecycle'], selectedActionId?: string) {
  assertUnitOfWork(uow);
  return Number(run('UPDATE ai_action_disambiguations SET lifecycle = ?, selected_action_id = ?, resolved_at = ? WHERE id = ? AND lifecycle = ?', to, selectedActionId ?? null, now(), id, from).changes) === 1;
}

/** AI owns proposal storage; the Host supplies only service-validated values. */
export function recordAIActionUpdateProposal(uow: UnitOfWork, input: {
  threadId: string; messageId: string; runId: string; actionId: string; actionRevision: number;
  beforeTitle: string; beforePriority: 'low' | 'normal' | 'high'; beforeDueDate: string | null;
  patchTitle?: string; patchPriority?: 'low' | 'normal' | 'high'; patchDueDateSet: boolean; patchDueDate: string | null;
  transition?: 'done' | 'cancelled';
}) {
  assertUnitOfWork(uow);
  const active = one<{ id: string }>("SELECT id FROM ai_runs WHERE id = ? AND thread_id = ? AND message_id = ? AND status = 'running'", input.runId, input.threadId, input.messageId);
  if (!active) throw new AIChatStoreError('ai_not_found');
  return insertAIActionUpdateProposal(input);
}

export function recordAIActionUpdateProposalFromSelection(uow: UnitOfWork, input: Parameters<typeof recordAIActionUpdateProposal>[1] & { disambiguationId: string }) {
  assertUnitOfWork(uow);
  const outcome = one<{ id: string }>("SELECT id FROM ai_action_disambiguations WHERE id = ? AND thread_id = ? AND message_id = ? AND run_id = ? AND lifecycle = 'pending'", input.disambiguationId, input.threadId, input.messageId, input.runId);
  const candidate = outcome && one<{ action_id: string }>('SELECT action_id FROM ai_action_disambiguation_candidates WHERE disambiguation_id = ? AND action_id = ?', outcome.id, input.actionId);
  if (!candidate) throw new AIChatStoreError('ai_not_found');
  return insertAIActionUpdateProposal(input);
}

function insertAIActionUpdateProposal(input: Parameters<typeof recordAIActionUpdateProposal>[1]) {
  const id = uuidv7();
  run(`INSERT INTO ai_action_update_proposals
    (id, thread_id, message_id, run_id, action_id, action_revision, before_title, before_priority, before_due_date, before_status,
     patch_title, patch_priority, patch_due_date_set, patch_due_date, transition, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    id, input.threadId, input.messageId, input.runId, input.actionId, input.actionRevision, input.beforeTitle, input.beforePriority, input.beforeDueDate,
    input.patchTitle ?? null, input.patchPriority ?? null, input.patchDueDateSet ? 1 : 0, input.patchDueDate, input.transition ?? null, now());
  return id;
}

export function listAIActionUpdateProposals(messageIds: string[]): AIActionUpdateProposalRow[] {
  const unique = [...new Set(messageIds)];
  if (!unique.length) return [];
  return all<AIActionUpdateProposalRow>(`SELECT * FROM ai_action_update_proposals WHERE message_id IN (${unique.map(() => '?').join(', ')}) ORDER BY created_at, id`, ...unique);
}

export function getAIActionUpdateProposal(input: { threadId: string; messageId: string; proposalId: string }): AIActionUpdateProposalRow | undefined {
  return one<AIActionUpdateProposalRow>(`SELECT proposal.* FROM ai_action_update_proposals proposal
    JOIN ai_messages message ON message.id = proposal.message_id AND message.thread_id = proposal.thread_id
    JOIN ai_runs run_record ON run_record.id = proposal.run_id AND run_record.message_id = proposal.message_id AND run_record.thread_id = proposal.thread_id
    WHERE proposal.id = ? AND proposal.thread_id = ? AND proposal.message_id = ?`, input.proposalId, input.threadId, input.messageId);
}

export function setAIActionUpdateProposalLifecycle(uow: UnitOfWork, id: string, from: AIActionUpdateProposalRow['lifecycle'], to: AIActionUpdateProposalRow['lifecycle'], appliedRevision?: number) {
  assertUnitOfWork(uow);
  const result = run('UPDATE ai_action_update_proposals SET lifecycle = ?, resolved_at = ?, applied_revision = ? WHERE id = ? AND lifecycle = ?', to, to === 'applying' ? null : now(), appliedRevision ?? null, id, from);
  return Number(result.changes) === 1;
}

export function beginAIRun(input: { threadId: string; expectedRevision: number; requestId: string; text: string; model: string; deadlineAt: string }) {
  const text = input.text.trim();
  if (!text || text.length > 8_000 || !Number.isSafeInteger(input.expectedRevision) || input.model.length > 200) throw new AIChatStoreError('ai_invalid_input');
  return transaction(() => {
    recoverExpiredAIRuns(input.threadId);
    const thread = requireThread(input.threadId);
    if (one('SELECT id FROM ai_runs WHERE request_id = ?', input.requestId)) throw new AIChatStoreError('ai_duplicate_request');
    if (one("SELECT id FROM ai_runs WHERE thread_id = ? AND status = 'running'", input.threadId)) throw new AIChatStoreError('ai_run_active');
    if (thread.revision !== input.expectedRevision) throw new AIChatStoreError('ai_revision_conflict');
    const ordinal = Number(one<{ n: number }>('SELECT COALESCE(MAX(ordinal), 0) AS n FROM ai_messages WHERE thread_id = ?', thread.id)!.n) + 1;
    const stamp = now(); const runId = uuidv7(); const userId = uuidv7(); const assistantId = uuidv7();
    run('UPDATE ai_threads SET title = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?', ordinal === 1 ? text.slice(0, 120) : thread.title, stamp, thread.id, input.expectedRevision);
    run("INSERT INTO ai_messages (id, thread_id, ordinal, role, content, created_at) VALUES (?, ?, ?, 'user', ?, ?)", userId, thread.id, ordinal, text, stamp);
    run("INSERT INTO ai_messages (id, thread_id, ordinal, role, content, created_at) VALUES (?, ?, ?, 'assistant', '', ?)", assistantId, thread.id, ordinal + 1, stamp);
    run(`INSERT INTO ai_runs (id, thread_id, message_id, request_id, task_id, provider, model, status, created_at, deadline_at)
      VALUES (?, ?, ?, ?, 'ask-eremite.v1', 'openai-compatible', ?, 'running', ?, ?)`, runId, thread.id, assistantId, input.requestId, input.model, stamp, input.deadlineAt);
    return { runId, userId, assistantId, threadId: thread.id };
  });
}

export function checkpointAIMessage(runId: string, content: string) {
  run("UPDATE ai_messages SET content = ? WHERE id = (SELECT message_id FROM ai_runs WHERE id = ? AND status = 'running')", content.slice(0, 48_000), runId);
}

const safeActivityKinds = new Set(['search', 'content', 'project', 'actions', 'draft', 'update', 'tool-run']);
const safeActivityCodes = new Set(['ai_tool_invalid_arguments', 'ai_tool_unobserved_content', 'ai_tool_unobserved_project', 'ai_tool_host_rejected', 'ai_tool_ambiguous_target', 'ai_tool_execution_failed', 'ai_tool_run_unobserved_source', 'ai_tool_run_source_unavailable', 'ai_tool_run_unsupported_capability', 'ai_tool_run_invalid_parameters', 'ai_tool_run_unavailable']);

export function finishAIRun(input: { runId: string; status: 'completed' | 'cancelled' | 'failed'; content?: string; errorCode?: AIChatErrorCode; inputTokens?: number; outputTokens?: number; sources?: readonly AISource[]; activities?: readonly AIDurableActivity[] }) {
  return transaction(() => {
    const active = one<{ thread_id: string; message_id: string }>("SELECT thread_id, message_id FROM ai_runs WHERE id = ? AND status = 'running'", input.runId);
    if (!active) return false;
    if (input.content !== undefined) checkpointAIMessage(input.runId, input.content);
    const stamp = now();
    run("UPDATE ai_runs SET status = ?, error_code = ?, input_tokens = ?, output_tokens = ?, completed_at = ? WHERE id = ? AND status = 'running'",
      input.status, input.errorCode ?? null, safeTokenCount(input.inputTokens), safeTokenCount(input.outputTokens), stamp, input.runId);
    for (const source of dedupeSources(input.sources ?? [])) {
      const sourceKey = `${source.module}:${source.entity}:${source.id}:${source.revision ?? ''}`;
      run('INSERT INTO ai_message_sources (message_id, source_key, module, entity, entity_id, revision, label, href) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        active.message_id, sourceKey, source.module, source.entity, source.id, source.revision ?? null, source.label.slice(0, 240), source.href.slice(0, 1000));
    }
    let ordinal = 0;
    for (const activity of (input.activities ?? []).slice(0, 32)) {
      if (!safeActivityKinds.has(activity.kind) || !['succeeded', 'failed', 'needs_input'].includes(activity.state)) continue;
      const code = activity.state === 'failed' ? (safeActivityCodes.has(activity.code ?? '') ? activity.code : 'ai_tool_execution_failed') : null;
      run('INSERT INTO ai_message_activities (id, message_id, run_id, ordinal, kind, state, code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        uuidv7(), active.message_id, input.runId, ++ordinal, activity.kind, activity.state, code, stamp);
    }
    run('UPDATE ai_threads SET revision = revision + 1, updated_at = ? WHERE id = ?', stamp, active.thread_id);
    return true;
  });
}

export function getAIRunIdentity(threadId: string, runId: string) {
  return one<{ id: string; status: string }>('SELECT id, status FROM ai_runs WHERE id = ? AND thread_id = ?', runId, threadId);
}

function safeTokenCount(value: number | undefined) { return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function dedupeSources(sources: readonly AISource[]) { return [...new Map(sources.map(source => [`${source.module}:${source.entity}:${source.id}:${source.revision ?? ''}`, source])).values()].slice(0, 50); }
