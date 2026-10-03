import "server-only";

import { readEffectiveAIConfig, getAISettings } from "@/modules/ai/provider-settings.server";
import { beginAIRun, checkpointAIMessage, finishAIRun, getAIThread, getAIRunIdentity } from '@/modules/ai/chat-store';
import type { AIContextBuildOptions, AIChatHost } from '@/modules/ai/context';
import type { AIProviderStatus, AIContextTarget } from '@/modules/ai/chat-contracts';
import { createOpenAICompatibleAIProvider } from "@/modules/ai/provider";
import { createAIRuntime } from "@/modules/ai/runtime";
import {
  createAITaskRunner,
  type AITaskInput,
  type AITaskResult,
  type AnyAITask,
} from "@/modules/ai/tasks";

/** Resolve a fresh snapshot for every task, including after a settings change. */
export function runAITask<TASK extends AnyAITask>(task: TASK, input: AITaskInput<TASK>, options?: AIContextBuildOptions): Promise<AITaskResult<TASK>> {
  const runner = createAITaskRunner(
    createAIRuntime(
      createOpenAICompatibleAIProvider(readEffectiveAIConfig()),
    ),
  );
  return runner.run(task, input, options);
}

export { createAIThread, listAIThreads, getAIThread, AIChatStoreError } from '@/modules/ai/chat-store';

const activeRuns = new Map<string, AbortController>();

export function getAIProviderStatus(): AIProviderStatus {
  const settings = getAISettings();
  return { configured: settings.configured, model: settings.configured ? settings.model : null };
}

export async function runAIChat(input: { threadId: string; expectedRevision: number; requestId: string; text: string; context: AIContextTarget; abortSignal: AbortSignal }, host: AIChatHost): Promise<Response> {
  const config = readEffectiveAIConfig();
  const runtime = createAIRuntime(createOpenAICompatibleAIProvider(config));
  const resolvedContext = await host.resolveContext(input.context, { abortSignal: input.abortSignal });
  const identity = beginAIRun({ ...input, model: config.model, deadlineAt: new Date(Date.now() + 100_000).toISOString() });
  const controller = new AbortController();
  activeRuns.set(identity.runId, controller);
  const abortSignal = AbortSignal.any([input.abortSignal, controller.signal]);
  const recent = getAIThread(input.threadId).messages.filter(message => message.content && (message.role === 'user' || message.status === 'completed')).slice(-30);
  let budget = 48_000;
  const messages = recent.reverse().map(message => {
    const content = message.content.slice(0, Math.max(0, budget)); budget -= content.length;
    return { role: message.role, content };
  }).filter(message => message.content).reverse();
  try {
    const response = runtime.streamChat({
      messageId: identity.assistantId, runId: identity.runId, threadId: identity.threadId, messages, context: resolvedContext, tools: host.tools, abortSignal,
      onCheckpoint: content => checkpointAIMessage(identity.runId, content),
      onComplete(result) {
        try {
          try { finishAIRun({ runId: identity.runId, ...result }); }
          catch { // Activity storage must not recast a completed Host tool as a tool failure.
            finishAIRun({ runId: identity.runId, ...result, activities: [] });
          }
        }
        finally { activeRuns.delete(identity.runId); }
      },
    });
    response.headers.set('X-Eremite-Run-Id', identity.runId);
    response.headers.set('X-Eremite-Message-Id', identity.assistantId);
    return response;
  } catch {
    activeRuns.delete(identity.runId);
    finishAIRun({ runId: identity.runId, status: 'failed', errorCode: 'ai_generation_failed' });
    throw new Error('ai_generation_failed');
  }
}

export function stopAIChat(threadId: string, runId: string) {
  const run = getAIRunIdentity(threadId, runId);
  if (!run || run.status !== 'running') return;
  activeRuns.get(runId)?.abort();
  // The stream owns final persistence. A missing controller indicates a server
  // restart; preserve its last durable checkpoint and release the thread.
  if (!activeRuns.has(runId)) finishAIRun({ runId, status: 'cancelled', errorCode: 'ai_cancelled' });
}
