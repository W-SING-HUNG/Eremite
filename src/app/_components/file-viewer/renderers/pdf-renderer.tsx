"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RendererProps } from "@/modules/viewer/contracts";
import { classifyPdfFailure } from "@/modules/viewer/failure-classification";

type PdfViewerInstance = import("pdfjs-dist/web/pdf_viewer.mjs").PDFViewer;

export function PdfRenderer({ sourceUrl, onControlsChange, onFailure }: RendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<PdfViewerInstance | null>(null);
  const [page, setPageState] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [loading, setLoading] = useState(true);

  const setPage = useCallback((next: number) => {
    const viewer = instanceRef.current;
    if (!viewer || !Number.isFinite(next)) return;
    viewer.currentPageNumber = Math.max(1, Math.min(viewer.pagesCount, Math.round(next)));
  }, []);
  const previousPage = useCallback(() => setPage(page - 1), [page, setPage]);
  const nextPage = useCallback(() => setPage(page + 1), [page, setPage]);
  const setScale = useCallback((next: number) => {
    const viewer = instanceRef.current;
    if (!viewer) return;
    viewer.currentScale = Math.max(.25, Math.min(4, next / 100));
  }, []);
  const zoomIn = useCallback(() => setScale(zoom + 25), [setScale, zoom]);
  const zoomOut = useCallback(() => setScale(zoom - 25), [setScale, zoom]);
  const resetView = useCallback(() => { if (instanceRef.current) instanceRef.current.currentScaleValue = "page-width"; }, []);
  const controls = useMemo(() => ({ zoomPercent: zoom, resetViewLabel: "适合宽度" as const, zoomIn, zoomOut, resetView, page, pageCount, previousPage, nextPage, setPage }), [nextPage, page, pageCount, previousPage, resetView, setPage, zoom, zoomIn, zoomOut]);
  useEffect(() => { onControlsChange(loading || pageCount === 0 ? null : controls); }, [controls, loading, onControlsChange, pageCount]);

  useEffect(() => {
    let disposed = false;
    let loadingTask: import("pdfjs-dist").PDFDocumentLoadingTask | undefined;
    const start = async () => {
      const container = containerRef.current;
      const viewerElement = viewerRef.current;
      if (!container || !viewerElement) return;
      try {
        const pdfjs = await import("pdfjs-dist");
        const web = await import("pdfjs-dist/web/pdf_viewer.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const eventBus = new web.EventBus();
        const linkService = new web.PDFLinkService({ eventBus, externalLinkTarget: 2 });
        const viewer = new web.PDFViewer({ container, viewer: viewerElement, eventBus, linkService, textLayerMode: 1, annotationMode: 1, annotationEditorMode: 0, enablePermissions: true });
        linkService.setViewer(viewer);
        instanceRef.current = viewer;
        eventBus.on("pagesinit", () => { viewer.currentScaleValue = "page-width"; setPageCount(viewer.pagesCount); setLoading(false); });
        eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => setPageState(pageNumber));
        eventBus.on("scalechanging", ({ scale }: { scale: number }) => setZoom(Math.round(scale * 100)));
        loadingTask = pdfjs.getDocument({ url: sourceUrl, enableXfa: false, withCredentials: true });
        const pdfDocument = await loadingTask.promise;
        if (disposed) return;
        viewer.setDocument(pdfDocument);
        linkService.setDocument(pdfDocument);
      } catch (error) {
        if (!disposed) onFailure(classifyPdfFailure(error));
      }
    };
    void start();
    return () => {
      disposed = true;
      instanceRef.current = null;
      loadingTask?.destroy();
    };
  }, [onFailure, sourceUrl]);

  return <div className="pdf-renderer"><div className="pdf-scroll-container" ref={containerRef}>{loading && <div className="viewer-loading pdf-loading" role="status"><span className="viewer-spinner" /><p>正在解析 PDF…</p></div>}<div className="pdfViewer" ref={viewerRef} /></div></div>;
}
