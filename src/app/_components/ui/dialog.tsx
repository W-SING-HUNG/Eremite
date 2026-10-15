"use client";

import { useId, useRef, type RefObject } from "react";
import { X } from "lucide-react";
import { IconButton } from "@/app/_components/ui/button";
import { OverlayInteractionContext, OverlayPortal, useDismissableLayer, useFocusScope } from "@/app/_components/ui/overlay";
import { useExitPresence } from "@/app/_components/ui/use-exit-presence";

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  triggerRef?: RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className?: string;
  hideHeader?: boolean;
  dismissible?: boolean;
  role?: "dialog" | "alertdialog";
};

export function Dialog({
  open, title, description, onClose, triggerRef, children, className = "", hideHeader = false, dismissible = true, role = "dialog",
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const present = useExitPresence(open);
  const layerId = useDismissableLayer({
    open,
    panelRef,
    triggerRef,
    onDismiss: () => { if (dismissible) onClose(); },
    modal: true,
    returnFocus: true,
  });
  useFocusScope({ open, panelRef, layerId });
  if (!present) return null;
  return <OverlayPortal>
    <div className="ui-dialog-backdrop" ref={surface => { if (surface) surface.inert = !open; }} data-overlay-layer={layerId} data-state={open ? "open" : "closed"} aria-hidden={!open || undefined}>
      <div
        ref={panelRef}
        className={`ui-dialog ${hideHeader ? "ui-dialog--chromeless" : ""} ${className}`.trim()}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <OverlayInteractionContext.Provider value={open}>
        {hideHeader ? <h2 className="sr-only" id={titleId}>{title}</h2> : <header className="ui-dialog__header"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>{dismissible && <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>}</header>}
        {hideHeader && description && <p className="sr-only" id={descriptionId}>{description}</p>}
        <div className="ui-dialog__body">{children}</div>
        </OverlayInteractionContext.Provider>
      </div>
    </div>
  </OverlayPortal>;
}

export function AlertDialog(props: Omit<DialogProps, "role">) {
  return <Dialog {...props} role="alertdialog" />;
}
