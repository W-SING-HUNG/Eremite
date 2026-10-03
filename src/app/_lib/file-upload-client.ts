"use client";

import {
  fileUploadFailureMessage,
  validateSelectedUpload,
  type FileUploadResponse,
} from "@/modules/inbox/upload-contract";

type UploadFetch = (input: RequestInfo | globalThis.URL, init?: RequestInit) => Promise<Response>;

export function getSelectedWebFile(value: FormDataEntryValue | null): globalThis.File | null {
  return typeof globalThis.File === "function" && value instanceof globalThis.File ? value : null;
}

export async function uploadSelectedFile({
  selectedFile,
  title,
  projectId,
  folderId,
  fetcher = globalThis.fetch.bind(globalThis),
}: {
  selectedFile: FormDataEntryValue | null;
  title: string;
  projectId?: string | null;
  folderId?: string | null;
  fetcher?: UploadFetch;
}): Promise<FileUploadResponse> {
  const file = getSelectedWebFile(selectedFile);
  if (!file) return { ok: false, code: "empty_file", message: fileUploadFailureMessage("empty_file") };
  const selectionError = validateSelectedUpload(file);
  if (selectionError) return { ok: false, ...selectionError };

  try {
    const response = await fetcher("/uploads/files", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Eremite-File-Name": encodeURIComponent(file.name),
        "X-Eremite-File-Title": encodeURIComponent(title.trim()),
        "X-Eremite-File-Size": String(file.size),
        ...(projectId ? { "X-Eremite-Project-Id": encodeURIComponent(projectId) } : {}),
        ...(folderId ? { "X-Eremite-Folder-Id": encodeURIComponent(folderId) } : {}),
      },
      body: file,
    });
    const result = await response.json().catch(() => null) as FileUploadResponse | null;
    if (response.ok && result?.ok) return result;
    if (result && !result.ok) return result;
    return { ok: false, code: "invalid_request", message: "上传失败，资料库仍可继续使用，请重试。" };
  } catch {
    return { ok: false, code: "upload_interrupted", message: fileUploadFailureMessage("upload_interrupted") };
  }
}
