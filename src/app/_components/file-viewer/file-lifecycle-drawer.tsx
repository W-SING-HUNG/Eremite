"use client";

import { useId, useRef } from "react";
import { X } from "lucide-react";
import { FileLifecyclePanel } from "@/app/_components/file-viewer/file-lifecycle-panel";
import { OverlayPortal, useDismissableLayer, useFocusScope } from "@/app/_components/ui/overlay";
import type { ViewerDescriptor } from "@/modules/viewer/contracts";

export function FileLifecycleDrawer({ open, descriptor, onClose, onChanged }: {
  open: boolean; descriptor: ViewerDescriptor; onClose: () => void; onChanged: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId(); const descriptionId = useId();
  const layerId = useDismissableLayer({ open, panelRef, onDismiss: onClose, modal: true, returnFocus: true });
  useFocusScope({ open, panelRef, layerId, initialFocusSelector: "[data-lifecycle-initial-focus]" });
  if (!open) return null;
  return <OverlayPortal><div className="lifecycle-drawer-backdrop" data-overlay-layer={layerId}>
    <aside ref={panelRef} className="lifecycle-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
      <header><div><h2 id={titleId}>版本历史</h2><p id={descriptionId}>查看、下载或恢复过去版本。当前版本始终保持可追溯。</p></div><button data-lifecycle-initial-focus className="icon-button" type="button" onClick={onClose} aria-label="关闭版本历史"><X size={18} /></button></header>
      <FileLifecyclePanel descriptor={descriptor} onChanged={onChanged} />
    </aside>
  </div></OverlayPortal>;
}
