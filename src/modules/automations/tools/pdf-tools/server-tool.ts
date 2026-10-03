import path from "node:path";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { AutomationContextError } from "@/modules/automations/tools/content-to-action-drafts";
import {
  createFileContentItemsFromStreams,
  getAvailableContentItemSummary,
  getFileAssetForViewing,
  getFileCreationByIdempotencyKey,
  listContentPickerPage,
} from "@/modules/inbox/service";
import { assertProjectAcceptsMembers } from "@/modules/projects/service";
import { getFolderBreadcrumbs, isFolderAvailable, listProjectFolders } from "@/modules/projects/folders";
import { managedFilePath } from "@/platform/files/service";
import { run } from "@/platform/db/database";
import {
  getAcceptedPdfToolsCapability,
  PDF_TOOLS_TOOL_ID,
  type PdfToolsOperation,
} from "@/modules/automations/tools/pdf-tools/authority";
import {
  type PdfToolsFailure,
  type PdfToolsParameters,
  type PdfToolsSuccess,
} from "@/modules/automations/tools/pdf-tools/contract";
import { withPdfToolsOutputs, PdfToolsProtocolError } from "@/modules/automations/tools/pdf-tools/host-adapter";
import { getPdfToolsAvailability } from "@/modules/automations/tools/pdf-tools/availability";
import { resolveInstalledPdfTools } from "@/modules/automations/tools/pdf-tools/runtime";

type Item = NonNullable<ReturnType<typeof getAvailableContentItemSummary>>;
type Asset = NonNullable<ReturnType<typeof getFileAssetForViewing>>;

export type PdfToolsInput = {
  operation: PdfToolsOperation;
  parameters?: PdfToolsParameters;
  contentItemIds: string[];
  projectId: string | null;
  folderId: string | null;
  folderNameSnapshot: string | null;
  items: Item[];
  assets: Asset[];
};

export type PdfToolsOutputItem = {
  contentId: string;
  assetId: string;
  versionId: string;
  blobId: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  pageCount: number;
};

export type PdfToolsOutput = {
  schemaVersion: 1;
  operation: PdfToolsOperation;
  outputs: PdfToolsOutputItem[];
  supplier: {
    packageVersion: string;
    coreVersion: string;
    protocolVersion: 1;
    qpdfVersion: string;
    qpdfSha256: string;
    warnings: string[];
  };
};

export class PdfToolsBusinessError extends Error {
  constructor(public readonly response: PdfToolsFailure) {
    super(response.error.code);
    this.name = "PdfToolsBusinessError";
  }
}

export const pdfToolsServerTool = {
  toolId: PDF_TOOLS_TOOL_ID,
  executionPolicy: { mode: "request" as const, runner: "external" as const, staleAfterMs: 25 * 60 * 1000 },

  validateInput(raw: unknown, context: { projectId?: string | null }): PdfToolsInput {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const operation = String(value.operation ?? "") as PdfToolsOperation;
    const capability = getAcceptedPdfToolsCapability(operation);
    if (!capability) throw new AutomationContextError("input_unavailable");
    const ids = Array.isArray(value.contentItemIds) ? value.contentItemIds.map(String).map((id) => id.trim()).filter(Boolean) : [];
    if (new Set(ids).size !== ids.length || ids.length < capability.minimumInputs || ids.length > capability.maximumInputs) throw new AutomationContextError("input_unavailable");
    const pairs = ids.map((id) => {
      const item = getAvailableContentItemSummary(id);
      const asset = item?.kind === "file" ? getFileAssetForViewing(id) : null;
      if (!item || !asset || item.status === "archived" || !isPdf(asset.originalName, asset.declaredMimeType)) throw new AutomationContextError("input_unavailable");
      return { item, asset };
    });
    const sourceProjectId = pairs[0]?.item.project_id ?? null;
    if (pairs.some(({ item }) => item.project_id !== sourceProjectId)) throw new AutomationContextError("project_mismatch");
    const projectId = context.projectId === undefined ? sourceProjectId : context.projectId;
    if (projectId !== sourceProjectId) throw new AutomationContextError("project_mismatch");
    assertProjectAcceptsMembers(projectId);
    const requestedFolderId = String(value.folderId ?? "").trim() || null;
    let folderId: string | null = null;
    let folderNameSnapshot: string | null = null;
    if (projectId) {
      folderId = requestedFolderId ?? pairs[0].item.folder_id;
      if (folderId) {
        const folder = isFolderAvailable(folderId, projectId);
        if (!folder) throw new AutomationContextError("project_mismatch");
        folderNameSnapshot = folder.name;
      }
    } else if (requestedFolderId) {
      throw new AutomationContextError("project_mismatch");
    }
    const parameters = parseParameters(operation, value);
    return {
      operation,
      ...(parameters === undefined ? {} : { parameters }),
      contentItemIds: ids,
      projectId,
      folderId,
      folderNameSnapshot,
      items: pairs.map(({ item }) => item),
      assets: pairs.map(({ asset }) => asset),
    };
  },

  encodeInputPayload(input: PdfToolsInput) {
    return {
      schemaVersion: 1,
      operation: input.operation,
      inputs: input.contentItemIds.map((contentId, index) => ({ contentId, versionId: input.assets[index].versionId })),
      ...(input.parameters === undefined ? {} : { parameters: input.parameters }),
      destination: { projectId: input.projectId, folderId: input.folderId, folderNameSnapshot: input.folderNameSnapshot },
    };
  },

  summarizeInput(input: PdfToolsInput) {
    return `${operationLabel(input.operation)} · ${input.assets.length} 个 PDF`;
  },

  captureInputSnapshot(runId: string, input: PdfToolsInput) {
    input.assets.forEach((asset, index) => {
      run(
        `INSERT INTO automation_run_inputs
          (run_id, ordinal, content_id, content_title_snapshot, file_version_id, file_name_snapshot, file_sha256_snapshot, file_byte_size_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        runId, index, input.contentItemIds[index], input.items[index].title, asset.versionId, asset.originalName, asset.sha256, asset.byteSize,
      );
    });
  },

  async executeExternal(input: PdfToolsInput, context: { runId: string; writePending: (payload: unknown) => void }): Promise<PdfToolsOutput> {
    const result = await withPdfToolsOutputs({
      invocationId: context.runId,
      operation: input.operation,
      inputs: input.assets.map((asset) => ({
        sourcePath: managedFilePath(asset.storageKey),
        displayName: asset.originalName,
        expectedSize: asset.byteSize,
        expectedSha256: asset.sha256,
      })),
      ...(input.parameters === undefined ? {} : { parameters: input.parameters }),
    }, async (outputs, response) => {
      const installed = await resolveInstalledPdfTools();
      const supplier = supplierSnapshot(response, installed.packageVersion, installed.qpdfVersion, installed.qpdfSha256);
      context.writePending({
        schemaVersion: 1,
        phase: "supplier_validated",
        operation: input.operation,
        outputs: outputs.map((output) => ({
          displayName: output.displayName,
          byteSize: output.byteSize,
          sha256: output.sha256,
          pageCount: output.pageCount,
        })),
        supplier,
      });
      const contentIds = await createFileContentItemsFromStreams(outputs.map((output, index) => ({
        body: Readable.toWeb(createReadStream(output.path)) as ReadableStream<Uint8Array>,
        originalName: output.displayName,
        mimeType: "application/pdf",
        expectedSize: output.byteSize,
        title: outputTitle(input, index, outputs.length),
        projectId: input.projectId,
        folderId: input.folderId,
        idempotencyKey: outputIdempotencyKey(context.runId, index),
      })));
      const created = contentIds.map((contentId, index) => {
        const asset = getFileAssetForViewing(contentId);
        if (!asset) throw new Error("pdf_tools_created_content_missing");
        return {
          contentId,
          assetId: asset.assetId,
          versionId: asset.versionId,
          blobId: asset.blobId,
          originalName: asset.originalName,
          mimeType: asset.declaredMimeType,
          byteSize: asset.byteSize,
          sha256: asset.sha256,
          pageCount: outputs[index].pageCount,
        };
      });
      return { schemaVersion: 1 as const, operation: input.operation, outputs: created, supplier };
    });
    if (!("value" in result)) throw new PdfToolsBusinessError(result.response);
    return result.value;
  },

  encodeOutputPayload(output: PdfToolsOutput) {
    return output;
  },

  summarizeOutput(output: PdfToolsOutput) {
    return output.outputs.length === 1
      ? `已创建 ${getAvailableContentItemSummary(output.outputs[0].contentId)?.title ?? output.outputs[0].originalName}（${formatBytes(output.outputs[0].byteSize)}）`
      : `已创建 ${output.outputs.length} 条资料 · ${operationLabel(output.operation)}（${formatBytes(output.outputs.reduce((sum, item) => sum + item.byteSize, 0))}）`;
  },

  mapError(error: unknown) {
    if (error instanceof PdfToolsBusinessError) return { code: error.response.error.code, message: hostFailureMessage(error.response.error.code) };
    if (error instanceof PdfToolsProtocolError) return { code: error.code, message: "PDF 工具未能完成安全调用，未保存任何结果。" };
    return { code: "host_pdf_tools_failed", message: "PDF 结果未能完整提交到资料库。" };
  },

  getAvailability: getPdfToolsAvailability,

  recoverInterruptedRun(candidate: { id: string; input_payload_json: string; output_payload_json: string | null }) {
    if (!candidate.output_payload_json) return null;
    const pending = JSON.parse(candidate.output_payload_json) as {
      schemaVersion?: number;
      phase?: string;
      operation?: PdfToolsOperation;
      outputs?: Array<{ pageCount?: number }>;
      supplier?: PdfToolsOutput["supplier"];
    };
    if (pending.schemaVersion !== 1 || pending.phase !== "supplier_validated" || !pending.operation || !pending.supplier || !Array.isArray(pending.outputs) || pending.outputs.length < 1) return null;
    const outputs: PdfToolsOutputItem[] = [];
    for (let index = 0; index < pending.outputs.length; index += 1) {
      const receipt = getFileCreationByIdempotencyKey(outputIdempotencyKey(candidate.id, index));
      if (receipt?.state !== "committed" || !receipt.contentId) return null;
      const asset = getFileAssetForViewing(receipt.contentId);
      const pageCount = pending.outputs[index]?.pageCount;
      if (!asset || !Number.isSafeInteger(pageCount) || Number(pageCount) < 1) return null;
      outputs.push({
        contentId: asset.contentId,
        assetId: asset.assetId,
        versionId: asset.versionId,
        blobId: asset.blobId,
        originalName: asset.originalName,
        mimeType: asset.declaredMimeType,
        byteSize: asset.byteSize,
        sha256: asset.sha256,
        pageCount: Number(pageCount),
      });
    }
    const output: PdfToolsOutput = { schemaVersion: 1, operation: pending.operation, outputs, supplier: pending.supplier };
    return { outputPayload: output, outputSummary: this.summarizeOutput(output) };
  },

  listInputOptions(input: { query?: string; cursor?: string; limit?: number; projectId?: string | null; constrainProject?: boolean }) {
    const page = listContentPickerPage(input);
    const destinationFolders = input.constrainProject && input.projectId
      ? listProjectFolders(input.projectId).map((folder) => ({ id: folder.id, path: getFolderBreadcrumbs(folder.id).map((entry) => entry.name).join(" / ") }))
      : [];
    return {
      items: page.items.filter((item) => item.kind === "file").flatMap((item) => {
        const asset = getFileAssetForViewing(item.id);
        return asset && isPdf(asset.originalName, asset.declaredMimeType)
          ? [{ ...item, originalName: asset.originalName, byteSize: asset.byteSize }]
          : [];
      }),
      destinationFolders,
      nextCursor: page.nextCursor,
    };
  },
};

export function parsePdfPageSelector(value: string) {
  const tokens = value.normalize("NFKC").trim().split(/[，,]/u).map((token) => token.trim()).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 10_000) throw new AutomationContextError("input_unavailable");
  const pages: number[] = [];
  for (const token of tokens) {
    const range = token.match(/^(\d+)\s*[-–—]\s*(\d+)$/u);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start > 10_000) throw new AutomationContextError("input_unavailable");
      for (let page = start; page <= end; page += 1) pages.push(page - 1);
    } else {
      const page = Number(token);
      if (!/^\d+$/u.test(token) || !Number.isSafeInteger(page) || page < 1) throw new AutomationContextError("input_unavailable");
      pages.push(page - 1);
    }
    if (pages.length > 20_000) throw new AutomationContextError("input_unavailable");
  }
  return { mode: "pages" as const, pages };
}

function parseParameters(operation: PdfToolsOperation, value: Record<string, unknown>): PdfToolsParameters | undefined {
  if (operation === "pdf.merge") return undefined;
  if (operation === "pdf.split") {
    const n = Number(value.splitEvery);
    if (!Number.isSafeInteger(n) || n < 1 || n > 10_000) throw new AutomationContextError("input_unavailable");
    return { strategy: { type: "every", n } };
  }
  if (operation === "pdf.extract") return { pageSelector: parsePdfPageSelector(String(value.pageSelector ?? "")) };
  if (operation === "pdf.rotate") {
    const angle = Number(value.rotateAngle);
    const mode = String(value.rotateMode);
    if (![90, 180, 270].includes(angle) || !["relative", "absolute"].includes(mode)) throw new AutomationContextError("input_unavailable");
    return { pages: parsePdfPageSelector(String(value.pageSelector ?? "")), angle: angle as 90 | 180 | 270, mode: mode as "relative" | "absolute" };
  }
  return { pageOrder: parsePdfPageSelector(String(value.pageOrder ?? "")).pages };
}

function isPdf(filename: string, mimeType: string) {
  return path.extname(filename).toLowerCase() === ".pdf" || mimeType.toLowerCase().split(";", 1)[0] === "application/pdf";
}
function outputIdempotencyKey(runId: string, index: number) {
  return `automation:${runId}:output:${index}`;
}
function operationLabel(operation: PdfToolsOperation) {
  return ({ "pdf.merge": "合并 PDF", "pdf.split": "拆分 PDF", "pdf.extract": "提取页面", "pdf.rotate": "旋转页面", "pdf.reorder": "重排页面" })[operation];
}
function outputTitle(input: PdfToolsInput, index: number, count: number) {
  const base = input.items[0]?.title ?? "PDF";
  return count === 1 ? `${base} · ${operationLabel(input.operation)}` : `${base} · ${operationLabel(input.operation)} ${index + 1}`;
}
function supplierSnapshot(response: PdfToolsSuccess, packageVersion: string, qpdfVersion: string, qpdfSha256: string) {
  return {
    packageVersion,
    coreVersion: response.provenance.coreVersion,
    protocolVersion: 1 as const,
    qpdfVersion,
    qpdfSha256,
    warnings: response.warnings.map((warning) => warning.code),
  };
}
function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
function hostFailureMessage(code: string) {
  if (code.startsWith("resource.") || code.startsWith("timeout.")) return "PDF 操作超出当前资源限制，可缩小文件或减少页数后重试。";
  if (code.startsWith("pdf_validation.") || code.startsWith("input.")) return "来源 PDF 无法通过安全校验，未保存任何结果。";
  if (code.startsWith("parameter.")) return "页码或操作参数与来源 PDF 不匹配。";
  if (code.startsWith("output.") || code.startsWith("publish.")) return "PDF 输出未通过完整性校验，未保存任何结果。";
  return "PDF 操作失败，未保存任何结果。";
}
