import "server-only";
import type { AISource, AIContextTarget } from './chat-contracts';

/**
 * A data-only context item safe to pass into an AI task. Context builders must
 * obtain these values through the owning Eremite module's public service; they
 * must never expose database handles or let an AI runtime query SQLite.
 */
export type AIContextItem = Readonly<{
  source: Readonly<{
    module: string;
    entity: string;
    id: string;
    revision?: number;
  }>;
  title?: string;
  content: string;
}>;

export type AIContext = Readonly<{
  items: readonly AIContextItem[];
}>;

export type AIResolvedChatContext = Readonly<{ target: AIContextTarget; prompt: string; sources: readonly AISource[] }>;

export interface AIChatHost {
  resolveContext(target: AIContextTarget, options?: AIContextBuildOptions): Promise<AIResolvedChatContext>;
  readonly tools: readonly import('./tools').AIChatToolAdapter[];
}

export type AIContextBuildOptions = Readonly<{
  abortSignal?: AbortSignal;
}>;

/** Host-owned boundary from task input to service-backed, data-only context. */
export interface AIContextBuilder<INPUT> {
  readonly id: string;
  build(input: INPUT, options?: AIContextBuildOptions): Promise<AIContext>;
}

export const EMPTY_AI_CONTEXT: AIContext = Object.freeze({ items: Object.freeze([]) });
