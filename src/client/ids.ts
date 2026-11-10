import { SLIDE_ASPECT, SLIDE_POINTS, type ImageFit, type Slide, type TextBox } from "../shared/types";

export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${suffix}`;
}

export function textBox(partial: Partial<TextBox> = {}): TextBox {
  return {
    id: newId("b"),
    name: "Text",
    x: 0.12,
    y: 0.38,
    w: 0.76,
    h: 0.16,
    text: "Text",
    fontFamily: "Visby CF Extra Bold",
    fontSize: 72 / SLIDE_POINTS,
    color: "#FFFFFF",
    align: "center",
    anchor: "center",
    italic: false,
    padTop: 0.002,
    padRight: 0.002,
    padBottom: 0.002,
    padLeft: 0.002,
    ...partial,
  };
}

export function nativeImageFrame(aspect: number): Pick<TextBox, "x" | "y" | "w" | "h"> {
  const ratio = Math.min(10, Math.max(0.1, aspect)) / SLIDE_ASPECT;
  if (ratio >= 1) {
    const h = 1 / ratio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = ratio;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

export function imageBox(src: string, aspect: number, fit: ImageFit): TextBox {
  const frame = fit === "cover" ? { x: 0, y: 0, w: 1, h: 1 } : nativeImageFrame(aspect);
  return {
    id: newId("b"),
    name: "Image",
    ...frame,
    text: "",
    fontFamily: "Visby CF Extra Bold",
    fontSize: 72 / SLIDE_POINTS,
    color: "#FFFFFF",
    align: "center",
    anchor: "center",
    italic: false,
    padTop: 0,
    padRight: 0,
    padBottom: 0,
    padLeft: 0,
    kind: "image",
    src,
    fit,
    aspect,
  };
}

export function duplicateSlide(slide: Slide): Slide {
  return {
    ...structuredClone(slide),
    id: newId("s"),
    boxes: slide.boxes.map((box) => ({ ...structuredClone(box), id: newId("b") })),
  };
}
