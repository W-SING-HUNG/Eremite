"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RendererProps } from "@/modules/viewer/contracts";
import { maximumImagePixels } from "@/modules/viewer/image";

export function ImageRenderer({ descriptor, sourceUrl, onControlsChange, onFailure }: RendererProps) {
  const [zoom, setZoom] = useState(100);
  const [loaded, setLoaded] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const zoomIn = useCallback(() => setZoom((value) => Math.min(400, value + 25)), []);
  const zoomOut = useCallback(() => setZoom((value) => {
    const next = Math.max(25, value - 25);
    if (next <= 100) setPan({ x: 0, y: 0 });
    return next;
  }), []);
  const resetView = useCallback(() => { setZoom(100); setPan({ x: 0, y: 0 }); }, []);
  const controls = useMemo(() => ({ zoomPercent: zoom, resetViewLabel: "适合窗口" as const, zoomIn, zoomOut, resetView }), [resetView, zoom, zoomIn, zoomOut]);
  useEffect(() => { onControlsChange(loaded ? controls : null); }, [controls, loaded, onControlsChange]);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return <div
    className={`image-renderer${loaded ? " loaded" : ""}`}
    style={{ cursor: zoom > 100 ? (dragRef.current ? "grabbing" : "grab") : "default", touchAction: "none" }}
    onPointerDown={(event) => {
      if (zoom <= 100 || event.button !== 0) return;
      dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      setPan((value) => ({ x: value.x + event.clientX - drag.x, y: value.y + event.clientY - drag.y }));
      dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
    }}
    onPointerUp={endDrag}
    onPointerCancel={endDrag}
  >
    {!loaded && <span className="viewer-spinner" />}
    {/* Browser decoding is deliberate here; active image formats such as SVG are not in the registry. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={sourceUrl} alt={descriptor.title} draggable={false} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }} onLoad={(event) => {
      if (event.currentTarget.naturalWidth * event.currentTarget.naturalHeight > maximumImagePixels) { onFailure("too_large"); return; }
      setLoaded(true);
    }} onError={() => onFailure("corrupted")} />
  </div>;
}
