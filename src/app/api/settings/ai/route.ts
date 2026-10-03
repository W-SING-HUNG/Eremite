import { z } from "zod";
import { isAuthorized } from "@/platform/auth/service";
import { getAISettings, resolveCandidateAIConfig, revertAISettings, saveAISettings } from "@/modules/ai/provider-settings.server";
import { testAIProviderConnection } from "@/modules/ai/provider-probe.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const candidate = z.object({ baseURL: z.string().max(2048), model: z.string().max(256), apiKey: z.string().max(2560) }).strict();
const command = z.discriminatedUnion("action", [
  candidate.extend({ action: z.literal("save") }),
  candidate.extend({ action: z.literal("test") }),
  z.object({ action: z.literal("revert") }).strict(),
]);

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function GET() {
  if (!(await isAuthorized())) return json({ code: "unauthorized" }, 401);
  return json(getAISettings());
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) return json({ code: "unauthorized" }, 401);
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    const source = origin ? new URL(origin) : null;
    const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    if (!source || source.host !== host || source.protocol !== `${protocol}:`) return json({ code: "invalid_origin" }, 403);
  } catch { return json({ code: "invalid_origin" }, 403); }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ code: "ai_invalid_input" }, 415);
  try {
    const parsed = command.safeParse(await readBoundedJSON(request));
    if (!parsed.success) return json({ code: "ai_invalid_input" }, 400);
    const input = parsed.data;
    if (input.action === "revert") return json(revertAISettings());
    if (input.action === "save") return json(saveAISettings(input));
    return json(await testAIProviderConnection(resolveCandidateAIConfig(input)));
  } catch (error) {
    const code = error instanceof Error && /^ai_[a-z0-9_]+$|^secret_store_[a-z0-9_]+$/u.test(error.message) ? error.message : "ai_settings_failed";
    return json({ code }, code.includes("invalid") || code.includes("missing") ? 400 : 500);
  }
}

async function readBoundedJSON(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new Error("ai_invalid_input"); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}
