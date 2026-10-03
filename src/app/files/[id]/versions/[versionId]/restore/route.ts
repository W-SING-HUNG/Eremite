import { NextResponse } from "next/server";
import { FileLifecycleError, FileVersionConflictError, restoreFileVersion } from "@/modules/inbox/service";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  if (!(await isAuthorized())) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ code: "invalid_origin" }, { status: 403 });
  const { id, versionId } = await params;
  const expectedVersionId = request.headers.get("if-match")?.replace(/^W\//, "").replace(/^"|"$/g, "") ?? "";
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!expectedVersionId || !idempotencyKey || idempotencyKey.length > 200) return NextResponse.json({ code: "invalid_request" }, { status: 400 });
  try {
    const result = await restoreFileVersion({ contentId: id, versionId, expectedVersionId, idempotencyKey });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof FileVersionConflictError) return NextResponse.json({ code: "version_conflict", currentVersionId: error.currentVersionId }, { status: 412 });
    if (error instanceof FileLifecycleError) return NextResponse.json({ code: error.code }, { status: error.code === "not_found" || error.code === "invalid_version" ? 404 : 409 });
    return NextResponse.json({ code: "database_failed" }, { status: 500 });
  }
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const source = new URL(origin);
    const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    return source.host === host && source.protocol === `${protocol}:`;
  } catch { return false; }
}
