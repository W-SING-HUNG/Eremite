import "server-only";

import { z } from "zod";
import type { AIProviderConfig } from "@/modules/ai/config";
import { createOpenAICompatibleAIProvider } from "@/modules/ai/provider";
import { createAIRuntime } from "@/modules/ai/runtime";
import { defineAITool } from "@/modules/ai/tools";

export async function testAIProviderConnection(config: AIProviderConfig) {
  const runtime = createAIRuntime(createOpenAICompatibleAIProvider(config));
  const timeoutMs = 20_000;
  const result = { text: false, structuredOutput: false, toolCalling: false };
  try {
    const text = await runtime.generateText({ prompt: "Reply with the word ready.", maxOutputTokens: 128, timeoutMs });
    result.text = Boolean(text.text.trim());
  } catch { /* Only capability status is exposed. */ }
  try {
    const structured = await runtime.generateStructured({
      prompt: 'Return status "ok" in the required schema.',
      schema: z.object({ status: z.literal("ok") }), schemaName: "EremiteConnectionProbe",
      maxOutputTokens: 128, timeoutMs,
    });
    result.structuredOutput = structured.value.status === "ok";
  } catch { /* Only capability status is exposed. */ }
  try {
    const tool = defineAITool({ name: "probe_location", description: "Use this tool to give a location.", inputSchema: z.object({ location: z.string().min(1) }) });
    const calls = await runtime.generateToolCalls({ prompt: "Use probe_location for Paris. Do not answer in text.", tools: [tool], toolChoice: "required", maxOutputTokens: 128, timeoutMs });
    const input = calls.calls[0]?.input as { location?: unknown } | undefined;
    result.toolCalling = calls.calls.length === 1 && calls.calls[0]?.name === "probe_location" && typeof input?.location === "string";
  } catch { /* Only capability status is exposed. */ }
  return { ...result, success: result.text && result.structuredOutput && result.toolCalling };
}
