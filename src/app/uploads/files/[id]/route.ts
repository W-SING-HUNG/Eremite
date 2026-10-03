import { NextResponse } from "next/server";
import { FileLifecycleError, FileVersionConflictError, replaceFileContentItemFromStream } from "@/modules/inbox/service";
import { maximumFileUploadBytes } from "@/modules/inbox/upload-contract";
import { isAuthorized } from "@/platform/auth/service";
import { FileStorageError } from "@/platform/files/service";
import { DataWriterLeaseError } from "@/platform/files/writer-lease";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized())) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ code: "invalid_origin" }, { status: 403 });
  const { id } = await params;
  const originalName = decodeHeader(request.headers.get("x-eremite-file-name"));
  const expectedVersionId = request.headers.get("if-match")?.replace(/^W\//, "").replace(/^"|"$/g, "") ?? "";
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  const expectedSize = parseExpectedSize(request.headers.get("x-eremite-file-size") ?? request.headers.get("content-length"));
  if (!originalName || originalName.length > 1024 || !expectedVersionId || !idempotencyKey || idempotencyKey.length > 200 || expectedSize === "invalid") {
    return NextResponse.json({ code: "invalid_request" }, { status: 400 });
  }
  if (expectedSize !== undefined && expectedSize > maximumFileUploadBytes) return NextResponse.json({ code: "file_too_large" }, { status: 413 });
  try {
    const result = await replaceFileContentItemFromStream({
      contentId: id,
      expectedVersionId,
      idempotencyKey,
      body: request.body,
      originalName,
      mimeType: request.headers.get("content-type") || "application/octet-stream",
      expectedSize,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof FileVersionConflictError) return NextResponse.json({ code: "version_conflict", currentVersionId: error.currentVersionId }, { status: 412 });
    if (error instanceof FileLifecycleError) return NextResponse.json({ code: error.code }, { status: error.code === "not_found" ? 404 : 409 });
    if (error instanceof FileStorageError) {
      const status = error.code === "file_too_large" ? 413 : error.code === "integrity_error" ? 422 : error.code === "write_failed" ? 507 : 400;
      return NextResponse.json({ code: error.code }, { status });
    }
    if (error instanceof DataWriterLeaseError) return NextResponse.json({ code: "writer_busy" }, { status: 503 });
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

function decodeHeader(value: string | null) {
  if (!value) return "";
  try { return decodeURIComponent(value).trim(); } catch { return ""; }
}

function parseExpectedSize(value: string | null): number | undefined | "invalid" {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) return "invalid";
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : "invalid";
}
