import type { BoxPatch, TextBox } from "../shared/types";

export type FitMode = "width" | "text";

type Stage = { w: number; h: number };
type Measured = { width: number; height: number; lines: number };

export async function fitBox(box: TextBox, stage: Stage, mode: FitMode): Promise<BoxPatch | null> {
  if (box.kind === "image") return null;
  const text = box.text.replace(/\n$/, "");
  if (!text.trim() || stage.w < 1 || stage.h < 1) return null;
  const sample = { ...box, text };
  const fontPx = box.fontSize * stage.h;
  const padWidth = box.padLeft + box.padRight;
  const contentLimit = stage.w * Math.max(0.05, 1 - padWidth);
  const natural = await measure(sample, fontPx, null);

  if (mode === "width") {
    const fitted = await measure(sample, fontPx, contentLimit);
    return { x: 0, y: anchoredY(box, heightFraction(fitted.height, stage.h, box)), w: 1, h: heightFraction(fitted.height, stage.h, box) };
  }

  const needed = await widthWithoutWrap(sample, fontPx, natural, contentLimit);
  const w = sizedWidth(needed, stage.w, padWidth);
  const contentPx = Math.max(1, (w - padWidth) * stage.w);
  const fitted = contentPx + 0.5 >= natural.width ? natural : await measure(sample, fontPx, contentPx);
  const h = heightFraction(fitted.height, stage.h, box);
  return { ...keptOrigin(box, w, h), w, h };
}

async function widthWithoutWrap(
  box: TextBox,
  fontPx: number,
  natural: Measured,
  contentLimit: number,
): Promise<number> {
  const slack = Math.ceil(fontPx * 0.08) + 8;
  let width = Math.min(contentLimit, Math.ceil(natural.width) + slack);
  let fitted = await measure(box, fontPx, width);
  if (fitted.lines <= natural.lines) return width;
  let low = width;
  let high = contentLimit;
  width = contentLimit;
  for (let step = 0; step < 14; step += 1) {
    const mid = (low + high) / 2;
    fitted = await measure(box, fontPx, mid);
    if (fitted.lines <= natural.lines) {
      width = mid;
      high = mid;
    } else {
      low = mid;
    }
  }
  return Math.min(contentLimit, Math.ceil(width) + 4);
}

function sizedWidth(contentPx: number, stageW: number, padWidth: number): number {
  let w = clampSize(contentPx / stageW + padWidth, 0.04);
  const actual = (w - padWidth) * stageW;
  if (actual + 0.5 < contentPx) w = clampSize((contentPx + 1) / stageW + padWidth, 0.04);
  return w;
}

function heightFraction(px: number, stageH: number, box: TextBox): number {
  return clampSize((px + 2) / stageH + box.padTop + box.padBottom, 0.03);
}

function keptOrigin(box: TextBox, w: number, h: number): Pick<TextBox, "x" | "y"> {
  const center = box.x + box.w / 2;
  const right = box.x + box.w;
  const x = box.align === "center" ? center - w / 2 : box.align === "right" ? right - w : box.x;
  return {
    x: Math.min(Math.max(0, x), Math.max(0, 1 - w)),
    y: anchoredY(box, h),
  };
}

function anchoredY(box: TextBox, h: number): number {
  const center = box.y + box.h / 2;
  const bottom = box.y + box.h;
  const y = box.anchor === "center" ? center - h / 2 : box.anchor === "end" ? bottom - h : box.y;
  return Math.min(Math.max(0, y), Math.max(0, 1 - h));
}

function clampSize(value: number, min: number): number {
  return Math.min(1, Math.max(min, value));
}

async function measure(box: TextBox, fontSizePx: number, wrapWidth: number | null): Promise<Measured> {
  const probe = document.createElement("div");
  probe.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    "visibility:hidden",
    "box-sizing:content-box",
    "padding:0",
    "margin:0",
    "border:0",
    "line-height:1.02",
    "font-weight:400",
    `font-style:${box.italic ? "oblique" : "normal"}`,
    `font-family:"${box.fontFamily}", Arial, sans-serif`,
    `font-size:${fontSizePx}px`,
    `white-space:${wrapWidth == null ? "pre" : "pre-wrap"}`,
    "overflow-wrap:normal",
    "word-break:normal",
    wrapWidth == null ? "width:max-content" : `width:${wrapWidth}px`,
  ].join(";");
  probe.textContent = box.text;
  document.body.appendChild(probe);
  await document.fonts.load(`${probe.style.fontStyle} 400 ${fontSizePx}px "${box.fontFamily}"`);
  const range = document.createRange();
  range.selectNodeContents(probe);
  const rects = [...range.getClientRects()];
  const canvas = canvasWidth(box, fontSizePx);
  const width = Math.max(
    probe.scrollWidth,
    probe.getBoundingClientRect().width,
    canvas,
    ...rects.map((rect) => rect.width),
    1,
  );
  const height = Math.max(probe.scrollHeight, probe.getBoundingClientRect().height, 1);
  const lines = Math.max(rects.length, box.text.split("\n").length);
  range.detach();
  probe.remove();
  return { width, height, lines };
}

const measureContext = document.createElement("canvas").getContext("2d");

function canvasWidth(box: TextBox, fontSizePx: number): number {
  if (!measureContext) return 0;
  measureContext.font = `${box.italic ? "oblique" : "normal"} 400 ${fontSizePx}px "${box.fontFamily}", Arial, sans-serif`;
  return Math.max(0, ...box.text.split("\n").map((line) => measureContext.measureText(line).width));
}
