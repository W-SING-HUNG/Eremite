import { NextResponse } from "next/server";
import { FileLifecycleError, FileVersionConflictError, getEditableText, saveEditedText } from "@/modules/inbox/service";
import { TextEditingError } from "@/modules/inbox/text-editing";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized())) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const { asset, decoded } = await getEditableText(id);
    return NextResponse.json({
      contentId: id,
      versionId: asset.versionId,
      originalName: asset.originalName,
      text: decoded.text,
      encoding: decoded.encoding,
      bom: decoded.bom,
      newline: decoded.newline,
      dominantNewline: decoded.dominantNewline,
      trailingNewline: decoded.trailingNewline,
      mixedNewlines: decoded.mixedNewlines,
    }, { headers: { "Cache-Control": "private, no-store", "ETag": `"${asset.versionId}"` } });
  } catch (error) { return textError(error); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized())) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ code: "invalid_origin" }, { status: 403 });
  const { id } = await params;
  const expectedVersionId = request.headers.get("if-match")?.replace(/^W\//, "").replace(/^"|"$/g, "") ?? "";
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!expectedVersionId || !idempotencyKey || idempotencyKey.length > 200) return NextResponse.json({ code: "invalid_request" }, { status: 400 });
  let payload: { text?: unknown; convertToUtf8?: unknown };
  try { payload = await request.json(); }
  catch { return NextResponse.json({ code: "invalid_request" }, { status: 400 }); }
  if (typeof payload.text !== "string") return NextResponse.json({ code: "invalid_request" }, { status: 400 });
  try {
    const result = await saveEditedText({ contentId: id, expectedVersionId, idempotencyKey, text: payload.text, convertToUtf8: payload.convertToUtf8 === true });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { return textError(error); }
}

function textError(error: unknown) {
  if (error instanceof FileVersionConflictError) return NextResponse.json({ code: "version_conflict", currentVersionId: error.currentVersionId }, { status: 412 });
  if (error instanceof FileLifecycleError) return NextResponse.json({ code: error.code }, { status: error.code === "not_found" ? 404 : 409 });
  if (error instanceof TextEditingError) return NextResponse.json({ code: error.code }, { status: error.code === "too_large" ? 413 : error.code === "not_editable" ? 415 : 422 });
  return NextResponse.json({ code: "save_failed" }, { status: 500 });
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
