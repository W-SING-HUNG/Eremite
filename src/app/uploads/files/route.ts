import { NextResponse } from "next/server";
import { createFileContentItemFromStream } from "@/modules/inbox/service";
import { fileUploadFailureMessage, maximumFileUploadBytes, type FileUploadFailureCode, type FileUploadResponse } from "@/modules/inbox/upload-contract";
import { FileStorageError } from "@/platform/files/service";
import { isAuthorized } from "@/platform/auth/service";
import { DataWriterLeaseError } from "@/platform/files/writer-lease";

export const runtime = "nodejs";

const response = (body: FileUploadResponse, status: number) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
});

export async function POST(request: Request) {
  if (!(await isAuthorized())) return failure("unauthorized", 401);
  if (!isSameOrigin(request)) return failure("invalid_origin", 403);

  const originalName = decodeHeader(request.headers.get("x-eremite-file-name"));
  const title = decodeHeader(request.headers.get("x-eremite-file-title"));
  if (!originalName || originalName.length > 1024 || title.length > 1000) return failure("invalid_request", 400);

  const expectedSize = parseExpectedSize(request.headers.get("x-eremite-file-size") ?? request.headers.get("content-length"));
  if (expectedSize === "invalid") return failure("invalid_request", 400);
  if (expectedSize !== undefined && expectedSize > maximumFileUploadBytes) return failure("file_too_large", 413);

  try {
    const contentId = await createFileContentItemFromStream({
      body: request.body,
      originalName,
      title,
      mimeType: request.headers.get("content-type") || "application/octet-stream",
      expectedSize,
      projectId: decodeHeader(request.headers.get("x-eremite-project-id")) || null,
      folderId: decodeHeader(request.headers.get("x-eremite-folder-id")) || null,
    });
    return response({ ok: true, contentId }, 201);
  } catch (error) {
    if (error instanceof FileStorageError) {
      const status = error.code === "file_too_large" ? 413 : error.code === "integrity_error" ? 422 : error.code === "write_failed" ? 507 : 400;
      return failure(error.code, status);
    }
    if (error instanceof DataWriterLeaseError) return failure("write_failed", 503);
    return failure("database_failed", 500);
  }
}

function failure(code: FileUploadFailureCode, status: number) {
  return response({ ok: false, code, message: fileUploadFailureMessage(code) }, status);
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const source = new URL(origin);
    const expectedProtocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    return source.host === host && source.protocol === `${expectedProtocol}:`;
  } catch {
    return false;
  }
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
