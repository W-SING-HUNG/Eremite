import { z } from 'zod';
import { isAuthorized } from '@/platform/auth/service';
import { createAIThread, listAIThreads, getAIProviderStatus, runAIChat, stopAIChat, AIChatStoreError } from '@/modules/ai/service.server';
import { createAskEremiteHost, AskEremiteContextError } from '@/app/_services/ask-eremite-host';
import { AskEremiteActionDraftError, confirmAskEremiteActionDraft, getAskEremiteThread, rejectAskEremiteActionDraft } from '@/app/_services/ask-eremite-action-drafts';
import { applyAskEremiteActionUpdate, AskEremiteActionUpdateError, chooseAskEremiteActionTarget, rejectAskEremiteActionUpdate } from '@/app/_services/ask-eremite-action-updates';
import { confirmAskEremiteToolRun, rejectAskEremiteToolRun, AskEremiteToolRunError } from '@/app/_services/ask-eremite-tool-runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const identifier = z.string().uuid();
const contextTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('content'), id: identifier }).strict(),
  z.object({ kind: z.literal('project'), id: identifier }).strict(),
  z.object({ kind: z.literal('actions'), id: identifier.optional(), projectId: identifier.optional() }).strict(),
]);
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create') }).strict(),
  z.object({ action: z.literal('stop'), threadId: identifier, runId: identifier }).strict(),
  z.object({ action: z.literal('confirm_action_draft'), threadId: identifier, messageId: identifier, actionId: identifier, expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('reject_action_draft'), threadId: identifier, messageId: identifier, actionId: identifier, expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('apply_action_update'), threadId: identifier, messageId: identifier, proposalId: identifier }).strict(),
  z.object({ action: z.literal('reject_action_update'), threadId: identifier, messageId: identifier, proposalId: identifier }).strict(),
  z.object({ action: z.literal('confirm_tool_run_proposal'), threadId: identifier, messageId: identifier, proposalId: identifier }).strict(),
  z.object({ action: z.literal('reject_tool_run_proposal'), threadId: identifier, messageId: identifier, proposalId: identifier }).strict(),
  z.object({ action: z.literal('choose_action_target'), threadId: identifier, messageId: identifier, disambiguationId: identifier, actionId: identifier, expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('send'), threadId: identifier, expectedRevision: z.number().int().positive(), requestId: identifier, text: z.string().trim().min(1).max(8_000), context: contextTarget }).strict(),
]);

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function GET(request: Request) {
  if (!(await isAuthorized())) return json({ code: 'unauthorized' }, 401);
  try {
    const query = new URL(request.url).searchParams;
    const id = query.get('threadId');
    if (id) {
      if (!identifier.safeParse(id).success) return json({ code: 'ai_invalid_input' }, 400);
      const before = query.has('before') ? Number(query.get('before')) : Number.MAX_SAFE_INTEGER;
      if (!Number.isSafeInteger(before) || before < 1) return json({ code: 'ai_invalid_input' }, 400);
      return json(getAskEremiteThread(id, before));
    }
    const offset = Number(query.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return json({ code: 'ai_invalid_input' }, 400);
    return json({ threads: listAIThreads(offset), provider: getAIProviderStatus() });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) return json({ code: 'unauthorized' }, 401);
  // Match the application's authenticated internal-write origin boundary.
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    const source = origin ? new URL(origin) : null;
    const protocol = request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
    if (!source || source.host !== host || source.protocol !== `${protocol}:`) return json({ code: 'invalid_origin' }, 403);
  } catch { return json({ code: 'invalid_origin' }, 403); }
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ code: 'ai_invalid_input' }, 415);
  try {
    const parsed = command.safeParse(await readBoundedJSON(request));
    if (!parsed.success) return json({ code: 'ai_invalid_input' }, 400);
    const input = parsed.data;
    if (input.action === 'create') return json(createAIThread(), 201);
    if (input.action === 'stop') { stopAIChat(input.threadId, input.runId); return json({ ok: true }); }
    if (input.action === 'confirm_action_draft') return json(confirmAskEremiteActionDraft(input));
    if (input.action === 'reject_action_draft') return json(rejectAskEremiteActionDraft(input));
    if (input.action === 'apply_action_update') return json(applyAskEremiteActionUpdate(input));
    if (input.action === 'reject_action_update') return json(rejectAskEremiteActionUpdate(input));
    if (input.action === 'confirm_tool_run_proposal') return json(await confirmAskEremiteToolRun(input));
    if (input.action === 'reject_tool_run_proposal') return json(rejectAskEremiteToolRun(input));
    if (input.action === 'choose_action_target') return json(chooseAskEremiteActionTarget(input));
    if (!getAIProviderStatus().configured) return json({ code: 'ai_unavailable' }, 503);
    return await runAIChat({ ...input, abortSignal: request.signal }, createAskEremiteHost());
  } catch (error) { return failure(error); }
}

async function readBoundedJSON(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 48_000) { await reader.cancel(); throw new AIChatStoreError('ai_invalid_input'); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { reader.releaseLock(); }
}

function failure(error: unknown) {
  if (error instanceof AIChatStoreError) return json({ code: error.code }, error.code === 'ai_not_found' ? 404 : error.code === 'ai_invalid_input' ? 400 : 409);
  if (error instanceof AskEremiteContextError) return json({ code: 'ai_context_unavailable' }, 404);
  if (error instanceof AskEremiteActionDraftError) return json({ code: error.code }, error.code === 'ai_action_draft_not_found' ? 404 : error.code === 'ai_action_draft_not_allowed' ? 403 : 409);
  if (error instanceof AskEremiteActionUpdateError) return json({ code: error.code }, error.code === 'ai_action_update_not_found' ? 404 : error.code === 'ai_action_update_not_allowed' ? 403 : 409);
  if (error instanceof AskEremiteToolRunError) return json({ code: error.code }, error.code === 'ai_tool_run_not_found' ? 404 : error.code === 'ai_tool_run_internal_failure' ? 500 : 409);
  if (error instanceof Error && error.message === 'action_revision_conflict') return json({ code: 'action_revision_conflict' }, 409);
  if (error instanceof SyntaxError) return json({ code: 'ai_invalid_input' }, 400);
  return json({ code: 'ai_generation_failed' }, 500);
}
