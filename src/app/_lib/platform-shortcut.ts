export type ShortcutPlatform = "mac" | "windows";

export function detectShortcutPlatform(platform: string) : ShortcutPlatform {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "mac" : "windows";
}

export function formatShortcut(keys: string[], platform: ShortcutPlatform) {
  const labels: Record<string, { mac: string; windows: string }> = {
    mod: { mac: "⌘", windows: "Ctrl" },
    shift: { mac: "⇧", windows: "Shift" },
    alt: { mac: "⌥", windows: "Alt" },
    enter: { mac: "↵", windows: "Enter" },
    escape: { mac: "Esc", windows: "Esc" },
  };
  const parts = keys.map((key) => labels[key.toLowerCase()]?.[platform] ?? key.toUpperCase());
  return platform === "mac" ? parts.join("") : parts.join("+");
}
