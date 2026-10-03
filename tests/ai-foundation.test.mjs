import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import {
  AIConfigurationError,
  readAIProviderConfig,
} from "@/modules/ai/config";
import { AIRuntimeError } from "@/modules/ai/contracts";
import { createOpenAICompatibleAIProvider } from "@/modules/ai/provider";
import { createAIRuntime } from "@/modules/ai/runtime";
import { createAITaskRunner, defineAITask } from "@/modules/ai/tasks";
import {
  RESERVED_READ_ONLY_AI_TOOL_NAMES,
  defineAITool,
} from "@/modules/ai/tools";

const usage = {
  inputTokens: {
    total: 2,
    noCache: 2,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: undefined,
  },
};

function modelResult(content, finishReason = "stop") {
  return {
    content,
    finishReason: { unified: finishReason, raw: undefined },
    usage,
    warnings: [],
  };
}

function fakeProvider(doGenerate) {
  return {
    id: "fake",
    modelId: "fake-model",
    languageModel: new MockLanguageModelV4({ doGenerate }),
  };
}

test("AI configuration reads only the explicit environment contract and never echoes secrets", () => {
  const secret = "unit-test-secret-value";
  const config = readAIProviderConfig({
    EREMITE_AI_BASE_URL: " https://provider.example/v1/ ",
    EREMITE_AI_API_KEY: ` ${secret} `,
    EREMITE_AI_MODEL: " model-name ",
  });
  assert.deepEqual(config, {
    baseURL: "https://provider.example/v1",
    apiKey: secret,
    model: "model-name",
  });

  assert.throws(
    () => readAIProviderConfig({
      EREMITE_AI_BASE_URL: "not a url",
      EREMITE_AI_API_KEY: secret,
      EREMITE_AI_MODEL: "model-name",
    }),
    (error) => {
      assert.ok(error instanceof AIConfigurationError);
      assert.equal(error.code, "ai_base_url_invalid");
      assert.equal(error.message, "ai_base_url_invalid");
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );

  assert.throws(
    () => readAIProviderConfig({
      EREMITE_AI_BASE_URL: "http://provider.example/v1",
      EREMITE_AI_API_KEY: secret,
      EREMITE_AI_MODEL: "model-name",
    }),
    (error) => error instanceof AIConfigurationError && error.code === "ai_base_url_invalid",
  );
  assert.equal(readAIProviderConfig({
    EREMITE_AI_BASE_URL: "http://127.0.0.1:1234/v1",
    EREMITE_AI_API_KEY: secret,
    EREMITE_AI_MODEL: "local-model",
  }).baseURL, "http://127.0.0.1:1234/v1");
});

test("AI runtime supports text and structured output through one provider abstraction", async () => {
  const textRuntime = createAIRuntime(fakeProvider(async () => modelResult([
    { type: "text", text: "foundation ready" },
  ])));
  assert.deepEqual(
    await textRuntime.generateText({ prompt: "status" }),
    { kind: "text", text: "foundation ready", finishReason: "stop" },
  );

  const structuredRuntime = createAIRuntime(fakeProvider(async () => modelResult([
    { type: "text", text: '{"status":"ok","count":1}' },
  ])));
  assert.deepEqual(
    await structuredRuntime.generateStructured({
      prompt: "return a status object",
      schema: z.object({ status: z.literal("ok"), count: z.number().int() }),
      schemaName: "FoundationStatus",
    }),
    { kind: "structured", value: { status: "ok", count: 1 }, finishReason: "stop" },
  );
});

test("AI runtime returns validated tool-call shape without executing a tool", async () => {
  const runtime = createAIRuntime(fakeProvider(async () => modelResult([
    {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "search_content",
      input: '{"query":"phase zero"}',
    },
  ], "tool-calls")));
  const searchTool = defineAITool({
    name: "search_content",
    description: "Search content through the Host read boundary.",
    inputSchema: z.object({ query: z.string() }),
  });

  const result = await runtime.generateToolCalls({
    prompt: "find phase zero",
    tools: [searchTool],
    toolChoice: { name: "search_content" },
  });
  assert.deepEqual(result, {
    kind: "tool-calls",
    text: "",
    calls: [{ id: "call-1", name: "search_content", input: { query: "phase zero" } }],
    finishReason: "tool-calls",
  });
});

test("AI runtime rejects invalid tool calls instead of leaking SDK error detail", async () => {
  const secret = "provider-must-not-echo-this";
  const runtime = createAIRuntime(fakeProvider(async () => modelResult([
    {
      type: "tool-call",
      toolCallId: "bad-call",
      toolName: "get_content",
      input: `{"id":7,"secret":"${secret}"}`,
    },
  ], "tool-calls")));

  await assert.rejects(
    () => runtime.generateToolCalls({
      prompt: "get content",
      tools: [defineAITool({
        name: "get_content",
        description: "Read one content item through the Host boundary.",
        inputSchema: z.object({ id: z.string() }),
      })],
    }),
    (error) => {
      assert.ok(error instanceof AIRuntimeError);
      assert.equal(error.code, "ai_tool_call_invalid");
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test("AI runtime reports an unmet forced tool choice without exposing model content", async () => {
  const secret = "model-text-must-not-cross-runtime-error";
  const runtime = createAIRuntime(fakeProvider(async () => modelResult([
    { type: "text", text: secret },
  ])));

  await assert.rejects(
    () => runtime.generateToolCalls({
      prompt: "call the probe",
      tools: [defineAITool({
        name: "phase0_probe",
        description: "Probe tool choice handling.",
        inputSchema: z.object({ value: z.string() }),
      })],
      toolChoice: { name: "phase0_probe" },
    }),
    (error) => {
      assert.ok(error instanceof AIRuntimeError);
      assert.equal(error.code, "ai_tool_choice_unsatisfied");
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test("task runner resolves Host-built context before entering the runtime", async () => {
  let receivedRequest;
  const runtime = {
    async generateText(request) {
      receivedRequest = request;
      return { kind: "text", text: "ok", finishReason: "stop" };
    },
    async generateStructured() {
      throw new Error("unexpected_structured_call");
    },
    async generateToolCalls() {
      throw new Error("unexpected_tool_call");
    },
  };
  const task = defineAITask({
    id: "foundation.context-probe",
    kind: "text",
    contextBuilder: {
      id: "foundation.fake-host-context",
      async build(input) {
        return {
          items: [{
            source: { module: "inbox", entity: "content", id: input.id, revision: 3 },
            title: "Safe service projection",
            content: "context from a fake public service",
          }],
        };
      },
    },
    createRequest({ input, context }) {
      return { prompt: `${input.question}\n${context.items[0].content}` };
    },
  });

  const result = await createAITaskRunner(runtime).run(task, { id: "content-1", question: "Summarize" });
  assert.deepEqual(result, { taskId: "foundation.context-probe", kind: "text", text: "ok", finishReason: "stop" });
  assert.equal(receivedRequest.prompt, "Summarize\ncontext from a fake public service");
});

test("OpenAI-compatible adapter sends the configured model and Authorization header", async () => {
  const observed = {};
  const config = readAIProviderConfig({
    EREMITE_AI_BASE_URL: "https://provider.example/v1",
    EREMITE_AI_API_KEY: "adapter-secret",
    EREMITE_AI_MODEL: "adapter-model",
  });
  const provider = createOpenAICompatibleAIProvider(config, {
    async fetch(input, init) {
      observed.url = String(input);
      observed.authorization = new Headers(init?.headers).get("authorization");
      observed.body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1,
        model: "adapter-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "adapter ok" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await createAIRuntime(provider).generateText({ prompt: "adapter probe" });
  assert.equal(result.text, "adapter ok");
  assert.equal(observed.url, "https://provider.example/v1/chat/completions");
  assert.equal(observed.authorization, "Bearer adapter-secret");
  assert.equal(observed.body.model, "adapter-model");
});

test("tool strict mode is provider-neutral unless a definition opts in", async () => {
  let requestBody;
  const config = readAIProviderConfig({
    EREMITE_AI_BASE_URL: "https://provider.example/v1",
    EREMITE_AI_API_KEY: "adapter-secret",
    EREMITE_AI_MODEL: "adapter-model",
  });
  const provider = createOpenAICompatibleAIProvider(config, {
    async fetch(_input, init) {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: "chatcmpl-tool-test",
        object: "chat.completion",
        created: 1,
        model: "adapter-model",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call-tool-test",
              type: "function",
              function: { name: "search_content", arguments: '{"query":"phase zero"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await createAIRuntime(provider).generateToolCalls({
    prompt: "find phase zero",
    tools: [defineAITool({
      name: "search_content",
      description: "Search content through the Host read boundary.",
      inputSchema: z.object({ query: z.string() }),
    })],
  });
  assert.equal(result.calls[0].name, "search_content");
  assert.equal(Object.hasOwn(requestBody.tools[0].function, "strict"), false);
});

test("provider failures cross the runtime boundary as secret-free errors", async () => {
  const secret = "secret-in-provider-error";
  const config = readAIProviderConfig({
    EREMITE_AI_BASE_URL: "https://provider.example/v1",
    EREMITE_AI_API_KEY: secret,
    EREMITE_AI_MODEL: "adapter-model",
  });
  const provider = createOpenAICompatibleAIProvider(config, {
    async fetch() {
      return new Response(JSON.stringify({ error: { message: `echo ${secret}` } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await assert.rejects(
    () => createAIRuntime(provider).generateText({ prompt: "safe failure" }),
    (error) => {
      assert.ok(error instanceof AIRuntimeError);
      assert.equal(error.message, "ai_generation_failed");
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test("AI module keeps SDK calls, SQLite, and environment secrets behind their owned boundaries", async () => {
  const aiRoot = path.join(process.cwd(), "src", "modules", "ai");
  const productionRoot = path.join(process.cwd(), "src");
  const names = (await readdir(aiRoot)).filter((name) => name.endsWith(".ts"));
  const sources = new Map(await Promise.all(names.map(async (name) => [
    name,
    await readFile(path.join(aiRoot, name), "utf8"),
  ])));

  assert.deepEqual(
    [...sources]
      .filter(([, source]) => /import\s*\{[^}]*\bgenerateText\b[^}]*\}\s*from\s*"ai"/su.test(source))
      .map(([name]) => name),
    ["runtime.ts"],
  );
  assert.deepEqual(
    [...sources].filter(([, source]) => source.includes("process.env")).map(([name]) => name),
    ["provider-settings.server.ts"],
  );
  for (const [name, source] of sources) {
    if (!["chat-contracts.ts", "chat-client.ts"].includes(name)) assert.equal(source.startsWith('import "server-only";'), true, name);
    assert.equal(source.includes("@/platform/db"), ["chat-store.ts", "tool-run-store.ts", "provider-settings.server.ts"].includes(name), name);
    assert.equal(source.includes("node:sqlite"), false);
    assert.equal(source.includes("@/modules/automations"), false);
  }
  const store = sources.get('chat-store.ts');
  for (const match of store.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/gu)) {
    assert.ok(['ai_threads', 'ai_messages', 'ai_runs', 'ai_message_sources', 'ai_message_activities', 'ai_message_action_drafts', 'ai_action_update_proposals', 'ai_action_disambiguations', 'ai_action_disambiguation_candidates'].includes(match[1]), `AI table ownership: ${match[1]}`);
  }
  for (const match of sources.get('tool-run-store.ts').matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/gu)) {
    assert.ok(['ai_tool_run_proposals', 'ai_runs', 'ai_messages'].includes(match[1]), `AI Tool proposal table ownership: ${match[1]}`);
  }
  for (const name of ['chat-client.ts', 'chat-contracts.ts']) {
    assert.doesNotMatch(sources.get(name), /process\.env|service\.server|\.\/provider|\.\/config|\.\/runtime|\.\/chat-store|@\/platform\/db/u);
  }
  assert.deepEqual(RESERVED_READ_ONLY_AI_TOOL_NAMES, [
    "search_content",
    "get_content",
    "get_project",
    "list_project_actions",
  ]);
  assert.ok(RESERVED_READ_ONLY_AI_TOOL_NAMES.every(name => !/(create|update|delete|trash|restore|move|write|run)/u.test(name)));

  const hostAdapter = await readFile(path.join(productionRoot, 'app', '_services', 'ask-eremite-host.ts'), 'utf8');
  for (const owner of ['inbox/service', 'projects/service', 'actions/service', 'search/service']) assert.ok(hostAdapter.includes(`@/modules/${owner}`));
  assert.doesNotMatch(hostAdapter, /@\/platform\/db|node:sqlite|\b(?:INSERT|UPDATE|DELETE)\b|from ['"]ai['"]|modules\/ai\/(?:provider|runtime)/u);
  const route = await readFile(path.join(productionRoot, 'app', 'api', 'ai', 'route.ts'), 'utf8');
  assert.doesNotMatch(route, /from ['"]ai['"]|modules\/ai\/(?:provider|runtime)/u);
  assert.match(sources.get('runtime.ts'), /stopWhen:\s*isStepCount\(5\)/u);

  const productionFiles = await collectFiles(productionRoot);
  const bypasses = [];
  for (const file of productionFiles.filter((candidate) => /\.[cm]?[jt]sx?$/u.test(candidate))) {
    if (file.startsWith(`${aiRoot}${path.sep}`)) continue;
    const source = await readFile(file, "utf8");
    if (
      /from\s*["'](?:ai|@ai-sdk\/)/u.test(source)
      || /@\/modules\/ai\/(?:provider(?!-(?:probe|settings))|runtime)/u.test(source)
    ) {
      bypasses.push(path.relative(productionRoot, file));
    }
  }
  assert.deepEqual(bypasses, []);
});

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(target) : [target];
  }))).flat();
}
