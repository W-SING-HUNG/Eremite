export type ViewerControlAction = "close" | "zoom_in" | "zoom_out" | "reset_view" | "previous_page" | "next_page";

export type ViewerControlAvailability = {
  close: boolean;
  zoomIn: boolean;
  zoomOut: boolean;
  resetView: boolean;
  pagination: boolean;
};

export function viewerSessionKey(contentId: string, mode: "quick" | "full", versionId?: string) {
  return `${mode}:${contentId}:${versionId ?? "current"}`;
}

export function resolveViewerControlKey(key: string, availability: ViewerControlAvailability): ViewerControlAction | null {
  if (key === "Escape" && availability.close) return "close";
  if ((key === "+" || key === "=") && availability.zoomIn) return "zoom_in";
  if (key === "-" && availability.zoomOut) return "zoom_out";
  if (key === "0" && availability.resetView) return "reset_view";
  if (key === "PageUp" && availability.pagination) return "previous_page";
  if (key === "PageDown" && availability.pagination) return "next_page";
  return null;
}

export function normalizeViewerPageInput(value: string, pageCount: number): number | null {
  if (!/^\d+$/.test(value.trim()) || pageCount < 1) return null;
  return Math.max(1, Math.min(pageCount, Number(value)));
}
