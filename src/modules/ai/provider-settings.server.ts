import "server-only";

import { randomUUID } from "node:crypto";
import { one, run, transaction } from "@/platform/db/database";
import { now } from "@/platform/shared/ids";
import { createWindowsSecretStore, type SecretStore } from "@/platform/secrets/store";
import { AIConfigurationError, normalizeAIBaseURL, normalizeAIModel, readAIProviderConfig, type AIProviderConfig } from "@/modules/ai/config";

const key = "ai.provider.profile";
type Profile = { type: "openai-compatible"; baseURL: string; model: string; secretId: string };
type Store = Pick<SecretStore, "read" | "write" | "delete" | "available">;
type Row = { value: string };

function readProfile(): Profile | null {
  const row = one<Row>("SELECT value FROM app_settings WHERE key = ?", key);
  if (!row) return null;
  try {
    const value: unknown = JSON.parse(row.value);
    if (!value || typeof value !== "object") throw new Error();
    const profile = value as Record<string, unknown>;
    if (profile.type !== "openai-compatible" || typeof profile.baseURL !== "string" || typeof profile.model !== "string" || typeof profile.secretId !== "string" || !/^[a-f0-9-]{36}$/u.test(profile.secretId)) throw new Error();
    return { type: "openai-compatible", baseURL: normalizeAIBaseURL(profile.baseURL), model: normalizeAIModel(profile.model), secretId: profile.secretId };
  } catch { throw new Error("ai_profile_invalid"); }
}

export function readEffectiveAIConfig(store: Store = createWindowsSecretStore()): AIProviderConfig {
  const profile = readProfile();
  if (!profile) return readAIProviderConfig(process.env);
  const apiKey = store.read(profile.secretId);
  if (!apiKey) throw new AIConfigurationError("ai_api_key_missing");
  return Object.freeze({ baseURL: profile.baseURL, model: profile.model, apiKey });
}

export function getAISettings(store: Store = createWindowsSecretStore()) {
  let profile: Profile | null;
  try { profile = readProfile(); }
  catch { return { source: "app" as const, provider: "openai-compatible" as const, baseURL: "", model: "", hasApiKey: false, needsApiKey: true, configured: false }; }
  if (profile) {
    let hasApiKey = false;
    try { hasApiKey = Boolean(store.read(profile.secretId)); } catch { /* Fail closed. */ }
    return { source: "app" as const, provider: "openai-compatible" as const, baseURL: profile.baseURL, model: profile.model, hasApiKey, needsApiKey: !hasApiKey, configured: hasApiKey };
  }
  try {
    const config = readAIProviderConfig(process.env);
    return { source: "environment" as const, provider: "openai-compatible" as const, baseURL: config.baseURL, model: config.model, hasApiKey: true, needsApiKey: false, configured: true };
  } catch {
    return { source: "unconfigured" as const, provider: "openai-compatible" as const, baseURL: "", model: "", hasApiKey: false, needsApiKey: false, configured: false };
  }
}

export function saveAISettings(input: { baseURL: string; model: string; apiKey: string }, store: Store = createWindowsSecretStore()) {
  const baseURL = normalizeAIBaseURL(input.baseURL);
  const model = normalizeAIModel(input.model);
  const previous = readProfile();
  if (!store.available()) throw new Error("secret_store_unavailable");
  if (!previous && !input.apiKey.trim()) throw new AIConfigurationError("ai_api_key_missing");
  if (previous && !input.apiKey.trim() && !store.read(previous.secretId)) throw new AIConfigurationError("ai_api_key_missing");
  const secretId = input.apiKey.trim() ? randomUUID() : previous!.secretId;
  const replacing = Boolean(previous && secretId !== previous.secretId);
  const oldSecret = replacing ? store.read(previous!.secretId) : null;
  if (input.apiKey.trim()) store.write(secretId, input.apiKey.trim());
  try {
    // During replacement the old profile can briefly be unavailable, but it
    // never sees the new key paired with the old URL/model. A failed delete
    // leaves the old complete profile selected.
    if (replacing) store.delete(previous!.secretId);
    transaction(() => run("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at", key, JSON.stringify({ type: "openai-compatible", baseURL, model, secretId }), now()));
  } catch {
    if (replacing && oldSecret) { try { store.write(previous!.secretId, oldSecret); } catch { /* Safe unavailable state: no environment fallback. */ } }
    if (secretId !== previous?.secretId) { try { store.delete(secretId); } catch { /* The database still points only to the old profile. */ } }
    throw new Error("ai_settings_save_failed");
  }
  return getAISettings(store);
}

export function revertAISettings(store: Store = createWindowsSecretStore()) {
  const previous = readProfile();
  if (!previous) return getAISettings(store);
  transaction(() => run("DELETE FROM app_settings WHERE key = ?", key));
  try { store.delete(previous.secretId); }
  catch {
    try { transaction(() => run("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)", key, JSON.stringify(previous), now())); }
    catch { throw new Error("ai_settings_revert_unsafe"); }
    throw new Error("ai_settings_revert_failed");
  }
  return getAISettings(store);
}

export function resolveCandidateAIConfig(input: { baseURL: string; model: string; apiKey: string }, store: Store = createWindowsSecretStore()): AIProviderConfig {
  const profile = readProfile();
  const apiKey = input.apiKey.trim() || (profile ? store.read(profile.secretId) : null);
  if (!apiKey) throw new AIConfigurationError("ai_api_key_missing");
  return Object.freeze({ baseURL: normalizeAIBaseURL(input.baseURL), model: normalizeAIModel(input.model), apiKey });
}
