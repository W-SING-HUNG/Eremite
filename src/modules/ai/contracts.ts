import "server-only";

import type { z } from "zod";
import type { AIToolDefinition } from "@/modules/ai/tools";
import type { AIChatErrorCode } from './chat-contracts';
import type { AISource, AIDurableActivity } from './chat-contracts';
import type { AIResolvedChatContext } from './context';
import type { AIChatToolAdapter } from './tools';

export type AIChatStreamRequest = Readonly<{
  messageId: string;
  runId: string;
  threadId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  context: AIResolvedChatContext;
  tools: readonly AIChatToolAdapter[];
  abortSignal: AbortSignal;
  timeoutMs?: number;
  onCheckpoint(content: string): void;
  onComplete(result: { content: string; status: 'completed' | 'cancelled' | 'failed'; errorCode?: AIChatErrorCode; inputTokens?: number; outputTokens?: number; sources?: readonly AISource[]; activities?: readonly AIDurableActivity[] }): void;
}>;

export type AIPrompt = Readonly<{
  instructions?: string;
  prompt: string;
}>;

export type AIRequestOptions = Readonly<{
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
  timeoutMs?: number;
}>;

export type AITextGenerationRequest = AIPrompt & AIRequestOptions;

export type AIStructuredGenerationRequest<OUTPUT> = AIPrompt & AIRequestOptions & Readonly<{
  schema: z.ZodType<OUTPUT>;
  schemaName?: string;
  schemaDescription?: string;
}>;

export type AIToolChoice = "auto" | "required" | Readonly<{ name: string }>;

export type AIToolGenerationRequest = AIPrompt & AIRequestOptions & Readonly<{
  tools: readonly AIToolDefinition[];
  toolChoice?: AIToolChoice;
}>;

export type AIFinishReason = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";

export type AITextGenerationResult = Readonly<{
  kind: "text";
  text: string;
  finishReason: AIFinishReason;
}>;

export type AIStructuredGenerationResult<OUTPUT> = Readonly<{
  kind: "structured";
  value: OUTPUT;
  finishReason: AIFinishReason;
}>;

export type AIToolCall = Readonly<{
  id: string;
  name: string;
  input: unknown;
}>;

export type AIToolGenerationResult = Readonly<{
  kind: "tool-calls";
  text: string;
  calls: readonly AIToolCall[];
  finishReason: AIFinishReason;
}>;

export interface AIRuntime {
  streamChat(request: AIChatStreamRequest): Response;
  generateText(request: AITextGenerationRequest): Promise<AITextGenerationResult>;
  generateStructured<OUTPUT>(request: AIStructuredGenerationRequest<OUTPUT>): Promise<AIStructuredGenerationResult<OUTPUT>>;
  generateToolCalls(request: AIToolGenerationRequest): Promise<AIToolGenerationResult>;
}

export type AIRuntimeErrorCode =
  | "ai_generation_failed"
  | "ai_tool_call_invalid"
  | "ai_tool_choice_unsatisfied";

/** Safe public error: provider bodies, prompts, and credentials are not retained. */
export class AIRuntimeError extends Error {
  readonly code: AIRuntimeErrorCode;

  constructor(code: AIRuntimeErrorCode) {
    super(code);
    this.name = "AIRuntimeError";
    this.code = code;
  }
}
