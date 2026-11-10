import type { TextBox } from "../shared/types";

export type AlignEdge = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type AlignTarget = "selection" | "slide";
export type DistributeAxis = "horizontal" | "vertical";

export function alignFrames(
  boxes: TextBox[],
  target: AlignTarget,
  edge: AlignEdge,
): Array<{ id: string; x: number; y: number }> {
  if (boxes.length === 0) return [];
  const bounds =
    target === "slide"
      ? { x: 0, y: 0, right: 1, bottom: 1 }
      : {
          x: Math.min(...boxes.map((box) => box.x)),
          y: Math.min(...boxes.map((box) => box.y)),
          right: Math.max(...boxes.map((box) => box.x + box.w)),
          bottom: Math.max(...boxes.map((box) => box.y + box.h)),
        };
  return boxes.map((box) => {
    let x = box.x;
    let y = box.y;
    if (edge === "left") x = bounds.x;
    if (edge === "right") x = bounds.right - box.w;
    if (edge === "center") x = bounds.x + (bounds.right - bounds.x - box.w) / 2;
    if (edge === "top") y = bounds.y;
    if (edge === "bottom") y = bounds.bottom - box.h;
    if (edge === "middle") y = bounds.y + (bounds.bottom - bounds.y - box.h) / 2;
    return {
      id: box.id,
      x: Math.min(Math.max(0, x), Math.max(0, 1 - box.w)),
      y: Math.min(Math.max(0, y), Math.max(0, 1 - box.h)),
    };
  });
}

/** Equal gaps between boxes. Selection pins the outer boxes. Slide also leaves an equal margin at the edges. */
export function distributeFrames(
  boxes: TextBox[],
  target: AlignTarget,
  axis: DistributeAxis,
): Array<{ id: string; x: number; y: number }> {
  if (boxes.length < 2) return [];
  const horizontal = axis === "horizontal";
  const sorted = [...boxes].sort((a, b) => (horizontal ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x));
  const start = horizontal ? sorted[0].x : sorted[0].y;
  const end = horizontal
    ? sorted[sorted.length - 1].x + sorted[sorted.length - 1].w
    : sorted[sorted.length - 1].y + sorted[sorted.length - 1].h;
  const spanStart = target === "slide" ? 0 : start;
  const spanEnd = target === "slide" ? 1 : end;
  const total = sorted.reduce((sum, box) => sum + (horizontal ? box.w : box.h), 0);
  const gaps = target === "slide" ? sorted.length + 1 : Math.max(1, sorted.length - 1);
  const gap = (spanEnd - spanStart - total) / gaps;
  let cursor = target === "slide" ? spanStart + gap : spanStart;
  return sorted.map((box) => {
    const size = horizontal ? box.w : box.h;
    const position = Math.min(Math.max(0, cursor), Math.max(0, 1 - size));
    cursor += size + gap;
    return horizontal ? { id: box.id, x: position, y: box.y } : { id: box.id, x: box.x, y: position };
  });
}
