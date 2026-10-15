"use client";

import { useLayoutEffect, useState } from "react";

// Logical close, focus restoration and dismissal happen immediately. Only the
// inert visual surface remains briefly, using the same exit token as the CSS.
export function useExitPresence(open: boolean) {
  const [retained, setRetained] = useState(open);
  useLayoutEffect(() => {
    if (open) { setRetained(true); return; }
    if (!retained) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const duration = window.getComputedStyle(document.documentElement).getPropertyValue("--motion-exit").trim();
    const milliseconds = duration.endsWith("ms") ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000;
    if (preference.matches || !Number.isFinite(milliseconds) || milliseconds <= 0) { setRetained(false); return; }
    const timer = window.setTimeout(() => setRetained(false), milliseconds);
    const reduce = () => { if (preference.matches) setRetained(false); };
    preference.addEventListener("change", reduce);
    return () => { window.clearTimeout(timer); preference.removeEventListener("change", reduce); };
  }, [open, retained]);
  return open || retained;
}
