import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { AIRuntimeError } from "@/modules/ai/contracts";
import { createAIRuntime } from "@/modules/ai/runtime";

const name = "eremite_structured_result";
const schema = z.object({ status: z.literal("ok"), count: z.number().int() });
const request = { prompt: "Return the required object.", schema, schemaName: "FallbackProbe", maxOutputTokens: 128 };
const usage = { inputTokens: { total: 2, noCache: 2 }, outputTokens: { total: 1, text: 1 } };
const modelResult = (content, finishReason = "stop") => ({ content, finishReason: { unified: finishReason, raw: undefined }, usage, warnings: [] });
const call = (toolName, input, id = "call-1") => ({ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) });

function runtime(doGenerate) {
  return createAIRuntime({ id: "fake", modelId: "fake-model", languageModel: new MockLanguageModelV4({ doGenerate }) });
}

async function expectSafeFailure(generator) {
  await assert.rejects(generator, error => error instanceof AIRuntimeError && error.code === "ai_generation_failed" && error.message === "ai_generation_failed");
}

test("native structured success never enters the fallback", async () => {
  const options = [];
  const result = await runtime(async input => {
    options.push(input);
    return modelResult([{ type: "text", text: '{"status":"ok","count":1}' }]);
  }).generateStructured({ ...request, maxOutputTokens: 64 });
  assert.deepEqual(result, { kind: "structured", value: { status: "ok", count: 1 }, finishReason: "stop" });
  assert.equal(options.length, 1);
  assert.equal(options[0].maxOutputTokens, 64);
});

test("native failure accepts one schema-valid required internal tool call without execution", async () => {
  const options = [];
  const result = await runtime(async input => {
    options.push(input);
    if (options.length === 1) throw new Error("native-response-format-rejected");
    return modelResult([call(name, { status: "ok", count: 2 })], "tool-calls");
  }).generateStructured({ ...request, maxOutputTokens: 64 });
  assert.deepEqual(result, { kind: "structured", value: { status: "ok", count: 2 }, finishReason: "tool-calls" });
  assert.equal(options.length, 2, "no tool execution or model continuation");
  assert.equal(options[0].maxOutputTokens, 64, "native budget stays unchanged");
  assert.equal(options[1].maxOutputTokens, 128, "only fallback receives the minimum budget");
  assert.equal(options[1].toolChoice?.type, "required");
  assert.deepEqual(options[1].tools?.map(tool => tool.name), [name]);
  assert.equal(options[1].prompt.some(message => message.role === "tool"), false);
});

test("native failure plus invalid fallback arguments fails closed", async () => {
  let calls = 0;
  await expectSafeFailure(() => runtime(async () => {
    calls++;
    if (calls === 1) throw new Error("native-failed");
    return modelResult([call(name, { status: "ok", count: "two" })], "tool-calls");
  }).generateStructured(request));
  assert.equal(calls, 2);
});

test("wrong, absent and multiple fallback calls fail closed", async () => {
  for (const content of [
    [call("another_tool", { status: "ok", count: 1 })],
    [{ ...call(name, { status: "ok", count: 1 }), dynamic: true }],
    [{ type: "text", text: '{"status":"ok","count":1}' }],
    [call(name, { status: "ok", count: 1 }), call(name, { status: "ok", count: 2 }, "call-2")],
  ]) {
    let calls = 0;
    await expectSafeFailure(() => runtime(async () => {
      calls++;
      if (calls === 1) throw new Error("native-failed");
      return modelResult(content, content[0]?.type === "text" ? "stop" : "tool-calls");
    }).generateStructured(request));
  }
});

test("fallback rejects schema extras, omissions and malformed nested values", async () => {
  const strictSchema = z.object({ status: z.literal("ok"), detail: z.object({ count: z.number().int() }) });
  for (const value of [
    { status: "ok", detail: { count: 1 }, unexpected: true },
    { status: "ok", detail: { count: 1, extra: true } },
    { status: "ok", detail: {} },
    { status: "ok", detail: { count: "1" } },
  ]) {
    let calls = 0;
    await expectSafeFailure(() => runtime(async () => {
      calls++;
      if (calls === 1) throw new Error("native-failed");
      return modelResult([call(name, value)], "tool-calls");
    }).generateStructured({ ...request, schema: strictSchema }));
  }
});
