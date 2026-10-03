import { readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { all, assertUnitOfWork, filesDirectory, one, run, transaction, type UnitOfWork } from "@/platform/db/database";
import { discardStagedUpload, managedFilePath, promoteStagedUpload, stageUploadedFile, stageUploadedStream, type StagedUpload, type StoredFile } from "@/platform/files/service";
import { withDataWriterLease } from "@/platform/files/writer-lease";
import { maximumFileUploadBytes } from "@/modules/inbox/upload-contract";
import { now, uuidv7 } from "@/platform/shared/ids";
import { decodeEditableText, encodeEditedText, maximumEditableTextBytes, TextEditingError } from "@/modules/inbox/text-editing";
import { enqueueUnreferencedBlobs } from "@/platform/files/gc";
import { assertProjectAcceptsMembers, getProject } from "@/modules/projects/service";
import { isFolderAvailable } from "@/modules/projects/folders";
import { effectiveFolderVisibilitySql, folderAncestorVisibilitySql } from "@/modules/projects/folder-visibility";
import { decodeCursor, encodeCursor, pageLimit } from "@/platform/shared/pagination";
import { normalizeKey } from "@/platform/shared/normalization";

const contentFolderVisibility = effectiveFolderVisibilitySql("ci.folder_id");
const selectedContentFolderVisibility = folderAncestorVisibilitySql("selected_content", "folder_id");

export type InboxStatus = "inbox" | "processed" | "archived";
export type FileChangeSource = "migration" | "upload" | "replace" | "text_edit" | "restore";
export type StoredViewerKind = "pdf" | "image" | "text" | "markdown" | "docx" | "archive" | "video" | "unsupported";

export type ContentItem = {
  id: string; kind: "file" | "link"; title: string; source_url: string | null;
  file_asset_id: string | null; tags: string; status: InboxStatus; created_at: string; updated_at: string;
  original_name: string | null; mime_type: string | null; storage_key: string | null;
  byte_size: number | null; sha256: string | null; current_version_id: string | null;
  project_id: string | null; folder_id: string | null; restore_folder_id: string | null;
  trashed_at: string | null; revision: number;
};

export type ContentPickerItem = Pick<ContentItem, "id" | "title" | "kind" | "source_url" | "project_id" | "folder_id" | "updated_at">;

export type FileAssetForViewing = {
  contentId: string;
  assetId: string;
  versionId: string;
  versionNumber: number;
  isCurrent: number;
  blobId: string;
  title: string;
  originalName: string;
  declaredMimeType: string;
  detectedMimeType: string;
  storedViewerKind: StoredViewerKind;
  storageKey: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
  versionCreatedAt: string;
  changeSource: FileChangeSource;
  textEncoding: string | null;
  textBom: string | null;
  textNewline: string | null;
  textTrailingNewline: number | null;
};

export type FileVersionSummary = {
  id: string;
  version_number: number;
  original_name: string;
  declared_mime_type: string;
  byte_size: number;
  sha256: string;
  change_source: FileChangeSource;
  source_version_id: string | null;
  created_at: string;
  is_current: number;
};

export class FileVersionConflictError extends Error {
  constructor(public readonly currentVersionId: string) {
    super("The file changed after this operation began.");
    this.name = "FileVersionConflictError";
  }
}

export class FileLifecycleError extends Error {
  constructor(public readonly code: "not_found" | "invalid_version" | "operation_in_progress" | "revision_conflict" | "invalid_location" | "invalid_metadata" | "invalid_status_transition") {
    super(code);
    this.name = "FileLifecycleError";
  }
}

export class ContentProcessingError extends Error {
  constructor(public readonly code: "revision_conflict" | "not_inbox" | "unavailable") {
    super(code);
    this.name = "ContentProcessingError";
  }
}

type FileWriteOperationType = "upload" | "replace" | "text_edit" | "restore";

export function listContentItems(status?: InboxStatus) {
  return all<ContentItem>(
    `WITH RECURSIVE ${contentFolderVisibility.recursiveCte}
     SELECT ci.*, fv.original_name, fv.declared_mime_type AS mime_type,
            fb.storage_key, fb.byte_size, fb.sha256, fa.current_version_id
       FROM content_items ci
       LEFT JOIN file_assets fa ON fa.id = ci.file_asset_id
       LEFT JOIN file_versions fv ON fv.id = fa.current_version_id AND fv.asset_id = fa.id
       LEFT JOIN file_blobs fb ON fb.id = fv.blob_id
       WHERE ci.trashed_at IS NULL
         AND ${contentFolderVisibility.visiblePredicate}
         ${status ? "AND ci.status = ?" : ""}
      ORDER BY ci.created_at DESC`,
    ...(status ? [status] : []),
  );
}

export function listContentItemsPage(input: { status?: InboxStatus; cursor?: string; limit?: number } = {}) {
  const cursor = decodeCursor(input.cursor);
  const limit = pageLimit(input.limit);
  const params: unknown[] = [];
  const statusFilter = input.status ? "AND ci.status = ?" : "";
  if (input.status) params.push(input.status);
  const cursorFilter = cursor ? "AND (ci.created_at < ? OR (ci.created_at = ? AND ci.id < ?))" : "";
  if (cursor) params.push(cursor.timestamp, cursor.timestamp, cursor.id);
  params.push(limit + 1);
  const rows = all<ContentItem>(
    `WITH RECURSIVE ${contentFolderVisibility.recursiveCte}
     SELECT ci.*, fv.original_name, fv.declared_mime_type AS mime_type,
            fb.storage_key, fb.byte_size, fb.sha256, fa.current_version_id
       FROM content_items ci
       LEFT JOIN file_assets fa ON fa.id = ci.file_asset_id
       LEFT JOIN file_versions fv ON fv.id = fa.current_version_id AND fv.asset_id = fa.id
       LEFT JOIN file_blobs fb ON fb.id = fv.blob_id
      WHERE ci.trashed_at IS NULL
        AND ${contentFolderVisibility.visiblePredicate}
        ${statusFilter} ${cursorFilter}
      ORDER BY ci.created_at DESC, ci.id DESC LIMIT ?`,
    ...params,
  );
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const tail = items.at(-1);
  return { items, nextCursor: hasMore && tail ? encodeCursor({ timestamp: tail.created_at, id: tail.id }) : null };
}

export function listContentItemsInFolder(projectId: string, folderId: string | null) {
  return all<ContentItem>(
    `SELECT ci.*, fv.original_name, fv.declared_mime_type AS mime_type,
            fb.storage_key, fb.byte_size, fb.sha256, fa.current_version_id
       FROM content_items ci
       LEFT JOIN file_assets fa ON fa.id = ci.file_asset_id
       LEFT JOIN file_versions fv ON fv.id = fa.current_version_id AND fv.asset_id = fa.id
       LEFT JOIN file_blobs fb ON fb.id = fv.blob_id
      WHERE ci.project_id = ? AND ci.trashed_at IS NULL
        AND ${folderId ? "ci.folder_id = ?" : "ci.folder_id IS NULL"}
      ORDER BY ci.updated_at DESC, ci.id DESC`,
    ...(folderId ? [projectId, folderId] : [projectId]),
  );
}

export function listContentItemsInFolderPage(projectId: string, folderId: string | null, input: { cursor?: string; limit?: number } = {}) {
  const cursor = decodeCursor(input.cursor); const limit = pageLimit(input.limit, 100);
  const rows = all<ContentItem>(
    `SELECT ci.*, fv.original_name, fv.declared_mime_type AS mime_type,
            fb.storage_key, fb.byte_size, fb.sha256, fa.current_version_id
       FROM content_items ci
       LEFT JOIN file_assets fa ON fa.id = ci.file_asset_id
       LEFT JOIN file_versions fv ON fv.id = fa.current_version_id AND fv.asset_id = fa.id
       LEFT JOIN file_blobs fb ON fb.id = fv.blob_id
      WHERE ci.project_id = ? AND ci.trashed_at IS NULL
        AND ${folderId ? "ci.folder_id = ?" : "ci.folder_id IS NULL"}
        ${cursor ? "AND (ci.updated_at < ? OR (ci.updated_at = ? AND ci.id < ?))" : ""}
      ORDER BY ci.updated_at DESC, ci.id DESC LIMIT ?`,
    projectId, ...(folderId ? [folderId] : []), ...(cursor ? [cursor.timestamp, cursor.timestamp, cursor.id] : []), limit + 1,
  );
  const hasMore = rows.length > limit; const items = hasMore ? rows.slice(0, limit) : rows; const tail = items.at(-1);
  return { items, nextCursor: hasMore && tail ? encodeCursor({ timestamp: tail.updated_at, id: tail.id }) : null };
}

export function listTrashedContentItems() {
  return all<ContentItem>(
    `SELECT ci.*, fv.original_name, fv.declared_mime_type AS mime_type,
            fb.storage_key, fb.byte_size, fb.sha256, fa.current_version_id
       FROM content_items ci
       LEFT JOIN file_assets fa ON fa.id = ci.file_asset_id
       LEFT JOIN file_versions fv ON fv.id = fa.current_version_id AND fv.asset_id = fa.id
       LEFT JOIN file_blobs fb ON fb.id = fv.blob_id
      WHERE ci.trashed_at IS NOT NULL ORDER BY ci.trashed_at DESC, ci.id DESC`,
  );
}

/** Public inbox read contract for other modules. */
export function getContentItemSummary(id: string) {
  return one<Pick<ContentItem, "id" | "title" | "status" | "kind" | "project_id" | "folder_id" | "restore_folder_id" | "trashed_at" | "revision">>("SELECT id, title, status, kind, project_id, folder_id, restore_folder_id, trashed_at, revision FROM content_items WHERE id = ?", id);
}

/** Public read contract for workflows that may only consume currently available Content. */
export function getAvailableContentItemSummary(id: string) {
  return one<Pick<ContentItem, "id" | "title" | "status" | "kind" | "project_id" | "folder_id" | "restore_folder_id" | "trashed_at" | "revision">>(
    `WITH RECURSIVE selected_content(folder_id) AS (
       SELECT folder_id FROM content_items WHERE id = ? AND trashed_at IS NULL
     ),
     ${selectedContentFolderVisibility.recursiveCte}
     SELECT item.id, item.title, item.status, item.kind, item.project_id, item.folder_id,
            item.restore_folder_id, item.trashed_at, item.revision
       FROM content_items item
      WHERE item.id = ? AND item.trashed_at IS NULL
         AND ${selectedContentFolderVisibility.visiblePredicate}`,
    id, id,
  );
}

/** Bounded, data-only read for Ask Eremite. Binary files are never returned. */
export async function getContentForAI(id: string) {
  const item = getAvailableContentItemSummary(id);
  if (!item) return undefined;
  const observedAsset = item.kind === 'file' ? getFileAssetForViewing(id) : null;
  let text: string | undefined;
  if (item.kind === 'link') {
    text = one<{ source_url: string | null }>('SELECT source_url FROM content_items WHERE id = ?', id)?.source_url?.slice(0, 12_000) ?? undefined;
  } else if (observedAsset) {
    try {
      const editable = await getEditableText(id, observedAsset.versionId);
      text = editable.decoded.text.slice(0, 12_000);
    } catch (error) {
      if (!(error instanceof TextEditingError) && !(error instanceof FileLifecycleError)) throw error;
    }
  }
  const fileVersionId = observedAsset?.versionId;
  return { id: item.id, title: item.title, status: item.status, kind: item.kind, revision: item.revision, projectId: item.project_id, folderId: item.folder_id,
    ...(fileVersionId ? { fileVersionId } : {}), ...(text ? { text } : {}) };
}

/** Inbox-owned write contract for app-level Processing transactions. */
export function markContentProcessed(uow: UnitOfWork, input: { id: string; expectedRevision: number }) {
  assertUnitOfWork(uow);
  const item = getAvailableContentItemSummary(input.id);
  if (!item) throw new ContentProcessingError("unavailable");
  if (item.revision !== input.expectedRevision) throw new ContentProcessingError("revision_conflict");
  if (item.status !== "inbox") throw new ContentProcessingError("not_inbox");
  const result = run(
    "UPDATE content_items SET status = 'processed', revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND status = 'inbox' AND trashed_at IS NULL",
    now(), input.id, input.expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new ContentProcessingError("revision_conflict");
  return input.expectedRevision + 1;
}

/** Public inbox read contract for Action relation summaries without loading the full library. */
export function listAvailableContentItemsByIds(ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [] as ContentPickerItem[];
  const placeholders = uniqueIds.map(() => "?").join(", ");
  return all<ContentPickerItem>(
    `WITH RECURSIVE ${contentFolderVisibility.recursiveCte}
     SELECT ci.id, ci.title, ci.kind, ci.source_url, ci.project_id, ci.folder_id, ci.updated_at
       FROM content_items ci
      WHERE ci.id IN (${placeholders}) AND ci.trashed_at IS NULL
        AND ${contentFolderVisibility.visiblePredicate}
      ORDER BY ci.updated_at DESC, ci.id DESC`,
    ...uniqueIds,
  );
}

/** Paginated Action relation picker contract. Search never returns trashed or effectively trashed Content. */
export function listContentPickerPage(input: { query?: string; cursor?: string; limit?: number; constrainProject?: boolean; projectId?: string | null } = {}) {
  const cursor = decodeCursor(input.cursor);
  const limit = pageLimit(input.limit, 50);
  const query = normalizeKey(input.query?.normalize("NFKC").trim() ?? "");
  const params: unknown[] = [];
  const queryFilter = query ? "AND eremite_normalize_key(ci.title) LIKE ? ESCAPE '\\'" : "";
  if (query) params.push(`%${escapeLike(query)}%`);
  const projectFilter = input.constrainProject ? (input.projectId ? "AND ci.project_id = ?" : "AND ci.project_id IS NULL") : "";
  if (input.constrainProject && input.projectId) params.push(input.projectId);
  const cursorFilter = cursor ? "AND (ci.updated_at < ? OR (ci.updated_at = ? AND ci.id < ?))" : "";
  if (cursor) params.push(cursor.timestamp, cursor.timestamp, cursor.id);
  params.push(limit + 1);
  const rows = all<ContentPickerItem>(
    `WITH RECURSIVE ${contentFolderVisibility.recursiveCte}
     SELECT ci.id, ci.title, ci.kind, ci.source_url, ci.project_id, ci.folder_id, ci.updated_at
       FROM content_items ci
      WHERE ci.trashed_at IS NULL
        AND ci.status <> 'archived'
        AND ${contentFolderVisibility.visiblePredicate}
        ${queryFilter} ${projectFilter} ${cursorFilter}
      ORDER BY ci.updated_at DESC, ci.id DESC LIMIT ?`,
    ...params,
  );
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const tail = items.at(-1);
  return { items, nextCursor: hasMore && tail ? encodeCursor({ timestamp: tail.updated_at, id: tail.id }) : null };
}

/** Public read contract used by the read-only File Viewer. */
export function getFileAssetForViewing(contentId: string, versionId?: string) {
  return one<FileAssetForViewing>(
    `SELECT ci.id AS contentId, ci.title, ci.created_at AS createdAt,
            fa.id AS assetId, fv.id AS versionId, fv.version_number AS versionNumber,
            CASE WHEN fv.id = fa.current_version_id THEN 1 ELSE 0 END AS isCurrent,
            fv.blob_id AS blobId, fv.original_name AS originalName,
            fv.declared_mime_type AS declaredMimeType, fv.detected_mime_type AS detectedMimeType,
            fv.viewer_kind AS storedViewerKind, fv.created_at AS versionCreatedAt,
            fv.change_source AS changeSource,
            fv.text_encoding AS textEncoding, fv.text_bom AS textBom,
            fv.text_newline AS textNewline, fv.text_trailing_newline AS textTrailingNewline,
            fb.storage_key AS storageKey, fb.byte_size AS byteSize, fb.sha256
       FROM content_items ci
       JOIN file_assets fa ON fa.id = ci.file_asset_id
       JOIN file_versions fv ON fv.asset_id = fa.id
       JOIN file_blobs fb ON fb.id = fv.blob_id
      WHERE ci.id = ? AND ci.kind = 'file'
        AND fv.id = ${versionId ? "?" : "fa.current_version_id"}`,
    ...(versionId ? [contentId, versionId] : [contentId]),
  );
}

const escapeLike = (value: string) => value.replace(/[\\%_]/gu, (character) => `\\${character}`);

export function listFileVersions(contentId: string) {
  return all<FileVersionSummary>(
    `SELECT fv.id, fv.version_number, fv.original_name, fv.declared_mime_type,
            fb.byte_size, fb.sha256, fv.change_source, fv.source_version_id, fv.created_at,
            CASE WHEN fv.id = fa.current_version_id THEN 1 ELSE 0 END AS is_current
       FROM content_items ci
       JOIN file_assets fa ON fa.id = ci.file_asset_id
       JOIN file_versions fv ON fv.asset_id = fa.id
       JOIN file_blobs fb ON fb.id = fv.blob_id
      WHERE ci.id = ? AND ci.kind = 'file'
      ORDER BY fv.version_number DESC`,
    contentId,
  );
}

export async function createFileContentItem(file: File, title?: string) {
  return withDataWriterLease(async () => {
    await reconcilePendingFileWrites();
    const operationId = beginFileWrite("upload");
    let staged: StagedUpload | undefined;
    try {
      staged = await stageUploadedFile(file, maximumFileUploadBytes);
      markFileWriteStaged(operationId, staged);
      return await commitStagedNewFile(operationId, staged, title);
    } catch (error) {
      if (staged) await discardStagedUpload(staged);
      markFileWriteFailed(operationId, error);
      throw error;
    }
  });
}

export async function createFileContentItemFromStream(input: {
  body: ReadableStream<Uint8Array> | null;
  originalName: string;
  mimeType: string;
  expectedSize?: number;
  title?: string;
  projectId?: string | null;
  folderId?: string | null;
  idempotencyKey?: string;
}) {
  return withDataWriterLease(async () => {
    await reconcilePendingFileWrites();
    if (input.idempotencyKey) {
      const existingOperation = getIdempotentOperation(input.idempotencyKey);
      if (existingOperation) {
        const replayed = replayOperation(existingOperation);
        return replayed.contentId;
      }
    }
    const operationId = beginFileWrite("upload", input.idempotencyKey);
    let staged: StagedUpload | undefined;
    try {
      staged = await stageUploadedStream({ ...input, maximumBytes: maximumFileUploadBytes });
      markFileWriteStaged(operationId, staged);
      return await commitStagedNewFile(operationId, staged, input.title, input.projectId, input.folderId);
    } catch (error) {
      if (staged) await discardStagedUpload(staged);
      markFileWriteFailed(operationId, error);
      throw error;
    }
  });
}

export type BatchFileContentInput = {
  body: ReadableStream<Uint8Array> | null;
  originalName: string;
  mimeType: string;
  expectedSize?: number;
  title?: string;
  projectId?: string | null;
  folderId?: string | null;
  idempotencyKey: string;
};

/**
 * Inbox-owned atomic multi-file creation.
 *
 * Every stream is staged and every blob is published before one database
 * transaction creates the complete Content/asset/version set. A failed item
 * therefore cannot leave a partially visible batch. Deterministic per-item
 * idempotency keys make a committed batch replayable after a caller crash.
 */
export async function createFileContentItemsFromStreams(inputs: BatchFileContentInput[]) {
  if (inputs.length < 1 || inputs.length > 256) throw new FileLifecycleError("invalid_metadata");
  const idempotencyKeys = inputs.map((input) => input.idempotencyKey.normalize("NFKC").trim());
  if (idempotencyKeys.some((key) => !key) || new Set(idempotencyKeys).size !== idempotencyKeys.length) throw new FileLifecycleError("invalid_metadata");
  return withDataWriterLease(async () => {
    await reconcilePendingFileWrites();
    const existing = idempotencyKeys.map((key) => getIdempotentOperation(key));
    if (existing.some(Boolean)) {
      if (existing.every((operation) => operation?.state === "committed" && operation.content_id && operation.version_id)) {
        return existing.map((operation) => operation!.content_id!);
      }
      throw new FileLifecycleError("operation_in_progress");
    }
    const operationIds = transaction(() => idempotencyKeys.map((key) => beginFileWrite("upload", key)));
    const staged: Array<{ operationId: string; file: StagedUpload }> = [];
    const promoted: Array<{ operationId: string; stored: StoredFile; created: boolean }> = [];
    try {
      for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index];
        const file = await stageUploadedStream({
          body: input.body,
          originalName: input.originalName,
          mimeType: input.mimeType,
          expectedSize: input.expectedSize,
          maximumBytes: maximumFileUploadBytes,
        });
        const operationId = operationIds[index];
        markFileWriteStaged(operationId, file);
        staged.push({ operationId, file });
      }
      for (const entry of staged) {
        const result = await promoteStagedUpload(entry.file);
        run("UPDATE file_write_operations SET state = 'published', staged_path = NULL, updated_at = ? WHERE id = ?", now(), entry.operationId);
        promoted.push({ operationId: entry.operationId, ...result });
      }
      return transaction(() => promoted.map((entry, index) => {
        const input = inputs[index];
        return insertNewLogicalFile(entry.operationId, entry.stored, input.title, input.projectId, input.folderId);
      }));
    } catch (error) {
      await Promise.all(staged.map((entry) => discardStagedUpload(entry.file)));
      transaction(() => {
        for (const operationId of operationIds) markFileWriteFailed(operationId, error);
      });
      for (const entry of promoted) {
        if (!entry.created) continue;
        const referenced = one<{ id: string }>("SELECT id FROM file_blobs WHERE sha256 = ?", entry.stored.sha256);
        if (!referenced) await unlink(managedFilePath(entry.stored.storageKey)).catch(() => undefined);
      }
      throw error;
    }
  });
}

/** Public recovery receipt for request-bound workflows using the formal File Lifecycle. */
export function getFileCreationByIdempotencyKey(idempotencyKey: string) {
  const operation = one<{ state: string; content_id: string | null; version_id: string | null }>(
    "SELECT state, content_id, version_id FROM file_write_operations WHERE idempotency_key = ? AND operation_type = 'upload'",
    idempotencyKey,
  );
  return operation ? { state: operation.state, contentId: operation.content_id, versionId: operation.version_id } : null;
}

export async function replaceFileContentItemFromStream(input: {
  contentId: string;
  expectedVersionId: string;
  idempotencyKey: string;
  body: ReadableStream<Uint8Array> | null;
  originalName: string;
  mimeType: string;
  expectedSize?: number;
  allowEmpty?: boolean;
  changeSource?: "replace" | "text_edit";
  textMetadata?: { encoding: string; bom: string; newline: "lf" | "crlf" | "cr" | "mixed"; trailingNewline: boolean };
}) {
  return withDataWriterLease(async () => {
    await reconcilePendingFileWrites();
    const existingOperation = getIdempotentOperation(input.idempotencyKey);
    if (existingOperation) return replayOperation(existingOperation);
    assertContentMutable(input.contentId);
    const current = getFileAssetForViewing(input.contentId);
    if (!current) throw new FileLifecycleError("not_found");
    if (current.versionId !== input.expectedVersionId) throw new FileVersionConflictError(current.versionId);
    const operationId = beginFileWrite(input.changeSource ?? "replace", input.idempotencyKey, input.contentId, current.assetId, input.expectedVersionId);
    let staged: StagedUpload | undefined;
    try {
      staged = await stageUploadedStream({ ...input, maximumBytes: maximumFileUploadBytes });
      markFileWriteStaged(operationId, staged);
      const promoted = await promoteStagedUpload(staged);
      run("UPDATE file_write_operations SET state = 'published', staged_path = NULL, updated_at = ? WHERE id = ?", now(), operationId);
      return commitReplacement(operationId, current, promoted.stored, input.changeSource ?? "replace", input.textMetadata);
    } catch (error) {
      if (staged) await discardStagedUpload(staged);
      markFileWriteFailed(operationId, error);
      throw error;
    }
  });
}

export async function restoreFileVersion(input: {
  contentId: string;
  versionId: string;
  expectedVersionId: string;
  idempotencyKey: string;
}) {
  return withDataWriterLease(async () => {
    await reconcilePendingFileWrites();
    const existingOperation = getIdempotentOperation(input.idempotencyKey);
    if (existingOperation) return replayOperation(existingOperation);
    assertContentMutable(input.contentId);
    const current = getFileAssetForViewing(input.contentId);
    if (!current) throw new FileLifecycleError("not_found");
    if (current.versionId !== input.expectedVersionId) throw new FileVersionConflictError(current.versionId);
    const source = getFileAssetForViewing(input.contentId, input.versionId);
    if (!source || source.assetId !== current.assetId) throw new FileLifecycleError("invalid_version");
    const operationId = beginFileWrite("restore", input.idempotencyKey, input.contentId, current.assetId, input.expectedVersionId);
    try {
      return transaction(() => {
        const latest = getFileAssetForViewing(input.contentId);
        if (!latest) throw new FileLifecycleError("not_found");
        if (latest.versionId !== input.expectedVersionId) throw new FileVersionConflictError(latest.versionId);
        const versionId = uuidv7();
        const timestamp = now();
        const versionNumber = nextVersionNumber(current.assetId);
        run(
          `INSERT INTO file_versions (
             id, asset_id, version_number, blob_id, original_name, declared_mime_type,
             detected_mime_type, viewer_kind, change_source, source_version_id,
             text_encoding, text_bom, text_newline, text_trailing_newline, created_at
           )
           SELECT ?, asset_id, ?, blob_id, original_name, declared_mime_type,
                  detected_mime_type, viewer_kind, 'restore', id,
                  text_encoding, text_bom, text_newline, text_trailing_newline, ?
             FROM file_versions WHERE id = ? AND asset_id = ?`,
          versionId, versionNumber, timestamp, source.versionId, current.assetId,
        );
        const switched = run(
          "UPDATE file_assets SET current_version_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND current_version_id = ?",
          versionId, timestamp, current.assetId, input.expectedVersionId,
        );
        if (Number(switched.changes) !== 1) throw new FileVersionConflictError(getFileAssetForViewing(input.contentId)?.versionId ?? input.expectedVersionId);
        completeOperation(operationId, input.contentId, current.assetId, source.blobId, versionId, timestamp);
        return { contentId: input.contentId, versionId, noOp: false };
      });
    } catch (error) {
      markFileWriteFailed(operationId, error);
      throw error;
    }
  });
}

export async function getEditableText(contentId: string, versionId?: string) {
  const asset = getFileAssetForViewing(contentId, versionId);
  if (!asset) throw new FileLifecycleError("not_found");
  if (!(["text", "markdown"] as StoredViewerKind[]).includes(asset.storedViewerKind)) throw new TextEditingError("not_editable");
  if (asset.byteSize > maximumEditableTextBytes) throw new TextEditingError("too_large");
  const bytes = await readFile(managedFilePath(asset.storageKey));
  return { asset, decoded: decodeEditableText(bytes) };
}

export async function saveEditedText(input: {
  contentId: string;
  expectedVersionId: string;
  idempotencyKey: string;
  text: string;
  convertToUtf8: boolean;
}) {
  const current = await getEditableText(input.contentId);
  if (current.asset.versionId !== input.expectedVersionId) throw new FileVersionConflictError(current.asset.versionId);
  const encoded = encodeEditedText(input.text, current.decoded, input.convertToUtf8);
  return replaceFileContentItemFromStream({
    contentId: input.contentId,
    expectedVersionId: input.expectedVersionId,
    idempotencyKey: input.idempotencyKey,
    body: new ReadableStream({ start(controller) { controller.enqueue(encoded.bytes); controller.close(); } }),
    originalName: current.asset.originalName,
    mimeType: current.asset.declaredMimeType,
    expectedSize: encoded.bytes.length,
    allowEmpty: true,
    changeSource: "text_edit",
    textMetadata: encoded.metadata,
  });
}

async function commitStagedNewFile(operationId: string, staged: StagedUpload, title?: string, projectId?: string | null, folderId?: string | null) {
  const promoted = await promoteStagedUpload(staged);
  run("UPDATE file_write_operations SET state = 'published', staged_path = NULL, updated_at = ? WHERE id = ?", now(), operationId);
  return insertNewLogicalFile(operationId, promoted.stored, title, projectId, folderId);
}

function insertNewLogicalFile(operationId: string, stored: StoredFile, title?: string, projectId?: string | null, folderId?: string | null) {
  const timestamp = now();
  return transaction(() => {
    const location = validateLocation(projectId, folderId);
    const existingBlob = one<{ id: string; byte_size: number; storage_key: string }>("SELECT id, byte_size, storage_key FROM file_blobs WHERE sha256 = ?", stored.sha256);
    if (existingBlob && (existingBlob.byte_size !== stored.byteSize || existingBlob.storage_key !== stored.storageKey)) {
      throw new Error("Content-addressed blob metadata collision.");
    }
    const blobId = existingBlob?.id ?? stored.sha256;
    if (!existingBlob) run(
      `INSERT INTO file_blobs (id, sha256, storage_key, byte_size, verification_status, verified_at, created_at)
       VALUES (?, ?, ?, ?, 'ready', ?, ?)`,
      blobId, stored.sha256, stored.storageKey, stored.byteSize, timestamp, timestamp,
    );
    const assetId = stored.id;
    const versionId = uuidv7();
    const contentId = uuidv7();
    const viewerKind = classifyStoredViewerKind(stored.originalName, stored.mimeType);
    run("INSERT INTO file_assets (id, current_version_id, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)", assetId, versionId, timestamp, timestamp);
    run(
      `INSERT INTO file_versions (
         id, asset_id, version_number, blob_id, original_name, declared_mime_type,
         detected_mime_type, viewer_kind, change_source, created_at
       ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'upload', ?)`,
      versionId, assetId, blobId, stored.originalName, stored.mimeType, stored.mimeType, viewerKind, timestamp,
    );
    run(
      "INSERT INTO content_items (id, kind, title, file_asset_id, tags, status, project_id, folder_id, created_at, updated_at) VALUES (?, 'file', ?, ?, '', 'inbox', ?, ?, ?, ?)",
      contentId, title?.trim() || stored.originalName, assetId, location.projectId, location.folderId, timestamp, timestamp,
    );
    run(
      `UPDATE file_write_operations
          SET state = 'committed', content_id = ?, asset_id = ?, blob_id = ?, version_id = ?, committed_at = ?, updated_at = ?
        WHERE id = ?`,
      contentId, assetId, blobId, versionId, timestamp, timestamp, operationId,
    );
    return contentId;
  });
}

export function createLinkContentItem(input: { title: string; url: string; projectId?: string | null; folderId?: string | null }) {
  const url = new URL(input.url).toString();
  const timestamp = now();
  const id = uuidv7();
  transaction(() => {
    const location = validateLocation(input.projectId, input.folderId);
    run(
      "INSERT INTO content_items (id, kind, title, source_url, status, project_id, folder_id, created_at, updated_at) VALUES (?, 'link', ?, ?, 'inbox', ?, ?, ?, ?)",
      id, input.title.trim() || url, url, location.projectId, location.folderId, timestamp, timestamp,
    );
  });
  return id;
}

export function updateContentItem(input: { id: string; title: string; status: InboxStatus; expectedRevision: number }) {
  const title = input.title.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!title || title.length > 500 || !["inbox", "processed", "archived"].includes(input.status)) throw new FileLifecycleError("invalid_metadata");
  const current = getContentItemSummary(input.id);
  if (!current || current.trashed_at || current.revision !== input.expectedRevision) throw new FileLifecycleError("revision_conflict");
  if (!isAllowedMetadataStatusTransition(current.status, input.status)) throw new FileLifecycleError("invalid_status_transition");
  const result = run(
    "UPDATE content_items SET title = ?, status = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NULL",
    title, input.status, now(), input.id, input.expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new FileLifecycleError("revision_conflict");
}

function isAllowedMetadataStatusTransition(current: InboxStatus, next: InboxStatus) {
  if (current === "inbox") return next === "inbox";
  return next === "processed" || next === "archived";
}

/** Compatibility projection for v1.1 callers; Tags remains the source of truth in v1.2. */
export function synchronizeContentTagText(contentId: string, names: string[]) {
  run("UPDATE content_items SET tags = ? WHERE id = ?", names.join(", "), contentId);
}

export function moveContentItems(input: { ids: Array<{ id: string; expectedRevision: number }>; projectId: string | null; folderId: string | null }) {
  const uniqueItems = [...new Map(input.ids.map((item) => [item.id, item])).values()];
  if (uniqueItems.length === 0) return;
  transaction(() => {
    const location = validateLocation(input.projectId, input.folderId);
    for (const item of uniqueItems) {
      const current = getAvailableContentItemSummary(item.id);
      if (!current || current.revision !== item.expectedRevision) throw new FileLifecycleError("revision_conflict");
    }
    const timestamp = now();
    for (const item of uniqueItems) {
      const result = run(
        "UPDATE content_items SET project_id = ?, folder_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NULL",
        location.projectId, location.folderId, timestamp, item.id, item.expectedRevision,
      );
      if (Number(result.changes) !== 1) throw new FileLifecycleError("revision_conflict");
    }
  });
}

/** App-layer folder move uses this inside the same transaction as folder project changes. */
export function reassignFolderSubtreeContent(folderIds: string[], targetProjectId: string) {
  if (folderIds.length === 0) return;
  const placeholders = folderIds.map(() => "?").join(", ");
  run(
    `UPDATE content_items SET project_id = ?, revision = revision + 1, updated_at = ? WHERE folder_id IN (${placeholders})`,
    targetProjectId, now(), ...folderIds,
  );
}

export function listContentIdsInFolders(folderIds: string[]) {
  if (folderIds.length === 0) return [] as string[];
  const placeholders = folderIds.map(() => "?").join(", ");
  return all<{ id: string }>(`SELECT id FROM content_items WHERE folder_id IN (${placeholders}) ORDER BY id`, ...folderIds).map((row) => row.id);
}

export function trashContentItem(id: string, expectedRevision: number) {
  const result = run(
    `UPDATE content_items
        SET restore_folder_id = folder_id, folder_id = NULL, trashed_at = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ? AND trashed_at IS NULL`,
    now(), now(), id, expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new FileLifecycleError("not_found");
}

export function restoreContentItem(id: string, expectedRevision: number) {
  const item = getContentItemSummary(id);
  if (!item || !item.trashed_at) throw new FileLifecycleError("not_found");
  const project = item.project_id ? getProject(item.project_id) : null;
  const activeProjectId = project && !project.trashed_at && !project.archived_at ? project.id : null;
  const folder = item.folder_id ? isFolderAvailable(item.folder_id, activeProjectId ?? undefined) : item.restore_folder_id ? isFolderAvailable(item.restore_folder_id, activeProjectId ?? undefined) : null;
  const folderId = activeProjectId ? folder?.id ?? null : null;
  const result = run(
    `UPDATE content_items
        SET project_id = ?, folder_id = ?, restore_folder_id = NULL, trashed_at = NULL,
            revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ? AND trashed_at IS NOT NULL`,
    activeProjectId, folderId, now(), id, expectedRevision,
  );
  if (Number(result.changes) !== 1) throw new FileLifecycleError("not_found");
  return { projectId: activeProjectId, folderId, fallbackToRoot: Boolean(item.restore_folder_id && !folderId) };
}

export function permanentlyDeleteContentItems(ids: string[], options: { allowInheritedFolderTrash?: boolean } = {}) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return { deleted: 0 };
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = all<{ id: string; file_asset_id: string | null; trashed_at: string | null }>(
    `SELECT id, file_asset_id, trashed_at FROM content_items WHERE id IN (${placeholders})`, ...uniqueIds,
  );
  if (rows.length !== uniqueIds.length || (!options.allowInheritedFolderTrash && rows.some((row) => !row.trashed_at))) throw new FileLifecycleError("not_found");
  run(`DELETE FROM content_items WHERE id IN (${placeholders})`, ...uniqueIds);
  const assetIds = rows.map((row) => row.file_asset_id).filter((id): id is string => Boolean(id));
  if (assetIds.length > 0) {
    const assetPlaceholders = assetIds.map(() => "?").join(", ");
    run(`DELETE FROM file_assets WHERE id IN (${assetPlaceholders})`, ...assetIds);
  }
  enqueueUnreferencedBlobs();
  return { deleted: rows.length };
}

export function detachAllProjectContent(projectId: string) {
  run("UPDATE content_items SET project_id = NULL, folder_id = NULL, restore_folder_id = NULL, revision = revision + 1, updated_at = ? WHERE project_id = ?", now(), projectId);
}

export function countProjectContent(projectId: string) {
  return Number(one<{ count: number }>("SELECT COUNT(*) AS count FROM content_items WHERE project_id = ?", projectId)?.count ?? 0);
}

export async function reconcilePendingFileWrites(limit = 100) {
  const operations = all<{ id: string; state: string; staged_path: string | null }>(
    "SELECT id, state, staged_path FROM file_write_operations WHERE state IN ('created', 'staged', 'published') ORDER BY created_at LIMIT ?",
    limit,
  );
  for (const operation of operations) {
    if (operation.staged_path && isManagedStagingPath(operation.staged_path)) {
      const details = await stat(operation.staged_path).catch(() => null);
      if (details?.isFile()) {
        await discardStagedUpload({ stagingPath: operation.staged_path } as StagedUpload);
      }
    }
    run(
      "UPDATE file_write_operations SET state = 'reconciled', staged_path = NULL, error_code = ?, updated_at = ? WHERE id = ?",
      `startup_reconcile_${operation.state}`, now(), operation.id,
    );
  }
  return operations.length;
}

function beginFileWrite(operationType: FileWriteOperationType, idempotencyKey?: string, contentId?: string, assetId?: string, expectedVersionId?: string) {
  const id = uuidv7();
  const timestamp = now();
  run(
    `INSERT INTO file_write_operations (
       id, idempotency_key, operation_type, state, content_id, asset_id, expected_version_id, created_at, updated_at
     ) VALUES (?, ?, ?, 'created', ?, ?, ?, ?, ?)`,
    id, idempotencyKey ?? null, operationType, contentId ?? null, assetId ?? null, expectedVersionId ?? null, timestamp, timestamp,
  );
  return id;
}

function commitReplacement(
  operationId: string,
  current: FileAssetForViewing,
  stored: StoredFile,
  changeSource: "replace" | "text_edit",
  textMetadata?: { encoding: string; bom: string; newline: "lf" | "crlf" | "cr" | "mixed"; trailingNewline: boolean },
) {
  return transaction(() => {
    const latest = getFileAssetForViewing(current.contentId);
    if (!latest) throw new FileLifecycleError("not_found");
    if (latest.versionId !== current.versionId) throw new FileVersionConflictError(latest.versionId);
    const existingBlob = one<{ id: string; byte_size: number; storage_key: string }>("SELECT id, byte_size, storage_key FROM file_blobs WHERE sha256 = ?", stored.sha256);
    if (existingBlob && (existingBlob.byte_size !== stored.byteSize || existingBlob.storage_key !== stored.storageKey)) throw new Error("Content-addressed blob metadata collision.");
    const blobId = existingBlob?.id ?? stored.sha256;
    const timestamp = now();
    if (!existingBlob) run(
      `INSERT INTO file_blobs (id, sha256, storage_key, byte_size, verification_status, verified_at, created_at)
       VALUES (?, ?, ?, ?, 'ready', ?, ?)`,
      blobId, stored.sha256, stored.storageKey, stored.byteSize, timestamp, timestamp,
    );
    const metadataUnchanged = !textMetadata || (
      current.textEncoding === textMetadata.encoding
      && current.textBom === textMetadata.bom
      && current.textNewline === textMetadata.newline
      && current.textTrailingNewline === Number(textMetadata.trailingNewline)
    );
    if (stored.sha256 === current.sha256 && stored.originalName === current.originalName && stored.mimeType === current.declaredMimeType && metadataUnchanged) {
      completeOperation(operationId, current.contentId, current.assetId, blobId, current.versionId, timestamp);
      return { contentId: current.contentId, versionId: current.versionId, noOp: true };
    }
    const versionId = uuidv7();
    const versionNumber = nextVersionNumber(current.assetId);
    run(
      `INSERT INTO file_versions (
         id, asset_id, version_number, blob_id, original_name, declared_mime_type,
         detected_mime_type, viewer_kind, change_source,
         text_encoding, text_bom, text_newline, text_trailing_newline, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      versionId, current.assetId, versionNumber, blobId, stored.originalName, stored.mimeType,
      stored.mimeType, classifyStoredViewerKind(stored.originalName, stored.mimeType), changeSource,
      textMetadata?.encoding ?? null, textMetadata?.bom ?? null, textMetadata?.newline ?? null,
      textMetadata ? Number(textMetadata.trailingNewline) : null, timestamp,
    );
    const switched = run(
      "UPDATE file_assets SET current_version_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND current_version_id = ?",
      versionId, timestamp, current.assetId, current.versionId,
    );
    if (Number(switched.changes) !== 1) throw new FileVersionConflictError(getFileAssetForViewing(current.contentId)?.versionId ?? current.versionId);
    run("UPDATE content_items SET updated_at = ? WHERE id = ?", timestamp, current.contentId);
    completeOperation(operationId, current.contentId, current.assetId, blobId, versionId, timestamp);
    return { contentId: current.contentId, versionId, noOp: false };
  });
}

function completeOperation(operationId: string, contentId: string, assetId: string, blobId: string, versionId: string, timestamp: string) {
  run(
    `UPDATE file_write_operations
        SET state = 'committed', content_id = ?, asset_id = ?, blob_id = ?, version_id = ?, committed_at = ?, updated_at = ?
      WHERE id = ?`,
    contentId, assetId, blobId, versionId, timestamp, timestamp, operationId,
  );
}

function nextVersionNumber(assetId: string) {
  const row = one<{ next_version: number }>("SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM file_versions WHERE asset_id = ?", assetId);
  return row?.next_version ?? 1;
}

type IdempotentOperation = { state: string; content_id: string | null; version_id: string | null };

function getIdempotentOperation(key: string) {
  return one<IdempotentOperation>("SELECT state, content_id, version_id FROM file_write_operations WHERE idempotency_key = ?", key);
}

function replayOperation(operation: IdempotentOperation) {
  if (operation.state === "committed" && operation.content_id && operation.version_id) {
    return { contentId: operation.content_id, versionId: operation.version_id, noOp: true, replayed: true };
  }
  throw new FileLifecycleError("operation_in_progress");
}

function markFileWriteStaged(operationId: string, staged: StagedUpload) {
  run("UPDATE file_write_operations SET state = 'staged', staged_path = ?, updated_at = ? WHERE id = ?", staged.stagingPath, now(), operationId);
}

function markFileWriteFailed(operationId: string, error: unknown) {
  try {
    run(
      "UPDATE file_write_operations SET state = 'failed', staged_path = NULL, error_code = ?, updated_at = ? WHERE id = ? AND state <> 'committed'",
      error instanceof Error ? error.message.slice(0, 500) : "unexpected_error", now(), operationId,
    );
  } catch {
    // Preserve the original write failure; startup reconciliation handles an unfinished journal row.
  }
}

function isManagedStagingPath(candidate: string) {
  const resolved = path.resolve(candidate);
  return path.dirname(resolved) === path.resolve(filesDirectory, ".upload-staging") && /^[0-9a-f-]+\.part$/iu.test(path.basename(resolved));
}

function assertContentMutable(contentId: string) {
  const mutable = one<{ id: string }>(
    `WITH RECURSIVE selected_content(folder_id) AS (
       SELECT folder_id FROM content_items WHERE id = ? AND trashed_at IS NULL
     ),
     ${selectedContentFolderVisibility.recursiveCte}
     SELECT item.id FROM content_items item
       WHERE item.id = ? AND item.trashed_at IS NULL
         AND ${selectedContentFolderVisibility.visiblePredicate}`,
    contentId, contentId,
  );
  if (!mutable) throw new FileLifecycleError("not_found");
}

function validateLocation(projectId?: string | null, folderId?: string | null) {
  if (folderId && !projectId) throw new FileLifecycleError("invalid_location");
  if (!projectId) return { projectId: null, folderId: null };
  assertProjectAcceptsMembers(projectId);
  if (folderId && !isFolderAvailable(folderId, projectId)) throw new FileLifecycleError("invalid_location");
  return { projectId, folderId: folderId ?? null };
}


function classifyStoredViewerKind(filename: string, mimeType: string): StoredViewerKind {
  const lower = filename.toLocaleLowerCase("und");
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (mimeType === "text/markdown" || lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (mimeType.startsWith("text/") || lower.endsWith(".txt")) return "text";
  if (mimeType.startsWith("image/") || /\.(?:jpe?g|png|webp)$/u.test(lower)) return "image";
  if (lower.endsWith(".docx")) return "docx";
  if (mimeType === "application/zip" || lower.endsWith(".zip")) return "archive";
  if (mimeType.startsWith("video/") || /\.(?:mp4|m4v|webm)$/u.test(lower)) return "video";
  return "unsupported";
}
