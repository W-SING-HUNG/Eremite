import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineAITask } from "@/modules/ai/tasks";

const directory = await mkdtemp(path.join(tmpdir(), "eremite-ai-task-refresh-"));
process.env.EREMITE_DATA_DIR = directory;
const models = [];
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const parsed = JSON.parse(body);
  models.push(parsed.model);
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ id: "task-refresh", object: "chat.completion", created: 1, model: parsed.model, choices: [{ index: 0, message: { role: "assistant", content: "ready" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const baseURL = `http://127.0.0.1:${server.address().port}`;
process.env.EREMITE_AI_BASE_URL = baseURL;
process.env.EREMITE_AI_API_KEY = "qa-environment-only";
process.env.EREMITE_AI_MODEL = "environment-model";
const { runAITask } = await import("@/modules/ai/service.server");
const { saveAISettings, revertAISettings } = await import("@/modules/ai/provider-settings.server");
const { createWindowsSecretStore } = await import("@/platform/secrets/store");
const { db } = await import("@/platform/db/database");
const task = defineAITask({ id: "qa.refresh", kind: "text", createRequest: () => ({ prompt: "Say ready.", maxOutputTokens: 32 }) });
try {
  assert.equal((await runAITask(task, undefined)).text, "ready");
  saveAISettings({ baseURL, model: "app-model-a", apiKey: randomBytes(32).toString("hex") });
  assert.equal((await runAITask(task, undefined)).text, "ready");
  const firstSecretId = JSON.parse(db().prepare("SELECT value FROM app_settings WHERE key = ?").get("ai.provider.profile").value).secretId;
  saveAISettings({ baseURL, model: "app-model-b", apiKey: randomBytes(32).toString("hex") });
  assert.equal((await runAITask(task, undefined)).text, "ready");
  assert.equal(createWindowsSecretStore().read(firstSecretId), null);
  saveAISettings({ baseURL, model: "app-model-c", apiKey: "" });
  assert.equal((await runAITask(task, undefined)).text, "ready");
  assert.deepEqual(models, ["environment-model", "app-model-a", "app-model-b", "app-model-c"]);
  console.log("runAITask refresh gate passed: each new task uses its own effective model snapshot.");
} finally {
  try { revertAISettings(); } finally {
    db().close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}
