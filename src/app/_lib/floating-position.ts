export type FloatingPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end";
export type RectLike = { top: number; right: number; bottom: number; left: number; width: number; height: number };

export function calculateFloatingPosition(input: {
  anchor: RectLike;
  floating: { width: number; height: number };
  viewport: { width: number; height: number };
  placement?: FloatingPlacement;
  offset?: number;
  collisionPadding?: number;
}) {
  const offset = input.offset ?? 6;
  const padding = input.collisionPadding ?? 8;
  const requested = input.placement ?? "bottom-end";
  const alignEnd = requested.endsWith("end");
  const wantsTop = requested.startsWith("top");
  const spaceAbove = input.anchor.top - padding - offset;
  const spaceBelow = input.viewport.height - input.anchor.bottom - padding - offset;
  const useTop = wantsTop ? spaceAbove >= Math.min(input.floating.height, spaceBelow) : spaceBelow < input.floating.height && spaceAbove > spaceBelow;
  const availableHeight = Math.max(96, useTop ? spaceAbove : spaceBelow);
  const height = Math.min(input.floating.height, availableHeight);
  const desiredTop = useTop ? input.anchor.top - offset - height : input.anchor.bottom + offset;
  const desiredLeft = alignEnd ? input.anchor.right - input.floating.width : input.anchor.left;
  const maxLeft = Math.max(padding, input.viewport.width - input.floating.width - padding);
  return {
    top: clamp(desiredTop, padding, Math.max(padding, input.viewport.height - height - padding)),
    left: clamp(desiredLeft, padding, maxLeft),
    maxHeight: availableHeight,
    placement: `${useTop ? "top" : "bottom"}-${alignEnd ? "end" : "start"}` as FloatingPlacement,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
