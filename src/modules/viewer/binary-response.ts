import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import type { FileAssetForViewing } from "@/modules/inbox/service";
import { contentDisposition, parseByteRange } from "@/modules/viewer/http";
import { getViewerDescriptorForAsset } from "@/modules/viewer/service";
import { inspectManagedFile } from "@/platform/files/service";

export async function respondWithManagedFile(request: Request, asset: FileAssetForViewing, options: { disposition: "inline" | "attachment"; validatePreview: boolean }) {
  let contentType = "application/octet-stream";
  if (options.validatePreview) {
    let descriptor;
    try { descriptor = await getViewerDescriptorForAsset(asset); }
    catch { return errorResponse(503, "load_failed", "The stored file could not be read"); }
    if (descriptor.availability !== "ready") return descriptorFailure(descriptor.availability);
    contentType = descriptor.detectedMimeType;
  }
  let integrity;
  try { integrity = await inspectManagedFile(asset.storageKey, asset.byteSize, asset.sha256); }
  catch { return errorResponse(503, "load_failed", "The stored file could not be read"); }
  if (integrity.status !== "ready") {
    const status = integrity.status === "missing" ? 410 : integrity.status === "load_failed" ? 503 : 422;
    return errorResponse(status, integrity.status, "File is not available");
  }

  const etag = `"${asset.sha256}"`;
  if (!request.headers.has("range") && request.headers.get("if-none-match")?.split(",").map((value) => value.trim()).includes(etag)) {
    return new NextResponse(null, { status: 304, headers: responseHeaders(asset, options.disposition, contentType, etag, integrity.size) });
  }
  const rangeHeader = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const parsedRange = rangeHeader && (!ifRange || ifRange === etag) ? parseByteRange(rangeHeader, integrity.size) : null;
  if (parsedRange === "invalid") {
    return new NextResponse(null, { status: 416, headers: responseHeaders(asset, options.disposition, contentType, etag, 0, integrity.size) });
  }
  const range = parsedRange === "multiple" ? null : parsedRange;
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, integrity.size - 1);
  const length = range ? end - start + 1 : integrity.size;
  const headers = responseHeaders(asset, options.disposition, contentType, etag, length);
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${integrity.size}`);
  if (request.method === "HEAD") return new NextResponse(null, { status: range ? 206 : 200, headers });
  if (integrity.size === 0) return new NextResponse(new Uint8Array(), { status: 200, headers });
  const stream = Readable.toWeb(createReadStream(integrity.absolutePath, { start, end })) as ReadableStream;
  return new NextResponse(stream, { status: range ? 206 : 200, headers });
}

function responseHeaders(asset: FileAssetForViewing, disposition: "inline" | "attachment", contentType: string, etag: string, length: number, unsatisfiedSize?: number) {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store, no-transform",
    "Content-Disposition": contentDisposition(disposition, asset.originalName),
    "Content-Length": String(length),
    "Content-Type": contentType,
    "Cross-Origin-Resource-Policy": "same-origin",
    "ETag": etag,
    "X-Content-Type-Options": "nosniff",
  });
  if (unsatisfiedSize !== undefined) {
    headers.set("Content-Range", `bytes */${unsatisfiedSize}`);
    headers.delete("Content-Length");
  }
  return headers;
}

function descriptorFailure(availability: string) {
  if (availability === "missing") return errorResponse(410, "missing", "Stored file is missing");
  if (availability === "integrity_error") return errorResponse(422, "integrity_error", "Stored file failed integrity verification");
  if (availability === "corrupted") return errorResponse(422, "corrupted", "The file container is malformed");
  if (availability === "unsupported") return errorResponse(415, "unsupported", "This file type is not previewable");
  if (availability === "too_large") return errorResponse(413, "too_large", "This file is too large to preview safely");
  return errorResponse(503, "load_failed", "The stored file could not be read");
}

export const errorResponse = (status: number, code: string, message: string) => NextResponse.json({ code, message }, { status });
