import path from "node:path";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { AutomationContextError } from "@/modules/automations/tools/content-to-action-drafts";
import { FILE_CONVERTER_TOOL_ID } from "@/modules/automations/tools/catalog";
import { createFileContentItemFromStream, getAvailableContentItemSummary, getFileAssetForViewing, getFileCreationByIdempotencyKey, listContentPickerPage } from "@/modules/inbox/service";
import { assertProjectAcceptsMembers } from "@/modules/projects/service";
import { getFolderBreadcrumbs, isFolderAvailable, listProjectFolders } from "@/modules/projects/folders";
import { managedFilePath } from "@/platform/files/service";
import { run } from "@/platform/db/database";
import { getAcceptedFileConversion, listAcceptedFileConversionsForSource, type FileConverterFormat } from "@/modules/automations/tools/file-converter/authority";
import { withFileConverterOutput, FileConverterProtocolError } from "@/modules/automations/tools/file-converter/host-adapter";
import { fileConverterFormat, type FileConverterFailure, type FileConverterSuccess } from "@/modules/automations/tools/file-converter/contract";
import { getFileConverterAvailability } from "@/modules/automations/tools/file-converter/availability";

export type FileConverterToolInput = {
  contentItemId: string; conversionId: string; profile: string; projectId: string | null; folderId: string | null; folderNameSnapshot: string | null;
  item: NonNullable<ReturnType<typeof getAvailableContentItemSummary>>; asset: NonNullable<ReturnType<typeof getFileAssetForViewing>>; sourceFormat: FileConverterFormat;
};
export type FileConverterToolOutput = {
  schemaVersion: 1; contentId: string; assetId: string; versionId: string; blobId: string; originalName: string; mimeType: string; byteSize: number; sha256: string; previewable: boolean;
  supplier: { coreVersion: string; engine: { id: string; version: string }; fallback: FileConverterSuccess["fallback"]; durationMs: number; warnings: string[] };
};
export class FileConverterBusinessError extends Error { constructor(public readonly response: FileConverterFailure) { super(response.errors[0]?.code ?? "FC_INTERNAL_ERROR"); this.name = "FileConverterBusinessError"; } }

export const fileConverterServerTool = {
  toolId: FILE_CONVERTER_TOOL_ID,
  executionPolicy: { mode: "request" as const, runner: "external" as const, staleAfterMs: 20 * 60 * 1000 },
  validateInput(raw: unknown, context: { projectId?: string | null }): FileConverterToolInput {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const contentItemId = String(value.contentItemId ?? "").trim(); const conversionId = String(value.conversionId ?? "").trim();
    const item = getAvailableContentItemSummary(contentItemId); const asset = item?.kind === "file" ? getFileAssetForViewing(contentItemId) : null;
    if (!item || !asset || item.status === "archived") throw new AutomationContextError("input_unavailable");
    const sourceFormat = inferFileConverterSource(asset.originalName, asset.declaredMimeType); const conversion = sourceFormat ? getAcceptedFileConversion(conversionId) : null;
    if (!sourceFormat || !conversion || conversion.source !== sourceFormat) throw new AutomationContextError("input_unavailable");
    const projectId = context.projectId === undefined ? item.project_id : context.projectId;
    if (projectId !== item.project_id) throw new AutomationContextError("project_mismatch"); assertProjectAcceptsMembers(projectId);
    const requestedFolderId = String(value.folderId ?? "").trim() || null; let folderId: string | null = null; let folderNameSnapshot: string | null = null;
    if (projectId) { folderId = requestedFolderId ?? item.folder_id; if (folderId) { const folder = isFolderAvailable(folderId, projectId); if (!folder) throw new AutomationContextError("project_mismatch"); folderNameSnapshot = folder.name; } }
    else if (requestedFolderId) throw new AutomationContextError("project_mismatch");
    const profile = String(value.profile ?? conversion.defaultProfile); if (!conversion.profiles.includes(profile)) throw new AutomationContextError("input_unavailable");
    return { contentItemId, conversionId, profile, projectId, folderId, folderNameSnapshot, item, asset, sourceFormat };
  },
  encodeInputPayload(input: FileConverterToolInput) { return { schemaVersion: 1, contentItemId: input.contentItemId, sourceVersionId: input.asset.versionId, conversionId: input.conversionId, profile: input.profile, destination: { projectId: input.projectId, folderId: input.folderId, folderNameSnapshot: input.folderNameSnapshot } }; },
  summarizeInput(input: FileConverterToolInput) { return `${input.asset.originalName} → ${fileConverterFormat(getAcceptedFileConversion(input.conversionId)!.target).extension.slice(1).toUpperCase()}`; },
  captureInputSnapshot(runId: string, input: FileConverterToolInput) { run(`INSERT INTO automation_run_inputs (run_id, ordinal, content_id, content_title_snapshot, file_version_id, file_name_snapshot, file_sha256_snapshot, file_byte_size_snapshot) VALUES (?, 0, ?, ?, ?, ?, ?, ?)`, runId, input.contentItemId, input.item.title, input.asset.versionId, input.asset.originalName, input.asset.sha256, input.asset.byteSize); },
  async executeExternal(input: FileConverterToolInput, context: { runId: string; writePending: (payload: unknown) => void }): Promise<FileConverterToolOutput> {
    const conversion = getAcceptedFileConversion(input.conversionId)!; const target = fileConverterFormat(conversion.target);
    const result = await withFileConverterOutput({ invocationId: context.runId, sourcePath: managedFilePath(input.asset.storageKey), displayName: input.asset.originalName, declaredMediaType: input.asset.declaredMimeType, expectedSize: input.asset.byteSize, expectedSha256: input.asset.sha256, sourceFormat: input.sourceFormat, conversionId: input.conversionId, profile: input.profile }, async (output, response) => {
      context.writePending({ schemaVersion: 1, phase: "supplier_validated", output: { byteSize: output.byteSize, sha256: output.sha256, format: output.format }, supplier: supplierSnapshot(response) });
      const originalName = `${path.basename(input.asset.originalName, path.extname(input.asset.originalName))}${target.extension}`;
      const contentId = await createFileContentItemFromStream({ body: Readable.toWeb(createReadStream(output.path)) as ReadableStream<Uint8Array>, originalName, mimeType: target.mediaType, expectedSize: output.byteSize, title: `${input.item.title} · ${target.formatId.toUpperCase()}`, projectId: input.projectId, folderId: input.folderId, idempotencyKey: `automation:${context.runId}:output:0` });
      const created = getFileAssetForViewing(contentId); if (!created) throw new Error("file_converter_created_content_missing");
      return { schemaVersion: 1 as const, contentId, assetId: created.assetId, versionId: created.versionId, blobId: created.blobId, originalName: created.originalName, mimeType: created.declaredMimeType, byteSize: created.byteSize, sha256: created.sha256, previewable: conversion.previewable, supplier: supplierSnapshot(response) };
    });
    if (!("value" in result)) throw new FileConverterBusinessError(result.response);
    return result.value;
  },
  encodeOutputPayload(output: FileConverterToolOutput) { return output; },
  summarizeOutput(output: FileConverterToolOutput) { return `已创建 ${getAvailableContentItemSummary(output.contentId)?.title ?? output.originalName}（${formatBytes(output.byteSize)}）`; },
  mapError(error: unknown) { if (error instanceof FileConverterBusinessError) { const item = error.response.errors[0]!; return { code: item.code, message: hostFailureMessage(item.code) }; } if (error instanceof FileConverterProtocolError) return { code: error.code, message: "转换服务未能完成安全调用，未保存任何结果。" }; return { code: "host_file_converter_failed", message: "转换结果未能提交到资料库。" }; },
  getAvailability: getFileConverterAvailability,
  recoverInterruptedRun(candidate: { id: string; input_payload_json: string; output_payload_json: string | null }) {
    if (!candidate.output_payload_json) return null;
    const pending = JSON.parse(candidate.output_payload_json) as { schemaVersion?: number; phase?: string; supplier?: FileConverterToolOutput["supplier"] };
    if (pending.schemaVersion !== 1 || pending.phase !== "supplier_validated" || !pending.supplier) return null;
    const receipt = getFileCreationByIdempotencyKey(`automation:${candidate.id}:output:0`);
    if (receipt?.state !== "committed" || !receipt.contentId) return null;
    const created = getFileAssetForViewing(receipt.contentId); if (!created) return null;
    const inputPayload = JSON.parse(candidate.input_payload_json) as { conversionId?: string };
    const conversion = inputPayload.conversionId ? getAcceptedFileConversion(inputPayload.conversionId) : null;
    if (!conversion) return null;
    const output: FileConverterToolOutput = { schemaVersion: 1, contentId: created.contentId, assetId: created.assetId, versionId: created.versionId, blobId: created.blobId, originalName: created.originalName, mimeType: created.declaredMimeType, byteSize: created.byteSize, sha256: created.sha256, previewable: conversion.previewable, supplier: pending.supplier };
    return { outputPayload: output, outputSummary: this.summarizeOutput(output) };
  },
  listInputOptions(input: { query?: string; cursor?: string; limit?: number; projectId?: string | null; constrainProject?: boolean }) {
    const page = listContentPickerPage(input);
    const destinationFolders = input.constrainProject && input.projectId ? listProjectFolders(input.projectId).map((folder) => ({ id: folder.id, path: getFolderBreadcrumbs(folder.id).map((entry) => entry.name).join(" / ") })) : [];
    return { items: page.items.filter((item) => item.kind === "file").flatMap((item) => { const asset = getFileAssetForViewing(item.id); const source = asset ? inferFileConverterSource(asset.originalName, asset.declaredMimeType) : null; return asset && source && listAcceptedFileConversionsForSource(source).length ? [{ ...item, originalName: asset.originalName, sourceFormat: source, conversions: listAcceptedFileConversionsForSource(source).map((entry) => entry.id) }] : []; }), destinationFolders, nextCursor: page.nextCursor };
  },
};

export function inferFileConverterSource(filename: string, mimeType: string): FileConverterFormat | null {
  const ext = path.extname(filename).toLowerCase(); const mime = mimeType.toLowerCase().split(";", 1)[0];
  if (ext === ".png" || mime === "image/png") return "png"; if ([".jpg", ".jpeg"].includes(ext) || mime === "image/jpeg") return "jpeg"; if (ext === ".webp" || mime === "image/webp") return "webp"; if (ext === ".avif" || mime === "image/avif") return "avif";
  if ([".md", ".markdown"].includes(ext) || ["text/markdown", "text/x-markdown"].includes(mime)) return "markdown"; if ([".html", ".htm"].includes(ext) || mime === "text/html") return "html";
  if (ext === ".docx" || mime.includes("wordprocessingml.document")) return "docx"; if (ext === ".xlsx" || mime.includes("spreadsheetml.sheet")) return "xlsx"; if (ext === ".pptx" || mime.includes("presentationml.presentation")) return "pptx"; return null;
}
function supplierSnapshot(response: FileConverterSuccess) { return { coreVersion: response.coreVersion, engine: response.engine, fallback: response.fallback, durationMs: response.durationMs, warnings: response.warnings.map((warning) => warning.code) }; }
function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`; }
function hostFailureMessage(code: string) { if (code === "FC_DEPENDENCY_MISSING" || code === "FC_DEPENDENCY_INCOMPATIBLE") return "所需本地转换组件当前不可用。"; if (/SOURCE|INPUT|ENCRYPTED|MACRO|EXTERNAL|RESOURCE_BUNDLE/u.test(code)) return "来源文件无法按所选格式安全转换。"; if (code.includes("OUTPUT")) return "转换结果未通过 Eremite 安全校验，未保存任何结果。"; return "文件转换失败，未保存任何结果。"; }
