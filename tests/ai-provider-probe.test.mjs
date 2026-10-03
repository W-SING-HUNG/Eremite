import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { testAIProviderConnection } from "@/modules/ai/provider-probe.server";
import { probeDiagnostics } from "@/app/_components/ai-probe-diagnostics";

// Exhaustive capability truth table, shared by the helper and real HTTP probe assertions below.
const capabilityCases = [
  { text: false, structuredOutput: true, toolCalling: true, success: false, failed: ["text"] },
  { text: true, structuredOutput: false, toolCalling: true, success: false, failed: ["structuredOutput"] },
  { text: true, structuredOutput: true, toolCalling: false, success: false, failed: ["toolCalling"] },
  { text: false, structuredOutput: false, toolCalling: true, success: false, failed: ["text", "structuredOutput"] },
  { text: false, structuredOutput: true, toolCalling: false, success: false, failed: ["text", "toolCalling"] },
  { text: true, structuredOutput: false, toolCalling: false, success: false, failed: ["structuredOutput", "toolCalling"] },
  { text: false, structuredOutput: false, toolCalling: false, success: false, failed: ["text", "structuredOutput", "toolCalling"] },
  { text: true, structuredOutput: true, toolCalling: true, success: true, failed: [] },
];
const diagnosticMessages = {
  text: "Text 未通过：可检查 Base URL、Model ID、凭据和网络连接。",
  structuredOutput: "Structured Output 未通过：可检查模型是否支持严格结构化输出或工具调用回退。",
  toolCalling: "Tool Calling 未通过：可检查模型和服务是否支持强制工具调用。",
};

for (const { failed, ...expected } of capabilityCases) {
  const label = [expected.text, expected.structuredOutput, expected.toolCalling].map(value => value ? "PASS" : "FAIL").join(" / ");
  test("probeDiagnostics fixed messages for " + label, () => {
    const input = { ...expected };
    for (const field of ["providerError", "responseBody", "stack", "apiKey", "credential", "url", "cause"]) {
      Object.defineProperty(input, field, { enumerable: true, get() { throw new Error("provider details must not be read"); } });
    }
    assert.deepEqual(probeDiagnostics(input), failed.map(name => diagnosticMessages[name]));
  });

  test("connection probe independently checks " + label, async () => {
    const phases = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body);
      const toolName = parsed.tools?.[0]?.function?.name;
      const phase = parsed.response_format !== undefined ? "structured" : toolName ?? "text";
      phases.push(phase);
      const capability = phase === "text" ? "text" : phase === "probe_location" ? "toolCalling" : "structuredOutput";
      if (!expected[capability]) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "raw-matrix-provider-error", body: "private-provider-body", stack: "private-stack", credential: "matrix-key", url: "https://private.invalid/?key=matrix-key" } }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: "matrix", object: "chat.completion", created: 1, model: parsed.model, choices: [{ index: 0,
        message: toolName ? { role: "assistant", content: null, tool_calls: [{ id: "matrix-call", type: "function", function: { name: toolName, arguments: '{"location":"Paris"}' } }] }
          : { role: "assistant", content: phase === "structured" ? '{"status":"ok"}' : "ready" },
        finish_reason: toolName ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const result = await testAIProviderConnection({ baseURL: "http://127.0.0.1:" + server.address().port, model: "matrix-model", apiKey: "matrix-key" });
      assert.deepEqual(result, expected, "only the four capability/success booleans may escape the probe");
      assert.deepEqual(phases, expected.structuredOutput
        ? ["text", "structured", "probe_location"]
        : ["text", "structured", "eremite_structured_result", "probe_location"], "failed probes must not skip later capabilities or bypass strict structured fallback");
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
}

test("failed probe diagnostics use only capability booleans and expose no provider details", async () => {
  const secret = "raw-provider-secret-in-error";
  const server = createServer(async (_request, response) => {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: secret, url: `https://provider.example/?key=${secret}`, stack: secret } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await testAIProviderConnection({ baseURL: `http://127.0.0.1:${server.address().port}`, model: "probe-model", apiKey: secret });
    assert.deepEqual(result, { text: false, structuredOutput: false, toolCalling: false, success: false });
    const diagnostics = probeDiagnostics({ ...result, providerError: secret, url: secret, stack: secret });
    assert.equal(diagnostics.length, 3);
    assert.ok(diagnostics.every(value => value.includes("可检查")));
    assert.doesNotMatch(JSON.stringify({ result, diagnostics }), /raw-provider-secret|provider\.example|https:\/\//u);
    assert.deepEqual(probeDiagnostics({ text: true, structuredOutput: true, toolCalling: true, success: true }), []);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("connection probe uses production text, structured and tool contracts without persistence", async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body);
    const tool = parsed.tool_choice !== undefined;
    const structured = parsed.response_format !== undefined;
    requests.push({ model: parsed.model, authorization: request.headers.authorization,
      phase: tool ? "tool" : structured ? "structured" : "text",
      maxTokens: parsed.max_tokens, toolChoice: parsed.tool_choice });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "probe", object: "chat.completion", created: 1, model: parsed.model, choices: [{ index: 0, message: tool
      ? { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "probe_location", arguments: '{"location":"Paris"}' } }] }
      : { role: "assistant", content: structured ? '{"status":"ok"}' : "ready" }, finish_reason: tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await testAIProviderConnection({ baseURL: `http://127.0.0.1:${server.address().port}`, model: "probe-model", apiKey: "probe-secret" });
    assert.deepEqual(result, { text: true, structuredOutput: true, toolCalling: true, success: true });
    assert.equal(requests.length, 3);
    assert.ok(requests.every(value => value.model === "probe-model" && value.authorization === "Bearer probe-secret"));
    assert.deepEqual(requests.map(value => value.phase), ["text", "structured", "tool"]);
    assert.deepEqual(requests.map(value => value.maxTokens), [128, 128, 128]);
    assert.equal(requests[2].toolChoice, "required");
    assert.equal(JSON.stringify(result).includes("probe-secret"), false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("connection probe counts strict tool-schema fallback as effective structured capability", { timeout: 30_000 }, async () => {
  let fallbackInput = '{"status":"ok"}';
  let delayFirstFallback = true;
  const calls = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body);
    const toolName = parsed.tools?.[0]?.function?.name;
    calls.push({ phase: parsed.response_format !== undefined ? "native" : toolName ?? "text",
      maxTokens: parsed.max_tokens, toolChoice: parsed.tool_choice });
    if (parsed.response_format !== undefined) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "untrusted-provider-error" } }));
      return;
    }
    const tool = toolName !== undefined;
    const input = toolName === "eremite_structured_result" ? fallbackInput : '{"location":"Paris"}';
    if (toolName === "eremite_structured_result" && delayFirstFallback) {
      delayFirstFallback = false;
      await new Promise(resolve => setTimeout(resolve, 10_500));
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "probe", object: "chat.completion", created: 1, model: parsed.model, choices: [{ index: 0,
      message: tool ? { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: toolName, arguments: input } }] } : { role: "assistant", content: "ready" },
      finish_reason: tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const config = { baseURL: `http://127.0.0.1:${server.address().port}`, model: "probe-model", apiKey: "probe-secret" };
    assert.deepEqual(await testAIProviderConnection(config), { text: true, structuredOutput: true, toolCalling: true, success: true });
    assert.deepEqual(calls.map(call => call.phase), ["text", "native", "eremite_structured_result", "probe_location"]);
    assert.deepEqual(calls.map(call => call.maxTokens), [128, 128, 128, 128]);
    assert.equal(calls[2].toolChoice, "required");
    calls.length = 0;
    fallbackInput = '{"status":"wrong"}';
    assert.deepEqual(await testAIProviderConnection(config), { text: true, structuredOutput: false, toolCalling: true, success: false });
    assert.deepEqual(calls.map(call => call.phase), ["text", "native", "eremite_structured_result", "probe_location"]);
    calls.length = 0;
    fallbackInput = '{"status":"ok","extra":true}';
    assert.deepEqual(await testAIProviderConnection(config), { text: true, structuredOutput: false, toolCalling: true, success: false });
    assert.deepEqual(calls.map(call => call.phase), ["text", "native", "eremite_structured_result", "probe_location"]);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

for (const scenario of [
  { name: "wrong tool name", calls: [{ name: "other_location", arguments: '{"location":"Paris"}' }] },
  { name: "invalid tool input", calls: [{ name: "probe_location", arguments: '{"location":""}' }] },
  { name: "multiple tool calls", calls: [
    { name: "probe_location", arguments: '{"location":"Paris"}' },
    { name: "probe_location", arguments: '{"location":"Lyon"}' },
  ] },
]) {
  test(`connection probe rejects ${scenario.name}`, async () => {
    const phases = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body);
      const tool = parsed.tool_choice !== undefined;
      const structured = parsed.response_format !== undefined;
      phases.push(tool ? "tool" : structured ? "structured" : "text");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: "probe", object: "chat.completion", created: 1, model: parsed.model, choices: [{ index: 0,
        message: tool ? { role: "assistant", content: null, tool_calls: scenario.calls.map((call, index) => ({
          id: `call-${index + 1}`, type: "function", function: call,
        })) } : { role: "assistant", content: structured ? '{"status":"ok"}' : "ready" },
        finish_reason: tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const result = await testAIProviderConnection({ baseURL: `http://127.0.0.1:${server.address().port}`, model: "probe-model", apiKey: "probe-secret" });
      assert.deepEqual(result, { text: true, structuredOutput: true, toolCalling: false, success: false });
      assert.deepEqual(phases, ["text", "structured", "tool"]);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
}

test("connection probe allows each capability over the old ten-second timeout", { timeout: 75_000 }, async () => {
  const phases = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body);
    const tool = parsed.tool_choice !== undefined;
    const structured = parsed.response_format !== undefined;
    phases.push(tool ? "tool" : structured ? "structured" : "text");
    await new Promise(resolve => setTimeout(resolve, 10_500));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "probe", object: "chat.completion", created: 1, model: parsed.model, choices: [{ index: 0,
      message: tool ? { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "probe_location", arguments: '{"location":"Paris"}' } }] }
        : { role: "assistant", content: structured ? '{"status":"ok"}' : "ready" },
      finish_reason: tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await testAIProviderConnection({ baseURL: `http://127.0.0.1:${server.address().port}`, model: "probe-model", apiKey: "probe-secret" });
    assert.deepEqual(result, { text: true, structuredOutput: true, toolCalling: true, success: true });
    assert.deepEqual(phases, ["text", "structured", "tool"]);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
