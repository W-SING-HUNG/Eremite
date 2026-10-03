import "server-only";

import type {
  AIRuntime,
  AIStructuredGenerationRequest,
  AIStructuredGenerationResult,
  AITextGenerationRequest,
  AITextGenerationResult,
  AIToolGenerationRequest,
  AIToolGenerationResult,
} from "@/modules/ai/contracts";
import { EMPTY_AI_CONTEXT, type AIContext, type AIContextBuilder, type AIContextBuildOptions } from "@/modules/ai/context";

type AITaskRequestFactoryArguments<INPUT> = Readonly<{
  input: INPUT;
  context: AIContext;
}>;

type AITaskBase<INPUT> = Readonly<{
  id: string;
  contextBuilder?: AIContextBuilder<INPUT>;
}>;

export type AITextTask<INPUT> = AITaskBase<INPUT> & Readonly<{
  kind: "text";
  createRequest(arguments_: AITaskRequestFactoryArguments<INPUT>): AITextGenerationRequest | Promise<AITextGenerationRequest>;
}>;

export type AIStructuredTask<INPUT, OUTPUT> = AITaskBase<INPUT> & Readonly<{
  kind: "structured";
  createRequest(arguments_: AITaskRequestFactoryArguments<INPUT>): AIStructuredGenerationRequest<OUTPUT> | Promise<AIStructuredGenerationRequest<OUTPUT>>;
}>;

export type AIToolTask<INPUT> = AITaskBase<INPUT> & Readonly<{
  kind: "tool-calls";
  createRequest(arguments_: AITaskRequestFactoryArguments<INPUT>): AIToolGenerationRequest | Promise<AIToolGenerationRequest>;
}>;

export type AnyAITask = AITextTask<any> | AIStructuredTask<any, any> | AIToolTask<any>;

export type AITaskInput<TASK extends AnyAITask> = TASK extends AITextTask<infer INPUT>
  ? INPUT
  : TASK extends AIStructuredTask<infer INPUT, any>
    ? INPUT
    : TASK extends AIToolTask<infer INPUT>
      ? INPUT
      : never;

export type AITaskResult<TASK extends AnyAITask> = Readonly<{ taskId: string }> & (
  TASK extends AITextTask<any>
    ? AITextGenerationResult
    : TASK extends AIStructuredTask<any, infer OUTPUT>
      ? AIStructuredGenerationResult<OUTPUT>
      : TASK extends AIToolTask<any>
        ? AIToolGenerationResult
        : never
);

export interface AITaskRunner {
  run<TASK extends AnyAITask>(task: TASK, input: AITaskInput<TASK>, options?: AIContextBuildOptions): Promise<AITaskResult<TASK>>;
}

export function defineAITask<TASK extends AnyAITask>(task: TASK): TASK {
  const id = task.id.normalize("NFKC").trim();
  if (!/^[a-z][a-z0-9.-]{0,95}$/u.test(id)) throw new Error("ai_task_id_invalid");
  return Object.freeze({ ...task, id }) as unknown as TASK;
}

export function createAITaskRunner(runtime: AIRuntime): AITaskRunner {
  return Object.freeze({
    async run<TASK extends AnyAITask>(task: TASK, input: AITaskInput<TASK>, options: AIContextBuildOptions = {}): Promise<AITaskResult<TASK>> {
      options.abortSignal?.throwIfAborted();
      const context = task.contextBuilder
        ? await task.contextBuilder.build(input, options)
        : EMPTY_AI_CONTEXT;
      options.abortSignal?.throwIfAborted();
      const created = await task.createRequest({ input, context });
      const signals = [options.abortSignal, created.abortSignal].filter((signal): signal is AbortSignal => Boolean(signal));
      const request = { ...created, ...(signals.length ? { abortSignal: AbortSignal.any(signals) } : {}) };
      request.abortSignal?.throwIfAborted();

      const result = task.kind === "text"
        ? await runtime.generateText(request as AITextGenerationRequest)
        : task.kind === "structured"
          ? await runtime.generateStructured(request as AIStructuredGenerationRequest<unknown>)
          : await runtime.generateToolCalls(request as AIToolGenerationRequest);

      return Object.freeze({ taskId: task.id, ...result }) as unknown as AITaskResult<TASK>;
    },
  });
}
