"use client";

import { useEffect, useId, useRef, useState, type AriaAttributes, type ReactNode, type RefObject } from "react";
import { OverlayPortal, focusableElements, isVisiblyFocusable, useAnchoredPosition, useDismissableLayer } from "@/app/_components/ui/overlay";
import type { FloatingPlacement } from "@/app/_lib/floating-position";

export type PopoverTriggerProps = {
  ref: RefObject<HTMLButtonElement>;
  type: "button";
  "aria-haspopup": AriaAttributes["aria-haspopup"];
  "aria-expanded": boolean;
  "aria-controls": string;
  onClick: () => void;
  focusTrigger: () => void;
};

export function Popover({
  trigger, children, label, open: controlledOpen, onOpenChange, placement = "bottom-end", initialFocus = false, className = "",
}: {
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode;
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: FloatingPlacement;
  initialFocus?: boolean;
  className?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const layerId = useDismissableLayer({ open, panelRef, triggerRef, onDismiss: () => setOpen(false) });
  const position = useAnchoredPosition({ open, anchorRef: triggerRef, panelRef, placement });
  useEffect(() => {
    if (!open || !initialFocus) return;
    let frame = 0;
    const focusWhenMounted = () => {
      const explicit = panelRef.current?.querySelector<HTMLElement>("[data-popover-initial-focus]");
      const target = explicit ?? (panelRef.current ? focusableElements(panelRef.current)[0] : null);
      if (!target || !isVisiblyFocusable(target)) { frame = window.requestAnimationFrame(focusWhenMounted); return; }
      target.focus();
    };
    frame = window.requestAnimationFrame(focusWhenMounted);
    return () => window.cancelAnimationFrame(frame);
  }, [initialFocus, open]);
  return <>
    {trigger({ ref: triggerRef, type: "button", "aria-haspopup": "dialog", "aria-expanded": open, "aria-controls": contentId, onClick: () => setOpen(!open), focusTrigger: () => triggerRef.current?.focus() })}
    {open && <OverlayPortal><div ref={panelRef} id={contentId} className={`ui-popover ${className}`.trim()} data-overlay-layer={layerId} role="dialog" aria-label={label} style={position}>{children}</div></OverlayPortal>}
  </>;
}
