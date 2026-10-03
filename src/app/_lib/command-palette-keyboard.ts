export type PaletteKeyResult = {
  handled: boolean;
  activeIndex: number;
  execute: boolean;
  close: boolean;
};

export function resolvePaletteKey(key: string, activeIndex: number, candidateCount: number): PaletteKeyResult {
  if (key === "Escape") {
    return { handled: true, activeIndex: 0, execute: false, close: true };
  }

  if (candidateCount <= 0 || !["ArrowDown", "ArrowUp", "Enter"].includes(key)) {
    return { handled: false, activeIndex, execute: false, close: false };
  }

  const normalizedIndex = Math.min(Math.max(activeIndex, 0), candidateCount - 1);

  if (key === "ArrowDown") {
    return { handled: true, activeIndex: (normalizedIndex + 1) % candidateCount, execute: false, close: false };
  }

  if (key === "ArrowUp") {
    return { handled: true, activeIndex: (normalizedIndex - 1 + candidateCount) % candidateCount, execute: false, close: false };
  }

  return { handled: true, activeIndex: normalizedIndex, execute: true, close: false };
}
