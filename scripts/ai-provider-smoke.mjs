import { z } from "zod";

import { readAIProviderConfig } from "@/modules/ai/config";
import { createOpenAICompatibleAIProvider } from "@/modules/ai/provider";
import { createAIRuntime } from "@/modules/ai/runtime";
import { createAITaskRunner, defineAITask } from "@/modules/ai/tasks";
import { defineAITool } from "@/modules/ai/tools";

const timeoutMs = 120_000;

try {
  const config = readAIProviderConfig(process.env);
  const runner = createAITaskRunner(createAIRuntime(createOpenAICompatibleAIProvider(config)));

  const textResult = await runner.run(defineAITask({
    id: "smoke.text",
    kind: "text",
    createRequest() {
      return {
        prompt: "Reply with a short acknowledgement that the Eremite AI Foundation smoke test is ready.",
        maxOutputTokens: 64,
        timeoutMs,
      };
    },
  }), undefined);
  if (!textResult.text.trim()) throw new Error("ai_smoke_text_empty");
  console.log("AI smoke text: PASS");

  const structuredResult = await runner.run(defineAITask({
    id: "smoke.structured",
    kind: "structured",
    createRequest() {
      return {
        prompt: 'Return status "ok" and phase "phase-0" using the required schema.',
        schema: z.object({
          status: z.literal("ok"),
          phase: z.literal("phase-0"),
        }),
        schemaName: "EremiteFoundationSmoke",
        maxOutputTokens: 64,
        timeoutMs,
      };
    },
  }), undefined);
  if (structuredResult.value.status !== "ok" || structuredResult.value.phase !== "phase-0") {
    throw new Error("ai_smoke_structured_shape_invalid");
  }
  console.log("AI smoke structured: PASS");

  const probeTool = defineAITool({
    name: "get_weather",
    description: "Get the current weather for a location. The answer is unavailable without this tool.",
    inputSchema: z.object({ location: z.string() }),
  });
  const toolResult = await runner.run(defineAITask({
    id: "smoke.tool-shape",
    kind: "tool-calls",
    createRequest() {
      return {
        prompt: "What is the current weather in Paris? Use the get_weather tool; do not guess or answer with text.",
        tools: [probeTool],
        toolChoice: "required",
        maxOutputTokens: 512,
        timeoutMs,
      };
    },
  }), undefined);
  const [call] = toolResult.calls;
  if (toolResult.calls.length === 0) throw new Error("ai_smoke_tool_call_missing");
  if (toolResult.calls.length !== 1) throw new Error("ai_smoke_tool_call_count_invalid");
  if (!call?.id) throw new Error("ai_smoke_tool_call_id_missing");
  if (call.name !== "get_weather") throw new Error("ai_smoke_tool_name_invalid");
  if (typeof call.input !== "object" || call.input === null) throw new Error("ai_smoke_tool_input_invalid");
  if (typeof call.input.location !== "string" || !call.input.location.trim()) {
    throw new Error("ai_smoke_tool_value_invalid");
  }
  console.log("AI smoke tool-call shape: PASS");
} catch (error) {
  const safeCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : error instanceof Error && /^ai_[a-z0-9_]+$/u.test(error.message)
      ? error.message
      : "ai_smoke_failed";
  console.error(`AI smoke FAIL: ${safeCode}`);
  process.exitCode = 1;
}
