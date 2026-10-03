"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MoreHorizontal } from "lucide-react";
import { nextRovingIndex } from "@/app/_lib/ui-keyboard";
import { isVisiblyFocusable, OverlayPortal, useAnchoredPosition, useDismissableLayer } from "@/app/_components/ui/overlay";

export function Menu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const initialIndexRef = useRef(0);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<number | null>(null);
  const layerId = useDismissableLayer({ open, panelRef, triggerRef, onDismiss: () => setOpen(false) });
  const position = useAnchoredPosition({ open, anchorRef: triggerRef, panelRef, placement: "bottom-end" });
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const focusWhenMounted = () => {
      const items = menuItems(panelRef.current);
      const target = initialIndexRef.current < 0 ? items.at(-1) : items[initialIndexRef.current];
      if (!target || !isVisiblyFocusable(target)) { frame = window.requestAnimationFrame(focusWhenMounted); return; }
      target.focus();
    };
    frame = window.requestAnimationFrame(focusWhenMounted);
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  const openMenu = (index: number) => { initialIndexRef.current = index; setOpen(true); };
  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    openMenu(event.key === "ArrowUp" ? -1 : 0);
  };
  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Tab") { event.preventDefault(); triggerRef.current?.focus(); setOpen(false); return; }
    const items = menuItems(panelRef.current);
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const next = nextRovingIndex(event.key, current, items.length);
    if (next.handled) {
      event.preventDefault();
      if (next.activate) items[next.index]?.click(); else items[next.index]?.focus();
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    typeaheadRef.current += event.key.toLocaleLowerCase();
    if (typeaheadTimerRef.current) window.clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = window.setTimeout(() => { typeaheadRef.current = ""; }, 500);
    const match = items.find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(typeaheadRef.current));
    if (match) { event.preventDefault(); match.focus(); }
  };
  return <div className="menu-root">
    <button ref={triggerRef} className="icon-button" type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onKeyDown={onTriggerKeyDown} onClick={() => open ? setOpen(false) : openMenu(0)}><MoreHorizontal size={18} /></button>
    {open && <OverlayPortal><div ref={panelRef} className="menu-popover" data-overlay-layer={layerId} role="menu" aria-label={label} style={position} onKeyDown={onMenuKeyDown} onClick={() => { triggerRef.current?.focus(); setOpen(false); }}>{children}</div></OverlayPortal>}
  </div>;
}

export function MenuItem({ children, onClick, danger = false, disabled = false }: { children: React.ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
  return <button type="button" role="menuitem" className={danger ? "menu-item danger-text" : "menu-item"} tabIndex={-1} disabled={disabled} onClick={onClick}>{children}</button>;
}

export function ContextMenu({ label, trigger, children }: { label: string; trigger: React.ReactNode; children: React.ReactNode }) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const open = point !== null;
  const layerId = useDismissableLayer({ open, panelRef, triggerRef, onDismiss: () => setPoint(null) });
  useLayoutEffect(() => {
    if (!point) return;
    let frame = 0;
    let positioned = false;
    const update = () => {
      const panel = panelRef.current;
      if (!panel) { frame = window.requestAnimationFrame(update); return; }
      const rect = panel.getBoundingClientRect();
      setStyle({
        position: "fixed",
        top: Math.max(8, Math.min(point.y, window.innerHeight - rect.height - 8)),
        left: Math.max(8, Math.min(point.x, window.innerWidth - rect.width - 8)),
        maxHeight: Math.max(96, window.innerHeight - 16),
        visibility: "visible",
      });
      if (!positioned) {
        positioned = true;
        frame = window.requestAnimationFrame(update);
        return;
      }
      const target = menuItems(panel)[0];
      if (target) frame = window.requestAnimationFrame(() => target.focus());
    };
    frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("resize", update); };
  }, [point]);
  const openAt = (x: number, y: number) => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStyle({ visibility: "hidden" });
    setPoint({ x, y });
  };
  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Tab") { event.preventDefault(); returnFocusRef.current?.focus(); setPoint(null); return; }
    const items = menuItems(panelRef.current);
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const next = nextRovingIndex(event.key, current, items.length);
    if (!next.handled) return;
    event.preventDefault();
    if (next.activate) items[next.index]?.click(); else items[next.index]?.focus();
  };
  return <div
    className="context-menu-target"
    ref={triggerRef}
    onContextMenu={(event) => { event.preventDefault(); openAt(event.clientX, event.clientY); }}
    onKeyDown={(event) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      const active = document.activeElement instanceof HTMLElement ? document.activeElement.getBoundingClientRect() : triggerRef.current?.getBoundingClientRect();
      if (active) openAt(active.left + 12, active.top + 12);
    }}
  >
    {trigger}
    {open && <OverlayPortal><div ref={panelRef} className="menu-popover" data-overlay-layer={layerId} role="menu" aria-label={label} style={style} onKeyDown={onMenuKeyDown} onClick={() => { returnFocusRef.current?.focus(); setPoint(null); }}>{children}</div></OverlayPortal>}
  </div>;
}

function menuItems(panel: HTMLElement | null) {
  const items = [...(panel?.querySelectorAll<HTMLElement>("[role='menuitem']:not([disabled])") ?? [])];
  return items;
}
