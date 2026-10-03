import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, mkdir, open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { filesDirectory } from "@/platform/db/database";
import { now, uuidv7 } from "@/platform/shared/ids";

export type StoredFile = {
  id: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
};

export type StagedUpload = StoredFile & { stagingPath: string };

export type FileStorageFailureCode = "empty_file" | "file_too_large" | "upload_interrupted" | "write_failed" | "integrity_error";

export class FileStorageError extends Error {
  constructor(public readonly code: FileStorageFailureCode) {
    super(code);
    this.name = "FileStorageError";
  }
}

export type ManagedFileIntegrity =
  | { status: "ready"; absolutePath: string; size: number; mtimeMs: number }
  | { status: "missing" }
  | { status: "integrity_error"; absolutePath: string; size: number; mtimeMs: number }
  | { status: "load_failed"; absolutePath: string; size: number; mtimeMs: number };

const integrityCache = new Map<string, { size: number; mtimeMs: number; sha256: string }>();

export async function stageUploadedStream(input: {
  body: ReadableStream<Uint8Array> | null;
  originalName: string;
  mimeType: string;
  expectedSize?: number;
  maximumBytes: number;
  allowEmpty?: boolean;
}): Promise<StagedUpload> {
  if (!input.body) throw new FileStorageError("empty_file");
  if (input.expectedSize !== undefined && input.expectedSize > input.maximumBytes) throw new FileStorageError("file_too_large");
  if (input.expectedSize === 0 && !input.allowEmpty) throw new FileStorageError("empty_file");
  await mkdir(filesDirectory, { recursive: true });
  const stagingDirectory = path.join(filesDirectory, ".upload-staging");
  await mkdir(stagingDirectory, { recursive: true });
  const stagingPath = path.join(stagingDirectory, `${uuidv7()}.part`);
  let file;
  let byteSize = 0;
  let completed = false;
  const hash = createHash("sha256");
  try {
    file = await open(stagingPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    const reader = input.body.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = result.value;
        byteSize += chunk.byteLength;
        if (byteSize > input.maximumBytes) throw new FileStorageError("file_too_large");
        hash.update(chunk);
        await file.write(chunk);
      }
    } catch (error) {
      if (error instanceof FileStorageError) throw error;
      throw new FileStorageError("upload_interrupted");
    } finally {
      reader.releaseLock();
    }
    if (byteSize === 0 && !input.allowEmpty) throw new FileStorageError("empty_file");
    if (input.expectedSize !== undefined && byteSize !== input.expectedSize) throw new FileStorageError("upload_interrupted");
    await file.sync();
    completed = true;
  } catch (error) {
    if (error instanceof FileStorageError) throw error;
    throw new FileStorageError("write_failed");
  } finally {
    await file?.close().catch(() => undefined);
    if (!completed) {
      await unlink(stagingPath).catch(() => undefined);
    }
  }

  const sha256 = hash.digest("hex");
  if (!(await inspectAbsoluteFile(stagingPath, byteSize, sha256))) {
    await unlink(stagingPath).catch(() => undefined);
    throw new FileStorageError("integrity_error");
  }
  return {
    id: uuidv7(), storageKey: sha256, originalName: path.basename(input.originalName || "untitled"),
    mimeType: input.mimeType || "application/octet-stream", byteSize, sha256, createdAt: now(), stagingPath,
  };
}

export async function stageUploadedFile(file: File, maximumBytes: number) {
  return stageUploadedStream({ body: file.stream(), originalName: file.name, mimeType: file.type, expectedSize: file.size, maximumBytes });
}

export async function promoteStagedUpload(staged: StagedUpload) {
  const destination = managedFilePath(staged.storageKey);
  let created = false;
  try {
    await link(staged.stagingPath, destination);
    created = true;
  } catch (error) {
    if (!isAlreadyExists(error)) throw new FileStorageError("write_failed");
    const existing = await inspectAbsoluteFile(destination, staged.byteSize, staged.sha256);
    if (!existing) throw new FileStorageError("integrity_error");
  }
  await unlink(staged.stagingPath).catch(() => undefined);
  return { stored: withoutStagingPath(staged), created };
}

export async function discardStagedUpload(staged: StagedUpload) {
  await unlink(staged.stagingPath).catch(() => undefined);
}

export async function copyManagedFile(storageKey: string, destinationDirectory: string) {
  await mkdir(destinationDirectory, { recursive: true });
  return copyFile(managedFilePath(storageKey), path.join(destinationDirectory, storageKey));
}

export function managedFilePath(storageKey: string) {
  if (!/^[a-f0-9]{64}$/.test(storageKey) || path.basename(storageKey) !== storageKey) throw new FileStorageError("integrity_error");
  return path.join(filesDirectory, storageKey);
}

export async function inspectManagedFile(storageKey: string, expectedSize: number, expectedSha256: string): Promise<ManagedFileIntegrity> {
  const absolutePath = managedFilePath(storageKey);
  let details;
  try {
    details = await stat(absolutePath);
  } catch {
    return { status: "missing" };
  }

  const cached = integrityCache.get(storageKey);
  let actualSha256 = cached?.size === details.size && cached.mtimeMs === details.mtimeMs ? cached.sha256 : "";
  if (!actualSha256) {
    let file;
    try {
      file = await open(absolutePath, "r");
      const hash = createHash("sha256");
      for await (const chunk of file.createReadStream()) hash.update(chunk);
      actualSha256 = hash.digest("hex");
      integrityCache.set(storageKey, { size: details.size, mtimeMs: details.mtimeMs, sha256: actualSha256 });
    } catch {
      return { status: "load_failed", absolutePath, size: details.size, mtimeMs: details.mtimeMs };
    } finally {
      await file?.close().catch(() => undefined);
    }
  }

  if (details.size !== expectedSize || actualSha256 !== expectedSha256) {
    return { status: "integrity_error", absolutePath, size: details.size, mtimeMs: details.mtimeMs };
  }
  return { status: "ready", absolutePath, size: details.size, mtimeMs: details.mtimeMs };
}

async function inspectAbsoluteFile(absolutePath: string, expectedSize: number, expectedSha256: string) {
  const details = await stat(absolutePath).catch(() => null);
  if (!details?.isFile() || details.size !== expectedSize) return false;
  const file = await open(absolutePath, "r");
  const hash = createHash("sha256");
  try {
    for await (const chunk of file.createReadStream()) hash.update(chunk);
  } finally {
    await file.close().catch(() => undefined);
  }
  return hash.digest("hex") === expectedSha256;
}

const withoutStagingPath = ({ stagingPath: _, ...stored }: StagedUpload): StoredFile => stored;
const isAlreadyExists = (error: unknown) => error instanceof Error && "code" in error && error.code === "EEXIST";
