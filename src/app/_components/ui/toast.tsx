"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { OverlayPortal } from "@/app/_components/ui/overlay";
import { useExitPresence } from "@/app/_components/ui/use-exit-presence";

export type ToastTone = "success" | "error" | "info";
export type ToastPayload = { title: string; description?: string; tone?: ToastTone; duration?: number; action?: { label: string; href: string } };
type ToastRecord = ToastPayload & { id: number; closing?: boolean };
const eventName = "eremite:toast";

export function showToast(payload: ToastPayload) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<ToastPayload>(eventName, { detail: payload }));
}

export function ToastViewport() {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());
  const dismiss = (id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, closing: true } : toast));
  };
  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastPayload>).detail;
      if (!detail?.title) return;
      const id = nextId.current += 1;
      setToasts((current) => [...current.slice(-3), { ...detail, id }]);
      const duration = detail.duration ?? (detail.tone === "error" ? 7000 : 4200);
      if (duration > 0) timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
    };
    window.addEventListener(eventName, onToast);
    const activeTimers = timers.current;
    return () => { window.removeEventListener(eventName, onToast); for (const timer of activeTimers.values()) window.clearTimeout(timer); activeTimers.clear(); };
  }, []);
  if (toasts.length === 0) return null;
  return <OverlayPortal><div className="ui-toast-viewport" aria-label="通知">{toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} onExited={id => setToasts(current => current.filter(item => item.id !== id))} />)}</div></OverlayPortal>;
}

function ToastItem({ toast, onDismiss, onExited }: { toast: ToastRecord; onDismiss: (id: number) => void; onExited: (id: number) => void }) {
  const present = useExitPresence(!toast.closing);
  useEffect(() => { if (!present) onExited(toast.id); }, [present, onExited, toast.id]);
  if (!present) return null;
  const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? CircleAlert : Info;
  return <div className={`ui-toast ui-toast--${toast.tone ?? "info"}`} ref={surface => { if (surface) surface.inert = Boolean(toast.closing); }} data-state={toast.closing ? "closed" : "open"} aria-hidden={toast.closing || undefined} role={toast.tone === "error" ? "alert" : "status"}>
    <Icon size={17} aria-hidden="true" /><div><strong>{toast.title}</strong>{toast.description && <p>{toast.description}</p>}</div>{toast.action && <a className="ui-toast__action" href={toast.action.href}>{toast.action.label}</a>}<button type="button" aria-label="关闭通知" onClick={() => onDismiss(toast.id)}><X size={15} /></button>
  </div>;
}
