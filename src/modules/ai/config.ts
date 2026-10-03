import "server-only";

export const AI_ENVIRONMENT_KEYS = {
  baseURL: "EREMITE_AI_BASE_URL",
  apiKey: "EREMITE_AI_API_KEY",
  model: "EREMITE_AI_MODEL",
} as const;

export type AIProviderConfig = Readonly<{
  baseURL: string;
  apiKey: string;
  model: string;
}>;

export type AIConfigurationErrorCode =
  | "ai_base_url_missing"
  | "ai_base_url_invalid"
  | "ai_api_key_missing"
  | "ai_model_missing";

export class AIConfigurationError extends Error {
  readonly code: AIConfigurationErrorCode;

  constructor(code: AIConfigurationErrorCode) {
    super(code);
    this.name = "AIConfigurationError";
    this.code = code;
  }
}

/**
 * Reads only the explicit AI environment contract. Error messages never echo
 * configuration values because the API key must remain safe even when an
 * uncaught configuration error is logged by the host.
 */
export function readAIProviderConfig(environment: Readonly<Record<string, string | undefined>>): AIProviderConfig {
  const apiKey = requiredValue(environment[AI_ENVIRONMENT_KEYS.apiKey], "ai_api_key_missing");
  const model = requiredValue(environment[AI_ENVIRONMENT_KEYS.model], "ai_model_missing");
  const rawBaseURL = requiredValue(environment[AI_ENVIRONMENT_KEYS.baseURL], "ai_base_url_missing");

  return Object.freeze({ baseURL: normalizeAIBaseURL(rawBaseURL), apiKey, model: normalizeAIModel(model) });
}

export function normalizeAIBaseURL(rawBaseURL: string): string {
  if (rawBaseURL.length > 2048) throw new AIConfigurationError("ai_base_url_invalid");
  let parsedBaseURL: URL;
  try {
    parsedBaseURL = new URL(rawBaseURL);
  } catch {
    throw new AIConfigurationError("ai_base_url_invalid");
  }

  if (
    !isSecureProviderURL(parsedBaseURL)
    || parsedBaseURL.username
    || parsedBaseURL.password
    || parsedBaseURL.search
    || parsedBaseURL.hash
  ) {
    throw new AIConfigurationError("ai_base_url_invalid");
  }

  return parsedBaseURL.href.replace(/\/$/u, "");
}

export function normalizeAIModel(rawModel: string): string {
  const model = rawModel.trim();
  if (!model || model.length > 256) throw new AIConfigurationError("ai_model_missing");
  return model;
}

function isSecureProviderURL(url: URL) {
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

function requiredValue(value: string | undefined, code: AIConfigurationErrorCode) {
  const normalized = value?.trim();
  if (!normalized) throw new AIConfigurationError(code);
  return normalized;
}
