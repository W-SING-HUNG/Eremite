import "server-only";

import type { z } from "zod";
import type { AISource } from './chat-contracts';
import type { AIContextTarget } from './chat-contracts';

export const RESERVED_READ_ONLY_AI_TOOL_NAMES = [
  "search_content",
  "get_content",
  "get_project",
  "list_project_actions",
] as const;

export type ReservedReadOnlyAIToolName = (typeof RESERVED_READ_ONLY_AI_TOOL_NAMES)[number];
export const AI_DRAFT_WRITE_TOOL_NAME = "create_action_draft" as const;
export const AI_UPDATE_PROPOSAL_TOOL_NAME = 'propose_action_update' as const;
export const AI_TOOL_RUN_PROPOSAL_NAME = 'propose_tool_run' as const;

export type AIToolFailureCode =
  | 'ai_tool_invalid_arguments'
  | 'ai_tool_unobserved_content'
  | 'ai_tool_unobserved_project'
  | 'ai_tool_host_rejected'
  | 'ai_tool_ambiguous_target'
  | 'ai_tool_execution_failed';

/** Safe, provider-neutral classification. Never include raw validation or storage errors. */
export class AIToolExecutionError extends Error {
  constructor(public readonly code: AIToolFailureCode, public readonly diagnosticCode?: import('./chat-contracts').AIActivity['code']) {
    super(code);
    this.name = 'AIToolExecutionError';
  }
}

/** Provider-neutral model-facing metadata. Execution remains Host-owned. */
export type AIToolDefinition = Readonly<{
  name: string;
  description: string;
  inputSchema: z.ZodType;
  strict?: boolean;
}>;

export type AIReadOnlyToolExecutionContext = Readonly<{
  abortSignal?: AbortSignal;
}>;

export type AIChatToolExecutionContext = AIReadOnlyToolExecutionContext & Readonly<{
  identity: Readonly<{ threadId: string; runId: string; messageId: string }>;
  currentContext: AIContextTarget;
  observedSources: readonly AISource[];
  userRequest: string;
}>;

/**
 * Host adapter boundary. Implementations are read-only and must delegate
 * to existing Eremite public services rather than query owner tables directly.
 * The Runtime may invoke only adapters explicitly supplied for one bounded request.
 */
export interface AIReadOnlyToolAdapter<INPUT, OUTPUT> {
  readonly access: "read";
  readonly definition: AIToolDefinition & Readonly<{
    name: ReservedReadOnlyAIToolName;
    inputSchema: z.ZodType<INPUT>;
  }>;
  execute(input: INPUT, context?: AIReadOnlyToolExecutionContext): Promise<Readonly<{ data: OUTPUT; sources: readonly AISource[] }>>;
}

/** The only model-requestable Action Draft write. Tool Run requests persist proposals only. */
export interface AIDraftWriteToolAdapter<INPUT, OUTPUT> {
  readonly access: "draft-write";
  readonly definition: AIToolDefinition & Readonly<{
    name: typeof AI_DRAFT_WRITE_TOOL_NAME;
    inputSchema: z.ZodType<INPUT>;
  }>;
  execute(input: INPUT, context: AIChatToolExecutionContext): Promise<Readonly<{ data: OUTPUT; sources: readonly AISource[] }>>;
}

export interface AIUpdateProposalToolAdapter<INPUT, OUTPUT> {
  readonly access: 'update-proposal';
  readonly definition: AIToolDefinition & Readonly<{ name: typeof AI_UPDATE_PROPOSAL_TOOL_NAME; inputSchema: z.ZodType<INPUT> }>;
  execute(input: INPUT, context: AIChatToolExecutionContext): Promise<Readonly<{ data: OUTPUT; sources: readonly AISource[] }>>;
}

export interface AIToolRunProposalAdapter<INPUT, OUTPUT> {
  readonly access: 'tool-run-proposal';
  readonly definition: AIToolDefinition & Readonly<{ name: typeof AI_TOOL_RUN_PROPOSAL_NAME; inputSchema: z.ZodType<INPUT> }>;
  execute(input: INPUT, context: AIChatToolExecutionContext): Promise<Readonly<{ data: OUTPUT; sources: readonly AISource[] }>>;
}

export type AIChatToolAdapter<INPUT = any, OUTPUT = unknown> =
  | AIReadOnlyToolAdapter<INPUT, OUTPUT>
  | AIDraftWriteToolAdapter<INPUT, OUTPUT>
  | AIUpdateProposalToolAdapter<INPUT, OUTPUT>
  | AIToolRunProposalAdapter<INPUT, OUTPUT>;

export function defineAITool(definition: AIToolDefinition): AIToolDefinition {
  const name = definition.name.normalize("NFKC").trim();
  const description = definition.description.trim();
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(name)) throw new Error("ai_tool_name_invalid");
  if (!description) throw new Error("ai_tool_description_missing");
  return Object.freeze({ ...definition, name, description });
}
