"use client";

import DOMPurify from "dompurify";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { RendererProps } from "@/modules/viewer/contracts";
import { classifyDocxFailure } from "@/modules/viewer/failure-classification";

type ZoomStyle = CSSProperties & { "--viewer-doc-zoom": string };

export function DocxRenderer({ sourceUrl, onControlsChange, onFailure }: RendererProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitModeRef = useRef(true);
  const [zoom, setZoom] = useState(100);
  const [loading, setLoading] = useState(true);
  const fitDocument = useCallback(() => {
    const host = hostRef.current;
    const page = host?.querySelector<HTMLElement>("section.docx");
    const viewport = host?.parentElement;
    if (!host || !page || !viewport) return;
    const unscaledPageWidth = page.offsetWidth;
    if (!unscaledPageWidth) return;
    const viewportStyle = globalThis.getComputedStyle(viewport);
    const horizontalPadding = Number.parseFloat(viewportStyle.paddingLeft) + Number.parseFloat(viewportStyle.paddingRight);
    const availableWidth = Math.max(0, viewport.clientWidth - horizontalPadding - 2);
    setZoom(Math.floor(Math.max(40, Math.min(100, availableWidth / unscaledPageWidth * 100))));
  }, []);
  const zoomIn = useCallback(() => { fitModeRef.current = false; setZoom((value) => Math.min(200, value + 10)); }, []);
  const zoomOut = useCallback(() => { fitModeRef.current = false; setZoom((value) => Math.max(40, value - 10)); }, []);
  const resetView = useCallback(() => { fitModeRef.current = true; fitDocument(); }, [fitDocument]);
  const controls = useMemo(() => ({ zoomPercent: zoom, resetViewLabel: "适合宽度" as const, zoomIn, zoomOut, resetView }), [resetView, zoom, zoomIn, zoomOut]);
  useEffect(() => { onControlsChange(loading ? null : controls); }, [controls, loading, onControlsChange]);

  useEffect(() => {
    const viewport = hostRef.current?.parentElement;
    if (!viewport || typeof globalThis.ResizeObserver !== "function") return;
    const observer = new globalThis.ResizeObserver(() => { if (fitModeRef.current) fitDocument(); });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitDocument]);

  useEffect(() => {
    const controller = new AbortController();
    const host = hostRef.current;
    if (!host) return;
    setLoading(true); host.replaceChildren();
    Promise.all([
      fetch(sourceUrl, { signal: controller.signal }).then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error("File response failed"))),
      import("docx-preview"),
    ]).then(async ([bytes, docx]) => {
      const detached = document.createElement("div");
      const styles = document.createElement("div");
      await docx.renderAsync(bytes, detached, styles, { renderAltChunks: false, renderComments: false, renderChanges: false, useBase64URL: true, ignoreLastRenderedPageBreak: false });
      const cleanStyles = stripExternalCssResources(DOMPurify.sanitize(styles.innerHTML, { FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "base"] }));
      const cleanBody = DOMPurify.sanitize(detached.innerHTML, { FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "base", "form", "input", "button", "video", "audio", "source"] });
      styles.innerHTML = cleanStyles; detached.innerHTML = cleanBody;
      detached.querySelectorAll<HTMLElement>("[style]").forEach((element) => element.setAttribute("style", stripExternalCssResources(element.getAttribute("style") ?? "")));
      detached.querySelectorAll("img").forEach((image) => {
        const source = image.getAttribute("src") ?? "";
        if (!/^(data:|blob:)/i.test(source)) image.remove();
        else image.removeAttribute("srcset");
      });
      detached.querySelectorAll("a").forEach((link) => {
        if (!/^(https?:|mailto:)/i.test(link.href)) link.removeAttribute("href");
        else { link.target = "_blank"; link.rel = "noreferrer"; }
      });
      if (controller.signal.aborted) return;
      host.replaceChildren(styles, ...Array.from(detached.childNodes));
      setLoading(false);
      requestAnimationFrame(() => { if (fitModeRef.current) fitDocument(); });
    }).catch((error) => {
      if (error instanceof Error && error.name === "AbortError") return;
      onFailure(classifyDocxFailure(error));
    });
    return () => controller.abort();
  }, [fitDocument, onFailure, sourceUrl]);

  return <div className="docx-renderer" style={{ "--viewer-doc-zoom": String(zoom / 100) } as ZoomStyle}>{loading && <div className="viewer-loading" role="status"><span className="viewer-spinner" /><p>正在解析 DOCX，复杂排版可能需要一点时间…</p></div>}<div className="docx-renderer-content" ref={hostRef} /></div>;
}


function stripExternalCssResources(css: string) {
  return css
    .replace(/@import\s+(?:url\()?[^;]+;?/gi, "")
    .replace(/url\(([^)]*)\)/gi, (match, rawValue: string) => /^(?:['"]?)(?:data:|blob:)/i.test(rawValue.trim()) ? match : "none");
}
