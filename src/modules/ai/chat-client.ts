"use client";

import { DefaultChatTransport, readUIMessageStream } from 'ai';
import type { AIActivity, AIContextTarget } from './chat-contracts';

/** Uses the SDK's transport and UI message decoder; no application wire format. */
export async function consumeAIChat(input: {
  threadId: string; expectedRevision: number; requestId: string; text: string;
  context: AIContextTarget;
  signal: AbortSignal; onRun(runId: string): void; onText(id: string, text: string): void; onActivity(activity: AIActivity): void; onError(code: string): void;
}) {
  const transport = new DefaultChatTransport({
    api: '/api/ai',
    prepareSendMessagesRequest: () => ({ body: { action: 'send', threadId: input.threadId, expectedRevision: input.expectedRevision, requestId: input.requestId, text: input.text, context: input.context } }),
    async fetch(url, init) {
      const response = await fetch(url, init);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(typeof payload?.code === 'string' ? payload.code : 'ai_generation_failed');
      }
      const runId = response.headers.get('X-Eremite-Run-Id');
      if (runId) input.onRun(runId);
      return response;
    },
  });
  const stream = await transport.sendMessages({ trigger: 'submit-message', chatId: input.threadId, messageId: undefined, messages: [], abortSignal: input.signal });
  let seenActivities = 0;
  for await (const message of readUIMessageStream({ stream, onError: error => input.onError(error instanceof Error ? error.message : 'ai_generation_failed') })) {
    const activities = message.parts.filter(part => part.type === 'data-activity');
    for (const part of activities.slice(seenActivities)) {
      if (part.type !== 'data-activity') continue;
      const data = part.data as AIActivity;
      if (['search', 'content', 'project', 'actions', 'draft', 'update', 'tool-run'].includes(data?.kind) && (data.state === 'started' || data.state === 'succeeded' || data.state === 'failed' || data.state === 'needs_input')) input.onActivity(data);
    }
    seenActivities = activities.length;
    input.onText(message.id, message.parts.filter(part => part.type === 'text').map(part => part.text).join(''));
  }
}
