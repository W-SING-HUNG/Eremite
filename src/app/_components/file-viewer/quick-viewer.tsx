"use client";

import { useEffect, useState } from "react";
import { QuickViewerStatusShell, ViewerShell } from "@/app/_components/file-viewer/viewer-shell";
import type { ViewerDescriptor } from "@/modules/viewer/contracts";

export function QuickViewer({ contentId, returnHref, onClose, onPrevious, onNext, onCreateAction, onProcessContent }: { contentId: string; returnHref: string; onClose: () => void; onPrevious?: () => void; onNext?: () => void; onCreateAction?: () => void; onProcessContent?: () => void }) {
  const [descriptor, setDescriptor] = useState<ViewerDescriptor | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setDescriptor(null); setFailed(false);
    fetch(`/files/${encodeURIComponent(contentId)}/descriptor`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<ViewerDescriptor> : Promise.reject(new Error("Descriptor failed")))
      .then(setDescriptor)
      .catch((error) => { if (error instanceof Error && error.name !== "AbortError") setFailed(true); });
    return () => controller.abort();
  }, [contentId, retryKey]);

  if (failed) return <QuickViewerStatusShell status="failed" onClose={onClose} onRetry={() => setRetryKey((key) => key + 1)} />;
  if (!descriptor) return <QuickViewerStatusShell status="loading" onClose={onClose} />;
  return <ViewerShell descriptor={descriptor} mode="quick" returnHref={returnHref} onClose={onClose} onPrevious={onPrevious} onNext={onNext} onCreateAction={onCreateAction} onProcessContent={onProcessContent} />;
}
