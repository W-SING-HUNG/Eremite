import "server-only";
import { all, assertUnitOfWork, one, run, type UnitOfWork } from '@/platform/db/database';
import { now, uuidv7 } from '@/platform/shared/ids';

export type AIToolRunProposalRow = {
  id: string; thread_id: string; message_id: string; ai_run_id: string; operation_id: string;
  tool_id: 'core.file-converter' | 'core.pdf-tools'; tool_version: number; input_json: string;
  lifecycle: 'pending' | 'rejected' | 'stale' | 'accepted'; automation_run_id: string | null;
  created_at: string; resolved_at: string | null;
};

export function recordAIToolRunProposal(uow: UnitOfWork, input: {
  threadId: string; messageId: string; runId: string; toolId: AIToolRunProposalRow['tool_id'];
  toolVersion: number; inputJson: string;
}) {
  assertUnitOfWork(uow);
  const active = one<{ id: string }>("SELECT id FROM ai_runs WHERE id = ? AND thread_id = ? AND message_id = ? AND status = 'running'", input.runId, input.threadId, input.messageId);
  if (!active) throw new Error('ai_tool_run_not_active');
  // The UNIQUE ai_run_id constraint is the durable one-proposal-per-run boundary.
  if (one('SELECT id FROM ai_tool_run_proposals WHERE ai_run_id = ?', input.runId)) throw new Error('ai_tool_run_limit');
  const id = uuidv7(); const operationId = uuidv7();
  run(`INSERT INTO ai_tool_run_proposals
    (id, thread_id, message_id, ai_run_id, operation_id, tool_id, tool_version, input_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, input.threadId, input.messageId, input.runId, operationId,
    input.toolId, input.toolVersion, input.inputJson, now());
  return id;
}

export function hasAIToolRunProposal(runId: string) {
  return Boolean(one('SELECT id FROM ai_tool_run_proposals WHERE ai_run_id = ?', runId));
}

export function listAIToolRunProposals(messageIds: string[]) {
  const ids = [...new Set(messageIds)];
  if (!ids.length) return [] as AIToolRunProposalRow[];
  return all<AIToolRunProposalRow>(`SELECT * FROM ai_tool_run_proposals WHERE message_id IN (${ids.map(() => '?').join(', ')}) ORDER BY created_at, id`, ...ids);
}

export function getAIToolRunProposal(input: { threadId: string; messageId: string; proposalId: string }) {
  return one<AIToolRunProposalRow>(`SELECT proposal.* FROM ai_tool_run_proposals proposal
    JOIN ai_messages message ON message.id = proposal.message_id AND message.thread_id = proposal.thread_id
    JOIN ai_runs ai_run ON ai_run.id = proposal.ai_run_id AND ai_run.message_id = proposal.message_id AND ai_run.thread_id = proposal.thread_id
    WHERE proposal.id = ? AND proposal.thread_id = ? AND proposal.message_id = ?`, input.proposalId, input.threadId, input.messageId);
}

export function resolveAIToolRunProposal(uow: UnitOfWork, id: string, lifecycle: 'rejected' | 'stale' | 'accepted', automationRunId?: string) {
  assertUnitOfWork(uow);
  return Number(run(`UPDATE ai_tool_run_proposals SET lifecycle = ?, automation_run_id = ?, resolved_at = ? WHERE id = ? AND lifecycle = 'pending'`,
    lifecycle, automationRunId ?? null, now(), id).changes) === 1;
}
