"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { decodeViewerText } from "@/modules/viewer/text-decoding";
import type { RendererProps } from "@/modules/viewer/contracts";

export function TextRenderer({ sourceUrl, onControlsChange, onFailure }: RendererProps) {
  const [content, setContent] = useState("");
  const [encoding, setEncoding] = useState("");
  const [zoom, setZoom] = useState(100);
  const zoomIn = useCallback(() => setZoom((value) => Math.min(200, value + 10)), []);
  const zoomOut = useCallback(() => setZoom((value) => Math.max(60, value - 10)), []);
  const resetView = useCallback(() => setZoom(100), []);
  const controls = useMemo(() => ({ zoomPercent: zoom, resetViewLabel: "恢复 100%" as const, zoomIn, zoomOut, resetView }), [resetView, zoom, zoomIn, zoomOut]);
  useEffect(() => { onControlsChange(encoding ? controls : null); }, [controls, encoding, onControlsChange]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(sourceUrl, { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("File response failed");
      return response.arrayBuffer();
    }).then((bytes) => { const decoded = decodeViewerText(bytes); setContent(decoded.text); setEncoding(decoded.encoding); })
      .catch((error) => { if (error instanceof Error && error.name !== "AbortError") onFailure("load_failed"); });
    return () => controller.abort();
  }, [onFailure, sourceUrl]);

  if (!content && !encoding) return <div className="viewer-loading" role="status"><span className="viewer-spinner" /><p>正在读取文本…</p></div>;
  return <article className="text-renderer" style={{ fontSize: `${zoom}%` }}><div className="text-encoding">编码：{encoding.toUpperCase()}</div><pre>{content}</pre></article>;
}
