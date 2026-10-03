"use client";

import { useRef, type RefObject } from "react";
import { useDismissableLayer, useFocusScope } from "@/app/_components/ui/overlay";

export function ResponsiveInspector({
  label, className, modal, triggerRef, onClose, initialFocusSelector = "[data-inspector-initial-focus]", children,
}: {
  label: string;
  className: string;
  modal: boolean;
  triggerRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusSelector?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const layerId = useDismissableLayer({ open: modal, panelRef, triggerRef, onDismiss: onClose, modal: true, returnFocus: true });
  useFocusScope({ open: modal, panelRef, layerId, initialFocusSelector });
  return <div className={modal ? "responsive-inspector-backdrop" : "responsive-inspector-host"} data-overlay-layer={modal ? layerId : undefined}>
    <aside ref={panelRef} className={className} aria-label={label} role={modal ? "dialog" : undefined} aria-modal={modal || undefined} tabIndex={modal ? -1 : undefined}>
      {children}
    </aside>
  </div>;
}
