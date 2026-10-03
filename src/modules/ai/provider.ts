import "server-only";

import { createOpenAICompatible, type OpenAICompatibleProviderSettings } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { AIProviderConfig } from "@/modules/ai/config";

export interface AILanguageModelProvider {
  readonly id: string;
  readonly modelId: string;
  readonly languageModel: LanguageModel;
}

export type AIProviderAdapterOptions = Readonly<{
  fetch?: OpenAICompatibleProviderSettings["fetch"];
}>;

/** Generic OpenAI-compatible adapter without provider-specific policy. */
export function createOpenAICompatibleAIProvider(
  config: AIProviderConfig,
  options: AIProviderAdapterOptions = {},
): AILanguageModelProvider {
  const provider = createOpenAICompatible({
    name: "eremiteOpenAICompatible",
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    supportsStructuredOutputs: true,
    fetch: options.fetch,
  });

  return Object.freeze({
    id: "openai-compatible",
    modelId: config.model,
    languageModel: provider(config.model),
  });
}
