"use client";

import { useEffect, useState } from "react";
import { detectShortcutPlatform, formatShortcut, type ShortcutPlatform } from "@/app/_lib/platform-shortcut";

export function Shortcut({ keys, className = "" }: { keys: string[]; className?: string }) {
  const [platform, setPlatform] = useState<ShortcutPlatform>("windows");
  useEffect(() => setPlatform(detectShortcutPlatform(navigator.platform || navigator.userAgent)), []);
  return <kbd className={className} aria-label={formatShortcut(keys, platform)}>{formatShortcut(keys, platform)}</kbd>;
}
