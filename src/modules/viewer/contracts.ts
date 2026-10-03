export type ViewerKind = "pdf" | "image" | "text" | "markdown" | "docx" | "archive" | "video" | "unsupported";
export type ViewerMode = "quick" | "full";
export type ViewerAvailability = "ready" | "missing" | "integrity_error" | "unsupported" | "too_large" | "corrupted" | "load_failed";
export type ViewerFailureCode = ViewerAvailability | "load_failed";

export type ViewerDescriptor = {
  contentId: string;
  assetId: string;
  versionId: string;
  versionNumber: number;
  isCurrent: boolean;
  title: string;
  originalName: string;
  declaredMimeType: string;
  detectedMimeType: string;
  byteSize: number;
  createdAt: string;
  kind: ViewerKind;
  availability: ViewerAvailability;
  formatMismatch: boolean;
  contentUrl: string;
  downloadUrl: string;
  etag: string;
};

export type RendererControls = {
  zoomPercent?: number;
  resetViewLabel?: "适合窗口" | "适合宽度" | "恢复 100%";
  page?: number;
  pageCount?: number;
  zoomIn?: () => void;
  zoomOut?: () => void;
  resetView?: () => void;
  previousPage?: () => void;
  nextPage?: () => void;
  setPage?: (page: number) => void;
};

export type RendererProps = {
  descriptor: ViewerDescriptor;
  mode: ViewerMode;
  sourceUrl: string;
  onControlsChange: (controls: RendererControls | null) => void;
  onFailure: (failure: "corrupted" | "load_failed" | "too_large") => void;
};

export const viewerLimits: Record<Exclude<ViewerKind, "unsupported">, number> = {
  pdf: 500 * 1024 * 1024,
  image: 100 * 1024 * 1024,
  text: 5 * 1024 * 1024,
  markdown: 5 * 1024 * 1024,
  docx: 50 * 1024 * 1024,
  archive: 100 * 1024 * 1024,
  video: 512 * 1024 * 1024,
};
