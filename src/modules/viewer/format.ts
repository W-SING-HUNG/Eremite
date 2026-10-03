import path from "node:path";
import type { ViewerKind } from "@/modules/viewer/contracts";

export type DetectedViewerFormat = { kind: ViewerKind; mimeType: string; formatMismatch: boolean };

const extensionKind = (name: string): ViewerKind => {
  switch (path.extname(name).toLowerCase()) {
    case ".pdf": return "pdf";
    case ".jpg": case ".jpeg": case ".png": case ".webp": return "image";
    case ".txt": return "text";
    case ".md": case ".markdown": return "markdown";
    case ".docx": return "docx";
    case ".zip": return "archive";
    case ".mp4": case ".m4v": case ".webm": return "video";
    default: return "unsupported";
  }
};

const mimeKind = (mime: string): ViewerKind => {
  const normalized = mime.toLowerCase().split(";", 1)[0].trim();
  if (normalized === "application/pdf") return "pdf";
  if (["image/jpeg", "image/png", "image/webp"].includes(normalized)) return "image";
  if (normalized === "text/plain") return "text";
  if (["text/markdown", "text/x-markdown"].includes(normalized)) return "markdown";
  if (normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (["application/zip", "application/x-zip-compressed"].includes(normalized)) return "archive";
  if (["video/mp4", "video/x-m4v", "video/webm"].includes(normalized)) return "video";
  return "unsupported";
};

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((value, index) => bytes[index] === value);

export function detectViewerFormat(originalName: string, declaredMimeType: string, bytes: Uint8Array, docxContainer?: "docx" | "zip" | "corrupted"): DetectedViewerFormat {
  const byExtension = extensionKind(originalName);
  const byMime = mimeKind(declaredMimeType);
  let kind: ViewerKind = "unsupported";
  let mimeType = "application/octet-stream";

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    kind = "pdf"; mimeType = "application/pdf";
  } else if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    kind = "image"; mimeType = "image/png";
  } else if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    kind = "image"; mimeType = "image/jpeg";
  } else if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    kind = "image"; mimeType = "image/webp";
  } else if (isZipSignature(bytes) && (byExtension === "docx" || byMime === "docx")) {
    if (docxContainer === "docx" || docxContainer === "corrupted") {
      kind = "docx"; mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else if (docxContainer === "zip") {
      kind = "archive"; mimeType = "application/zip";
    }
  } else if (isZipSignature(bytes) && (byExtension === "archive" || byMime === "archive")) {
    kind = "archive"; mimeType = "application/zip";
  } else if (isIsoBaseMedia(bytes) && (byExtension === "video" || byMime === "video")) {
    kind = "video"; mimeType = "video/mp4";
  } else if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) && (byExtension === "video" || byMime === "video")) {
    kind = "video"; mimeType = "video/webm";
  } else if (!bytes.includes(0) && (byExtension === "text" || byExtension === "markdown" || byMime === "text" || byMime === "markdown")) {
    kind = byExtension === "markdown" || byMime === "markdown" ? "markdown" : "text";
    mimeType = kind === "markdown" ? "text/markdown" : "text/plain";
  }

  const claimedKinds = [byExtension, byMime].filter((value) => value !== "unsupported");
  return { kind, mimeType, formatMismatch: kind !== "unsupported" && claimedKinds.some((value) => value !== kind) };
}

function isIsoBaseMedia(bytes: Uint8Array) {
  return bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
}

export function isZipSignature(bytes: Uint8Array) {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
    || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
    || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]);
}

export function claimsDocx(originalName: string, declaredMimeType: string) {
  return extensionKind(originalName) === "docx" || mimeKind(declaredMimeType) === "docx";
}
