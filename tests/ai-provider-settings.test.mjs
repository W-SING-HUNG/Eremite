import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const directory = await mkdtemp(path.join(tmpdir(), "eremite-ai-settings-"));
process.env.EREMITE_DATA_DIR = directory;
process.env.EREMITE_AI_BASE_URL = "https://env.example/v1";
process.env.EREMITE_AI_API_KEY = "env-secret-never-copy";
process.env.EREMITE_AI_MODEL = "env-model";

const { db } = await import("@/platform/db/database");
const { getAISettings, readEffectiveAIConfig, saveAISettings, revertAISettings, resolveCandidateAIConfig } = await import("@/modules/ai/provider-settings.server");
const { normalizeAIBaseURL, normalizeAIModel } = await import("@/modules/ai/config");

const secrets = new Map();
const store = {
  available: () => true,
  read: id => secrets.get(id) ?? null,
  write: (id, value) => { secrets.set(id, value); },
  delete: id => { secrets.delete(id); },
};
const snapshot = () => readEffectiveAIConfig(store);

test("environment, app profile, replacement, blank-key preservation and explicit revert stay atomic", () => {
  assert.equal(getAISettings(store).source, "environment");
  assert.equal(snapshot().apiKey, "env-secret-never-copy");
  assert.throws(() => saveAISettings({ baseURL: "https://app.example/v1", model: "app-model", apiKey: "" }, store), /ai_api_key_missing/u);
  assert.throws(() => resolveCandidateAIConfig({ baseURL: "https://app.example/v1", model: "app-model", apiKey: "" }, store), /ai_api_key_missing/u);
  assert.equal(secrets.size, 0);
  saveAISettings({ baseURL: "https://app.example/v1", model: "app-model", apiKey: "app-secret" }, store);
  assert.deepEqual(snapshot(), { baseURL: "https://app.example/v1", model: "app-model", apiKey: "app-secret" });
  assert.equal(getAISettings(store).hasApiKey, true);
  assert.equal(JSON.stringify(getAISettings(store)).includes("app-secret"), false);
  assert.equal(JSON.stringify(db().prepare("SELECT value FROM app_settings WHERE key = 'ai.provider.profile'").get()).includes("app-secret"), false);
  const firstId = [...secrets.keys()][0];
  saveAISettings({ baseURL: "https://app.example/v2", model: "next-model", apiKey: "" }, store);
  assert.equal(snapshot().apiKey, "app-secret");
  assert.equal(snapshot().model, "next-model");
  assert.equal([...secrets.keys()][0], firstId);
  saveAISettings({ baseURL: "https://new.example/v1", model: "new-model", apiKey: "new-secret" }, store);
  assert.deepEqual(snapshot(), { baseURL: "https://new.example/v1", model: "new-model", apiKey: "new-secret" });
  assert.equal(secrets.has(firstId), false);
  assert.equal(secrets.size, 1);
  revertAISettings(store);
  assert.equal(snapshot().apiKey, "env-secret-never-copy");
  assert.equal(secrets.size, 0);
});

test("missing restored OS secret does not borrow environment key", () => {
  saveAISettings({ baseURL: "https://restore.example/v1", model: "restore-model", apiKey: "restore-secret" }, store);
  secrets.clear();
  assert.equal(getAISettings(store).source, "app");
  assert.equal(getAISettings(store).needsApiKey, true);
  assert.equal(getAISettings(store).configured, false);
  assert.throws(snapshot, /ai_api_key_missing/u);
  assert.throws(() => saveAISettings({ baseURL: "https://restore.example/v1", model: "restore-model", apiKey: "" }, store), /ai_api_key_missing/u);
  saveAISettings({ baseURL: "https://restore.example/v1", model: "restore-model", apiKey: "replacement-secret" }, store);
  assert.equal(snapshot().apiKey, "replacement-secret");
});

test("secret and database failures preserve a whole effective profile", () => {
  const original = snapshot();
  const failedWrite = { ...store, write: () => { throw new Error("injected-secret-write-failure"); } };
  assert.throws(() => saveAISettings({ baseURL: "https://bad.example/v1", model: "bad", apiKey: "bad-secret" }, failedWrite), /injected-secret-write-failure/u);
  assert.deepEqual(snapshot(), original);
  db().exec("CREATE TRIGGER ai_settings_fail BEFORE UPDATE ON app_settings WHEN NEW.key = 'ai.provider.profile' BEGIN SELECT RAISE(ABORT, 'injected-db-failure'); END;");
  assert.throws(() => saveAISettings({ baseURL: "https://bad.example/v1", model: "bad", apiKey: "bad-secret" }, store), /ai_settings_save_failed/u);
  db().exec("DROP TRIGGER ai_settings_fail");
  assert.deepEqual(snapshot(), original);
  assert.equal([...secrets.values()].includes("bad-secret"), false);
  const oldId = [...secrets.keys()][0];
  const failedReplacementDelete = { ...store, delete: id => { if (id === oldId) throw new Error("injected-replacement-delete-failure"); store.delete(id); } };
  assert.throws(() => saveAISettings({ baseURL: "https://bad.example/v1", model: "bad", apiKey: "bad-secret" }, failedReplacementDelete), /ai_settings_save_failed/u);
  assert.deepEqual(snapshot(), original);
  assert.equal([...secrets.values()].includes("bad-secret"), false);
  const failedDelete = { ...store, delete: () => { throw new Error("injected-delete-failure"); } };
  assert.throws(() => revertAISettings(failedDelete), /ai_settings_revert_failed/u);
  assert.deepEqual(snapshot(), original);
});

test("URL and model shape reject unsafe candidates", () => {
  for (const value of ["http://example.com/v1", "https://u:p@example.com/v1", "https://example.com/v1?q=1", "https://example.com/v1#x", "not-url"]) assert.throws(() => normalizeAIBaseURL(value));
  assert.equal(normalizeAIBaseURL("http://[::1]:1234/v1/"), "http://[::1]:1234/v1");
  assert.throws(() => normalizeAIModel(" "));
  assert.throws(() => normalizeAIModel("a".repeat(257)));
});

test("database backup contains profile metadata without API key", async () => {
  const { createBackup } = await import("@/platform/backup/service");
  const backup = await createBackup();
  const copied = new DatabaseSync(path.join(backup.directory, "app.sqlite"), { readOnly: true });
  try {
    const value = copied.prepare("SELECT value FROM app_settings WHERE key = 'ai.provider.profile'").get().value;
    assert.equal(value.includes("replacement-secret"), false);
    assert.equal(value.includes("env-secret-never-copy"), false);
  } finally { copied.close(); }
  const manifest = await readFile(path.join(backup.directory, "manifest.json"), "utf8");
  assert.equal(manifest.includes("replacement-secret"), false);
});

test("Settings UI source renders each capability and only fixed probe diagnostics", async () => {
  // Static wiring only; the real mixed-capability Settings UI matrix is separate browser acceptance.
  const source = await readFile(new URL("../src/app/_components/ai-settings.tsx", import.meta.url), "utf8");
  assert.match(source, /<strong>连接\{probe\.success \? "成功" : "失败"\}<\/strong>/u);
  for (const field of ["text", "structuredOutput", "toolCalling"]) {
    assert.ok(source.includes('probe.' + field + ' ? "PASS" : "FAIL"'));
  }
  assert.match(source, /probeDiagnostics\(probe\)\.map\(diagnostic => <span key=\{diagnostic\}>\{diagnostic\}<\/span>\)/u);
  assert.match(source, /setProbe\(value\)/u);
  assert.match(source, /连接测试未通过。此结果未保存。/u);
  assert.doesNotMatch(source, /probe\.(?:providerError|responseBody|stack|apiKey|credential|url|cause)/u);
});

test.after(async () => { db().close(); await rm(directory, { recursive: true, force: true }); });
