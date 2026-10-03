import { open } from "node:fs/promises";
import { getFileAssetForViewing, type FileAssetForViewing } from "@/modules/inbox/service";
import { claimsDocx, detectViewerFormat, isZipSignature } from "@/modules/viewer/format";
import { viewerLimits, type ViewerDescriptor } from "@/modules/viewer/contracts";
import { inspectDocxContainer } from "@/modules/viewer/docx-container";
import { exceedsSafeImageDimensions, readImageDimensions } from "@/modules/viewer/image";
import { inspectManagedFile } from "@/platform/files/service";

export async function getViewerDescriptor(contentId: string, versionId?: string): Promise<ViewerDescriptor | null> {
  const asset = getFileAssetForViewing(contentId, versionId);
  if (!asset) return null;
  return getViewerDescriptorForAsset(asset);
}

export async function getViewerDescriptorForAsset(asset: FileAssetForViewing): Promise<ViewerDescriptor> {
  const integrity = await inspectManagedFile(asset.storageKey, asset.byteSize, asset.sha256);
  if (integrity.status !== "ready") {
    return {
      ...descriptorIdentity(asset), title: asset.title, originalName: asset.originalName,
      declaredMimeType: asset.declaredMimeType, detectedMimeType: "application/octet-stream",
      byteSize: asset.byteSize, createdAt: asset.createdAt, kind: "unsupported",
      availability: integrity.status, formatMismatch: false,
    };
  }

  const file = await open(integrity.absolutePath, "r");
  const sample = Buffer.alloc(Math.min(1024 * 1024, integrity.size));
  try {
    await file.read(sample, 0, sample.length, 0);
  } finally {
    await file.close();
  }
  let docxContainer: "docx" | "zip" | "corrupted" | undefined;
  let docxTooComplex = false;
  if (claimsDocx(asset.originalName, asset.declaredMimeType) && isZipSignature(sample)) {
    if (asset.byteSize > viewerLimits.docx) docxContainer = "docx";
    else {
      const inspection = await inspectDocxContainer(integrity.absolutePath, integrity.size);
      docxTooComplex = inspection === "too_complex";
      docxContainer = inspection === "too_complex" ? "docx" : inspection;
    }
  }
  const detected = detectViewerFormat(asset.originalName, asset.declaredMimeType, sample, docxContainer);
  const imageDimensions = detected.kind === "image" ? readImageDimensions(sample, detected.mimeType) : null;
  const availability = docxContainer === "corrupted"
    ? "corrupted"
    : docxTooComplex
      ? "too_large"
      : detected.kind === "unsupported"
    ? "unsupported"
    : asset.byteSize > viewerLimits[detected.kind]
      ? "too_large"
      : imageDimensions && exceedsSafeImageDimensions(imageDimensions)
        ? "too_large"
        : "ready";

  return {
    ...descriptorIdentity(asset), title: asset.title, originalName: asset.originalName,
    declaredMimeType: asset.declaredMimeType, detectedMimeType: detected.mimeType,
    byteSize: asset.byteSize, createdAt: asset.createdAt, kind: detected.kind,
    availability, formatMismatch: detected.formatMismatch,
  };
}

export function viewerDescriptorForReadFailure(asset: ReturnType<typeof getFileAssetForViewing>): ViewerDescriptor | null {
  if (!asset) return null;
  return {
    ...descriptorIdentity(asset), title: asset.title, originalName: asset.originalName,
    declaredMimeType: asset.declaredMimeType, detectedMimeType: "application/octet-stream",
    byteSize: asset.byteSize, createdAt: asset.createdAt, kind: "unsupported",
    availability: "load_failed", formatMismatch: false,
  };
}

function descriptorIdentity(asset: FileAssetForViewing) {
  const encodedContent = encodeURIComponent(asset.contentId);
  const encodedVersion = encodeURIComponent(asset.versionId);
  return {
    contentId: asset.contentId,
    assetId: asset.assetId,
    versionId: asset.versionId,
    versionNumber: asset.versionNumber,
    isCurrent: asset.isCurrent === 1,
    contentUrl: `/files/${encodedContent}/versions/${encodedVersion}/content`,
    downloadUrl: `/files/${encodedContent}/versions/${encodedVersion}/download`,
    etag: `"${asset.sha256}"`,
  };
}
