"use client";

import { useId, useRef } from "react";
import { X } from "lucide-react";
import { IconButton } from "@/app/_components/ui/button";
import { OverlayPortal, useDismissableLayer, useFocusScope } from "@/app/_components/ui/overlay";

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  hideHeader?: boolean;
  dismissible?: boolean;
  role?: "dialog" | "alertdialog";
};

export function Dialog({
  open, title, description, onClose, children, className = "", hideHeader = false, dismissible = true, role = "dialog",
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const layerId = useDismissableLayer({
    open,
    panelRef,
    onDismiss: () => { if (dismissible) onClose(); },
    modal: true,
    returnFocus: true,
  });
  useFocusScope({ open, panelRef, layerId });
  if (!open) return null;
  return <OverlayPortal>
    <div className="ui-dialog-backdrop" data-overlay-layer={layerId}>
      <div
        ref={panelRef}
        className={`ui-dialog ${hideHeader ? "ui-dialog--chromeless" : ""} ${className}`.trim()}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        {hideHeader ? <h2 className="sr-only" id={titleId}>{title}</h2> : <header className="ui-dialog__header"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>{dismissible && <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>}</header>}
        {hideHeader && description && <p className="sr-only" id={descriptionId}>{description}</p>}
        <div className="ui-dialog__body">{children}</div>
      </div>
    </div>
  </OverlayPortal>;
}

export function AlertDialog(props: Omit<DialogProps, "role">) {
  return <Dialog {...props} role="alertdialog" />;
}
