export function nextRovingIndex(key: string, currentIndex: number, itemCount: number) {
  if (itemCount <= 0) return { handled: false, index: -1, activate: false };
  const current = Math.min(Math.max(currentIndex, 0), itemCount - 1);
  if (key === "ArrowDown") return { handled: true, index: (current + 1) % itemCount, activate: false };
  if (key === "ArrowUp") return { handled: true, index: (current - 1 + itemCount) % itemCount, activate: false };
  if (key === "Home") return { handled: true, index: 0, activate: false };
  if (key === "End") return { handled: true, index: itemCount - 1, activate: false };
  if (key === "Enter" || key === " ") return { handled: true, index: current, activate: true };
  return { handled: false, index: current, activate: false };
}

export function nextTreeState(input: { key: string; index: number; itemCount: number; expanded: boolean; hasChildren: boolean; parentIndex: number | null; firstChildIndex?: number | null }) {
  const vertical = nextRovingIndex(input.key, input.index, input.itemCount);
  if (vertical.handled) return { ...vertical, expand: null as boolean | null };
  if (input.key === "ArrowRight" && input.hasChildren && !input.expanded) return { handled: true, index: input.index, activate: false, expand: true };
  if (input.key === "ArrowRight" && input.hasChildren && input.expanded && input.firstChildIndex !== null && input.firstChildIndex !== undefined) return { handled: true, index: input.firstChildIndex, activate: false, expand: null };
  if (input.key === "ArrowLeft" && input.expanded) return { handled: true, index: input.index, activate: false, expand: false };
  if (input.key === "ArrowLeft" && input.parentIndex !== null) return { handled: true, index: input.parentIndex, activate: false, expand: null };
  return { handled: false, index: input.index, activate: false, expand: null };
}
