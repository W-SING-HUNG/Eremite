"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { calculateFloatingPosition, type FloatingPlacement } from "@/app/_lib/floating-position";
import { isTopOverlay, registerOverlay } from "@/app/_lib/overlay-stack";

export const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function OverlayPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

export function useDismissableLayer({
  open, panelRef, triggerRef, onDismiss, modal = false, returnFocus = false,
}: {
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  onDismiss: (reason: "escape" | "outside") => void;
  modal?: boolean;
  returnFocus?: boolean;
}) {
  const reactId = useId();
  const id = `overlay-${reactId}`;
  const dismissRef = useRef(onDismiss);
  const returnTargetRef = useRef<HTMLElement | null>(null);
  const shouldReturnFocusRef = useRef(returnFocus);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    shouldReturnFocusRef.current = returnFocus;
    const trigger = triggerRef?.current;
    returnTargetRef.current = trigger && canReceiveFocus(trigger)
      ? trigger
      : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unregister = registerOverlay(id);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !isTopOverlay(id)) return;
      event.preventDefault();
      event.stopPropagation();
      shouldReturnFocusRef.current = true;
      dismissRef.current("escape");
    };
    const onPointerDown = (event: PointerEvent) => {
      if (modal || !isTopOverlay(id)) return;
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef?.current?.contains(target)) return;
      shouldReturnFocusRef.current = returnFocus;
      dismissRef.current("outside");
    };
    const onClick = (event: MouseEvent) => {
      if (!modal || !isTopOverlay(id)) return;
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef?.current?.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      shouldReturnFocusRef.current = returnFocus;
      dismissRef.current("outside");
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    const previousOverflow = document.body.style.overflow;
    if (modal) document.body.style.overflow = "hidden";
    return () => {
      unregister();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      if (modal) document.body.style.overflow = previousOverflow;
      const target = returnTargetRef.current;
      if (shouldReturnFocusRef.current && target?.isConnected) window.requestAnimationFrame(() => target.focus());
    };
  }, [id, modal, open, panelRef, returnFocus, triggerRef]);

  return id;
}

export function useFocusScope({ open, panelRef, layerId, initialFocusSelector = "[data-overlay-initial-focus], [data-dialog-initial-focus]" }: {
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
  layerId: string;
  initialFocusSelector?: string;
}) {
  useLayoutEffect(() => {
    if (!open) return;
    const focusInitial = () => {
      const panel = panelRef.current;
      if (!panel) return false;
      const explicit = panel.querySelector<HTMLElement>(initialFocusSelector);
      const browserFocused = panel.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      const body = panel.querySelector<HTMLElement>(".ui-dialog__body");
      const bodyFirst = body ? focusableElements(body)[0] : null;
      const first = explicit ?? browserFocused ?? bodyFirst ?? focusableElements(panel)[0] ?? panel;
      first.focus();
      return true;
    };
    let frame = 0;
    const focusWhenMounted = () => {
      if (!focusInitial()) frame = window.requestAnimationFrame(focusWhenMounted);
    };
    frame = window.requestAnimationFrame(focusWhenMounted);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !isTopOverlay(layerId)) return;
      const panel = panelRef.current;
      if (!panel) return;
      const candidates = focusableElements(panel);
      if (candidates.length === 0) { event.preventDefault(); panel.focus(); return; }
      const first = candidates[0];
      const last = candidates.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onFocusIn = (event: FocusEvent) => {
      const panel = panelRef.current;
      if (panel && isTopOverlay(layerId) && event.target instanceof Node && !panel.contains(event.target)) focusInitial();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [initialFocusSelector, layerId, open, panelRef]);
}

export function useAnchoredPosition({ open, anchorRef, panelRef, placement = "bottom-end" }: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  placement?: FloatingPlacement;
}) {
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const next = calculateFloatingPosition({
      anchor: anchorRect,
      floating: { width: panelRect.width, height: panelRect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement,
    });
    panel.dataset.placement = next.placement;
    setStyle({ position: "fixed", top: next.top, left: next.left, maxHeight: next.maxHeight, visibility: "visible" });
  }, [anchorRef, panelRef, placement]);
  useLayoutEffect(() => {
    if (!open) return;
    setStyle({ visibility: "hidden" });
    let frame = 0;
    const observer = new ResizeObserver(update);
    let observing = false;
    const updateWhenMounted = () => {
      if (!anchorRef.current || !panelRef.current) {
        frame = window.requestAnimationFrame(updateWhenMounted);
        return;
      }
      if (!observing) {
        observer.observe(anchorRef.current);
        observer.observe(panelRef.current);
        observing = true;
      }
      update();
    };
    frame = window.requestAnimationFrame(updateWhenMounted);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open, panelRef, update]);
  return style;
}

export function focusableElements(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => {
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    return element.getClientRects().length > 0;
  });
}

export function isVisiblyFocusable(element: HTMLElement) {
  return element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== "hidden";
}

function canReceiveFocus(element: HTMLElement) {
  return element.matches("button, [href], input, select, textarea, [contenteditable='true'], [tabindex]:not([tabindex='-1'])");
}
