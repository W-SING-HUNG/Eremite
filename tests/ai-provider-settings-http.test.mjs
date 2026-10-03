import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startAIChatFixture } from "./ai-chat-http-fixture.mjs";

const fixture = await startAIChatFixture({ configured: true, dev: process.env.EREMITE_HTTP_TEST_USE_BUILD !== '1' });
const key = randomBytes(32).toString("hex");
const probeKey = randomBytes(32).toString("hex");
const headers = { cookie: `eremite_session=${fixture.sessionId}`, origin: fixture.baseURL, "Content-Type": "application/json" };
const post = (action, options = {}) => fetch(`${fixture.baseURL}/api/settings/ai`, { method: "POST", headers: { ...headers, ...options.headers }, body: JSON.stringify(action) });
const read = () => fetch(`${fixture.baseURL}/api/settings/ai`, { headers });
const probeRequests = [];
const probePhases = [];
let capabilities = { text: true, structuredOutput: true, toolCalling: true };
const privateProviderDetails = { message: "raw-settings-provider-error", body: "private-settings-provider-body", stack: "private-settings-provider-stack", credential: probeKey, url: "https://private-provider.invalid/?key=" + probeKey };
const probe = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const parsed = JSON.parse(body);
  probeRequests.push(parsed.model);
  const tool = parsed.tool_choice !== undefined;
  const structured = parsed.response_format !== undefined;
  const phase = structured ? "structured" : parsed.tools?.[0]?.function?.name ?? "text";
  probePhases.push(phase);
  const capability = phase === "text" ? "text" : phase === "probe_location" ? "toolCalling" : "structuredOutput";
  if (!capabilities[capability]) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: privateProviderDetails }));
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ id: "probe", object: "chat.completion", created: 1, model: parsed.model, choices: [{ index: 0, message: tool
    ? { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "probe_location", arguments: '{"location":"Paris"}' } }] }
    : { role: "assistant", content: structured ? '{"status":"ok"}' : "ready" }, finish_reason: tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
});
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const probeURL = `http://127.0.0.1:${probe.address().port}`;

const profileSnapshot = () => {
  const database = new DatabaseSync(path.join(fixture.directory, "app.sqlite"), { readOnly: true });
  try { return database.prepare("SELECT value, updated_at FROM app_settings WHERE key = 'ai.provider.profile'").get() ?? null; }
  finally { database.close(); }
};
async function assertCandidateMatrix() {
  const before = await (await read()).json();
  const storedBefore = profileSnapshot();
  for (const [text, structuredOutput, toolCalling, success] of [
    [false, true, true, false], [true, false, true, false], [true, true, false, false],
    [false, false, true, false], [false, true, false, false], [true, false, false, false],
    [false, false, false, false], [true, true, true, true],
  ]) {
    capabilities = { text, structuredOutput, toolCalling };
    probeRequests.length = 0;
    probePhases.length = 0;
    const candidate = { action: "test", baseURL: probeURL, model: "mixed-candidate-model", apiKey: probeKey };
    assert.equal((await post(candidate, { headers: { cookie: "" } })).status, 401);
    for (const origin of ["", "https://attacker.invalid", fixture.baseURL.replace("http:", "https:")]) {
      assert.equal((await post(candidate, { headers: { origin } })).status, 403);
    }
    assert.deepEqual(probeRequests, [], "rejected auth/origin must not contact the candidate provider");
    const response = await post(candidate);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const responseText = await response.text();
    for (const privateValue of [key, probeKey, ...Object.values(privateProviderDetails)]) {
      assert.equal(responseText.includes(privateValue), false, "API must not expose provider details or credentials");
    }
    assert.deepEqual(JSON.parse(responseText), { text, structuredOutput, toolCalling, success });
    assert.deepEqual(probePhases, structuredOutput
      ? ["text", "structured", "probe_location"]
      : ["text", "structured", "eremite_structured_result", "probe_location"]);
    assert.ok(probeRequests.every(model => model === candidate.model));
    assert.deepEqual(await (await read()).json(), before, "candidate test leaves effective settings unchanged");
    assert.deepEqual(profileSnapshot(), storedBefore, "candidate test must not persist or replace the app profile");
  }
}

try {
  assert.equal((await fetch(`${fixture.baseURL}/api/settings/ai`)).status, 401);
  assert.equal((await post({ action: "revert" }, { headers: { origin: "https://attacker.invalid" } })).status, 403);
  assert.equal((await post({ action: "save", baseURL: probeURL, model: "first", apiKey: "", extra: true })).status, 400);
  const initial = await (await read()).json();
  assert.equal(initial.source, "environment");
  assert.equal(initial.model, "mock-model");
  assert.equal(initial.hasApiKey, true);
  assert.equal((await post({ action: "test", baseURL: probeURL, model: "probe", apiKey: "" })).status, 400);
  assert.equal((await post({ action: "save", baseURL: fixture.providerURL, model: "first-model", apiKey: "" })).status, 400);
  const tested = await (await post({ action: "test", baseURL: probeURL, model: "probe-model", apiKey: probeKey })).json();
  assert.deepEqual(tested, { text: true, structuredOutput: true, toolCalling: true, success: true });
  assert.deepEqual(probeRequests, ["probe-model", "probe-model", "probe-model"]);
  assert.equal((await read()).status, 200);
  assert.equal((await (await read()).json()).source, "environment", "testing a candidate must not save it");
  await assertCandidateMatrix();
  const savedResponse = await post({ action: "save", baseURL: fixture.providerURL, model: "first-model", apiKey: key });
  assert.equal(savedResponse.status, 200, await savedResponse.clone().text());
  const savedText = await (await read()).text();
  assert.equal(savedText.includes(key), false);
  assert.equal(savedText.includes(probeKey), false);
  assert.equal(JSON.parse(savedText).source, "app");
  assert.equal(JSON.parse(savedText).hasApiKey, true);
  await assertCandidateMatrix();
  const aiPost = body => fetch(`${fixture.baseURL}/api/ai`, { method: "POST", headers, body: JSON.stringify(body) });
  const thread = await (await aiPost({ action: "create" })).json();
  const inFlight = await aiPost({ action: "send", threadId: thread.id, expectedRevision: thread.revision, requestId: randomUUID(), text: "stop-probe", context: { kind: "global" } });
  assert.equal(inFlight.status, 200);
  const reader = inFlight.body.getReader();
  await reader.read();
  const next = await post({ action: "save", baseURL: fixture.providerURL, model: "second-model", apiKey: "" });
  assert.equal(next.status, 200, await next.clone().text());
  const database = new DatabaseSync(path.join(fixture.directory, "app.sqlite"), { readOnly: true });
  try {
    assert.equal(database.prepare("SELECT model FROM ai_runs ORDER BY created_at LIMIT 1").get().model, "first-model");
  } finally { database.close(); }
  await reader.cancel();
  const second = await (await aiPost({ action: "create" })).json();
  const latest = await aiPost({ action: "send", threadId: second.id, expectedRevision: second.revision, requestId: randomUUID(), text: "new model", context: { kind: "global" } });
  assert.equal(latest.status, 200);
  await latest.text();
  const database2 = new DatabaseSync(path.join(fixture.directory, "app.sqlite"), { readOnly: true });
  try { assert.ok(database2.prepare("SELECT 1 FROM ai_runs WHERE model = 'second-model'").get()); }
  finally { database2.close(); }
  const reverted = await post({ action: "revert" });
  assert.equal(reverted.status, 200, await reverted.clone().text());
  assert.equal((await (await read()).json()).source, "environment");
  assert.equal(fixture.output.join("").includes(key), false);
  assert.equal(fixture.output.join("").includes(probeKey), false);
  console.log("AI Settings HTTP gate passed: auth/origin, 8 capability combinations for environment and app settings, candidate non-persistence, private response, app override, in-flight snapshot, new model, revert.");
} finally {
  try {
    const database = new DatabaseSync(path.join(fixture.directory, "app.sqlite"), { readOnly: true });
    const row = database.prepare("SELECT value FROM app_settings WHERE key = 'ai.provider.profile'").get();
    database.close();
    if (row) {
      const { createWindowsSecretStore } = await import("@/platform/secrets/store");
      createWindowsSecretStore("AI").delete(JSON.parse(row.value).secretId);
    }
  } catch { /* The QA profile may already be reverted. */ }
  probe.closeAllConnections(); await new Promise(resolve => probe.close(resolve));
  await fixture.close();
}
