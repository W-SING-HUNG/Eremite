"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { decodeViewerText } from "@/modules/viewer/text-decoding";
import type { RendererProps } from "@/modules/viewer/contracts";
import { isMarkdownTooComplex } from "@/modules/viewer/markdown-complexity";

export function MarkdownRenderer({ sourceUrl, onControlsChange, onFailure }: RendererProps) {
  const [content, setContent] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const zoomIn = useCallback(() => setZoom((value) => Math.min(200, value + 10)), []);
  const zoomOut = useCallback(() => setZoom((value) => Math.max(60, value - 10)), []);
  const resetView = useCallback(() => setZoom(100), []);
  const controls = useMemo(() => ({ zoomPercent: zoom, resetViewLabel: "恢复 100%" as const, zoomIn, zoomOut, resetView }), [resetView, zoom, zoomIn, zoomOut]);
  useEffect(() => { onControlsChange(content === null ? null : controls); }, [content, controls, onControlsChange]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(sourceUrl, { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("File response failed");
      return response.arrayBuffer();
    }).then((bytes) => {
      const text = decodeViewerText(bytes).text;
      if (isMarkdownTooComplex(text)) { onFailure("too_large"); return; }
      setContent(text);
    })
      .catch((error) => { if (error instanceof Error && error.name !== "AbortError") onFailure("load_failed"); });
    return () => controller.abort();
  }, [onFailure, sourceUrl]);

  if (content === null) return <div className="viewer-loading" role="status"><span className="viewer-spinner" /><p>正在解析 Markdown…</p></div>;
  return <article className="markdown-renderer" style={{ fontSize: `${zoom}%` }}><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={safeExternalUrl(href)} target="_blank" rel="noreferrer">{children}</a>,
    img: ({ alt }) => <span className="markdown-external-image">外部图片未加载{alt ? `：${alt}` : ""}</span>,
  }}>{content}</Markdown></article>;
}

const safeExternalUrl = (href?: string) => href && /^(https?:|mailto:)/i.test(href) ? href : undefined;
