import { inspectDocxContainer as inspectDocxStructure, type DocxInspectionLimits } from "@/platform/files/docx-inspection";

const viewerDocxInspectionLimits: DocxInspectionLimits = Object.freeze({
  maximumCentralDirectorySize: 16 * 1024 * 1024,
  maximumEntries: 10_000,
  maximumMetadataPartSize: 1024 * 1024,
});

export type { DocxContainerInspection } from "@/platform/files/docx-inspection";

export function inspectDocxContainer(absolutePath: string, size: number) {
  return inspectDocxStructure(absolutePath, size, viewerDocxInspectionLimits);
}
