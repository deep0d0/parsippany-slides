import JSZip from "jszip";
import type { PptxRenderer } from "pptx-browser";
import { FONT_FAMILIES, type Slide, type TextAlign, type TextAnchor, type TextBox } from "../shared/types";
import { imageBox } from "./ids";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const DC = "http://purl.org/dc/elements/1.1/";
const EMU_PER_PT = 12700;

const SCHEME: Record<string, string> = {
  dk1: "#000000",
  lt1: "#FFFFFF",
  dk2: "#0E2841",
  lt2: "#E8E8E8",
  accent1: "#156082",
  accent2: "#E97132",
  accent3: "#196B24",
  accent4: "#0F9ED5",
  accent5: "#A02B93",
  accent6: "#4EA72E",
  hlink: "#467886",
  folHlink: "#96607D",
};

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export type PptxMedia = { name: string; mime: string; bytes: Uint8Array };

export type ImportedPptx = {
  title: string;
  slidePoints: number;
  slides: Slide[];
  media: PptxMedia[];
};

type Theme = { colors: Record<string, string> };
type Background = { color: string | null; image: string | null };

type StoredPicture = {
  name: string;
  label: string;
  aspect: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  cropTop: number;
  cropRight: number;
  cropBottom: number;
  cropLeft: number;
  unsupported: boolean;
};

export async function importPptx(file: File): Promise<ImportedPptx> {
  const zip = await JSZip.loadAsync(file);
  const presentation = parse(await read(zip, "ppt/presentation.xml"));
  const size = first(presentation, P, "sldSz");
  if (!size) throw new Error("This PowerPoint file has no slide size.");
  const sw = num(size, "cx");
  const sh = num(size, "cy");
  if (sw < 1 || sh < 1) throw new Error("This PowerPoint file has an invalid slide size.");
  const slidePoints = sh / EMU_PER_PT;
  const clrMap = await colorMap(zip);
  const theme = await themeOf(zip);
  const order = await slideOrder(zip, presentation);
  if (order.length === 0) throw new Error("This PowerPoint file has no slides.");

  const media: PptxMedia[] = [];
  const used = new Set<string>();
  const backgroundCache = new Map<string, string>();
  const unsupported = new Set<number>();
  const slides: Slide[] = [];

  for (let index = 0; index < Math.min(order.length, 60); index += 1) {
    const path = order[index];
    const root = parse(await read(zip, path)).documentElement;
    const rels = await relationships(zip, relsPath(path));
    const tree = first(root, P, "spTree");
    const backgroundInfo = await slideBackground(
      zip,
      root,
      path,
      rels,
      clrMap,
      theme,
      used,
      media,
      backgroundCache,
    );
    let background = backgroundInfo.image;
    let needsRaster = false;
    const boxes: TextBox[] = [];

    if (tree) {
      for (const child of [...tree.children]) {
        const tag = child.localName;
        if (tag === "extLst" || tag === "nvGrpSpPr" || tag === "grpSpPr") continue;
        const frame = transform(child, sw, sh);
        if (!frame) {
          needsRaster = true;
          continue;
        }
        if (tag === "pic") {
          const stored = await picture(zip, child, rels, used, media);
          if (!stored) {
            needsRaster = true;
            continue;
          }
          const sourceW = 1 - stored.cropLeft - stored.cropRight;
          const sourceH = 1 - stored.cropTop - stored.cropBottom;
          const cropOk =
            sourceW > 0.1 &&
            sourceH > 0.1 &&
            [stored.cropTop, stored.cropRight, stored.cropBottom, stored.cropLeft].every(
              (value) => value >= 0 && value <= 0.45,
            );
          const frameAspect = frame.h > 0 ? (frame.w * sw) / (frame.h * sh) : 0;
          const visibleAspect = stored.aspect * (sourceW / sourceH);
          if (!cropOk || frameAspect <= 0 || Math.abs(visibleAspect / frameAspect - 1) > 0.02) {
            needsRaster = true;
          }
          if (stored.unsupported) needsRaster = true;
          const plain =
            !stored.unsupported &&
            stored.rotation === 0 &&
            !stored.flipX &&
            !stored.flipY &&
            stored.opacity === 1 &&
            stored.cropTop === 0 &&
            stored.cropRight === 0 &&
            stored.cropBottom === 0 &&
            stored.cropLeft === 0;
          const full =
            Math.abs(frame.x) < 0.002 &&
            Math.abs(frame.y) < 0.002 &&
            Math.abs(frame.w - 1) < 0.002 &&
            Math.abs(frame.h - 1) < 0.002;
          if (!background && plain && full) {
            background = stored.name;
          } else {
            boxes.push(pictureBox(stored, frame));
          }
        } else if (tag === "sp") {
          if (!first(child, P, "txBody")) {
            needsRaster = true;
            continue;
          }
          if (textShapeUnsupported(child)) needsRaster = true;
          const box = textBox(child, frame, index + 1, slidePoints, sw, sh, clrMap, theme);
          if (box) boxes.push(box);
        } else {
          needsRaster = true;
        }
      }
    }

    if (needsRaster) unsupported.add(index);
    const slide: Slide = {
      id: `s${index + 1}`,
      hidden: root.getAttribute("show") === "0",
      background,
      boxes,
    };
    if (backgroundInfo.color) slide.backgroundColor = backgroundInfo.color;
    slides.push(slide);
  }

  if (slides.length === 0) throw new Error("No slides could be read from this file.");
  if (unsupported.size > 0) {
    const rendered = await rasterize(file, unsupported, media, used);
    for (const [index, name] of rendered) {
      const slide = slides[index];
      if (!slide) continue;
      slide.background = name;
      slide.boxes = [];
    }
  }
  return { title: displayTitle(await titleOf(zip), file.name), slidePoints, slides, media };
}

async function slideOrder(zip: JSZip, presentation: Document): Promise<string[]> {
  const rels = await relationships(zip, "ppt/_rels/presentation.xml.rels");
  const ids = [...presentation.getElementsByTagNameNS(P, "sldId")]
    .map((node) => node.getAttributeNS(R, "id") || node.getAttribute("r:id") || "")
    .filter(Boolean);
  const paths = ids.map((id) => rels[id]).filter(Boolean).map((target) => join("ppt", target));
  if (paths.length) return paths;
  const found: string[] = [];
  for (let index = 1; index <= 64; index += 1) {
    const path = `ppt/slides/slide${index}.xml`;
    if (!zip.file(path)) break;
    found.push(path);
  }
  return found;
}

async function colorMap(zip: JSZip): Promise<Record<string, string>> {
  const file = zip.file("ppt/slideMasters/slideMaster1.xml");
  if (!file) return {};
  const master = first(parse(await file.async("string")), P, "clrMap");
  if (!master) return {};
  const map: Record<string, string> = {};
  for (const attr of master.attributes) map[attr.name] = attr.value;
  return map;
}

async function themeOf(zip: JSZip): Promise<Theme> {
  const path = Object.keys(zip.files)
    .filter((name) => /^ppt\/theme\/theme\d+\.xml$/.test(name))
    .sort()[0];
  if (!path) return { colors: {} };
  const scheme = first(parse(await read(zip, path)), A, "clrScheme");
  const colors: Record<string, string> = {};
  if (scheme) {
    for (const entry of [...scheme.children]) {
      const color = rawColor(entry);
      if (color) colors[entry.localName] = color;
    }
  }
  return { colors };
}

async function slideBackground(
  zip: JSZip,
  root: Element,
  slidePath: string,
  rels: Record<string, string>,
  clrMap: Record<string, string>,
  theme: Theme,
  used: Set<string>,
  media: PptxMedia[],
  cache: Map<string, string>,
): Promise<Background> {
  const own = await backgroundOf(zip, root, slidePath, rels, clrMap, theme, used, media, cache);
  if (own !== undefined) return own;

  let path = await relatedPath(zip, slidePath, "/slideLayout");
  for (let depth = 0; path && depth < 3; depth += 1) {
    const parent = parse(await read(zip, path)).documentElement;
    const partRels = await relationships(zip, relsPath(path));
    const value = await backgroundOf(
      zip,
      parent,
      path,
      partRels,
      clrMap,
      theme,
      used,
      media,
      cache,
    );
    if (value !== undefined) return value;
    path = path.includes("/slideLayouts/")
      ? await relatedPath(zip, path, "/slideMaster")
      : null;
  }
  return { color: null, image: null };
}

async function backgroundOf(
  zip: JSZip,
  root: Element,
  partPath: string,
  rels: Record<string, string>,
  clrMap: Record<string, string>,
  theme: Theme,
  used: Set<string>,
  media: PptxMedia[],
  cache: Map<string, string>,
): Promise<Background | undefined> {
  const background = first(root, P, "bg");
  if (!background) return undefined;
  const properties = first(background, P, "bgPr");
  if (properties) {
    if (first(properties, A, "noFill")) return { color: null, image: null };
    const imageFill = first(properties, A, "blipFill");
    if (imageFill) {
      return {
        color: null,
        image: await backgroundImage(zip, imageFill, partPath, rels, used, media, cache),
      };
    }
    const solid = first(properties, A, "solidFill");
    if (solid) return { color: colorNode(solid, clrMap, theme), image: null };
    const gradient = first(properties, A, "gradFill");
    if (gradient) {
      const stop = first(gradient, A, "gs");
      return { color: stop ? colorNode(stop, clrMap, theme) : null, image: null };
    }
    const pattern = first(properties, A, "pattFill");
    if (pattern) {
      const foreground = first(pattern, A, "fgClr");
      return { color: foreground ? colorNode(foreground, clrMap, theme) : null, image: null };
    }
    return { color: null, image: null };
  }
  const reference = first(background, P, "bgRef");
  if (reference) {
    if (reference.getAttribute("idx") === "0") return { color: null, image: null };
    return { color: colorNode(reference, clrMap, theme), image: null };
  }
  return { color: null, image: null };
}

async function backgroundImage(
  zip: JSZip,
  fill: Element,
  partPath: string,
  rels: Record<string, string>,
  used: Set<string>,
  media: PptxMedia[],
  cache: Map<string, string>,
): Promise<string | null> {
  const blip = first(fill, A, "blip");
  const rid = blip?.getAttributeNS(R, "embed") || blip?.getAttribute("r:embed") || "";
  const target = rels[rid];
  if (!target) return null;
  const path = join(dirname(partPath), target);
  const cached = cache.get(path);
  if (cached) return cached;
  const file = zip.file(path);
  const mime = MIME[extension(path)];
  if (!file || !mime) return null;
  const name = uniqueName(basename(path), used);
  const bytes = await file.async("uint8array");
  media.push({ name, mime, bytes });
  cache.set(path, name);
  return name;
}

function themeColor(name: string, clrMap: Record<string, string>, theme: Theme): string | null {
  if (!name) return null;
  const mapped = clrMap[name] ?? name;
  return theme.colors[mapped] ?? theme.colors[name] ?? SCHEME[mapped] ?? SCHEME[name] ?? null;
}

function colorNode(parent: Element, clrMap: Record<string, string>, theme: Theme): string | null {
  for (const child of [...parent.children]) {
    if (child.localName === "srgbClr") return hexColor(child.getAttribute("val"));
    if (child.localName === "sysClr") return hexColor(child.getAttribute("lastClr"));
    if (child.localName === "schemeClr") {
      return themeColor(child.getAttribute("val") ?? "", clrMap, theme);
    }
  }
  return null;
}

function rawColor(node: Element): string | null {
  for (const child of [...node.children]) {
    if (child.localName === "srgbClr") return hexColor(child.getAttribute("val"));
    if (child.localName === "sysClr") return hexColor(child.getAttribute("lastClr"));
  }
  return null;
}

function hexColor(value: string | null): string | null {
  return value && /^[0-9a-fA-F]{6}$/.test(value) ? `#${value.toUpperCase()}` : null;
}

async function relatedPath(zip: JSZip, path: string, suffix: string): Promise<string | null> {
  const file = zip.file(relsPath(path));
  if (!file) return null;
  for (const node of parse(await file.async("string")).getElementsByTagNameNS(PR, "Relationship")) {
    const type = node.getAttribute("Type") ?? "";
    const target = node.getAttribute("Target");
    if (target && type.endsWith(suffix)) return join(dirname(path), target);
  }
  return null;
}

function dirname(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

async function picture(
  zip: JSZip,
  node: Element,
  rels: Record<string, string>,
  used: Set<string>,
  media: PptxMedia[],
): Promise<StoredPicture | null> {
  const blip = first(node, A, "blip");
  const rid = blip?.getAttributeNS(R, "embed") || blip?.getAttribute("r:embed") || "";
  const target = rels[rid];
  if (!target) return null;
  const path = join("ppt/slides", target);
  const file = zip.file(path);
  const ext = extension(path);
  const mime = MIME[ext];
  if (!file || !mime) return null;
  let name = basename(path).replace(/[^\w.-]/g, "") || `image.${ext}`;
  if (!name.includes(".")) name = `${name}.${ext}`;
  name = name.slice(0, 80);
  const bytes = await file.async("uint8array");
  if (!used.has(name)) {
    used.add(name);
    media.push({ name, mime, bytes });
  }
  const xfrm = first(node, A, "xfrm");
  const rotation = normalizeRotation(Number(xfrm?.getAttribute("rot") ?? 0) / 60000);
  const srcRect = first(node, A, "srcRect");
  const crop = (attr: string) => Number(srcRect?.getAttribute(attr) ?? 0) / 100000;
  const cnv = first(node, P, "cNvPr");
  return {
    name,
    label: (cnv?.getAttribute("name") || "Image").slice(0, 80),
    aspect: await imageAspect(bytes, mime),
    rotation,
    flipX: xfrm?.getAttribute("flipH") === "1",
    flipY: xfrm?.getAttribute("flipV") === "1",
    opacity: pictureOpacity(blip),
    cropTop: crop("t"),
    cropRight: crop("r"),
    cropBottom: crop("b"),
    cropLeft: crop("l"),
    unsupported: pictureUnsupported(node, blip),
  };
}

function pictureBox(stored: StoredPicture, frame: Pick<TextBox, "x" | "y" | "w" | "h">): TextBox {
  const box = imageBox(`/api/media/pending/${stored.name}`, stored.aspect, "cover");
  box.name = stored.label;
  box.x = frame.x;
  box.y = frame.y;
  box.w = frame.w;
  box.h = frame.h;
  box.rotation = stored.rotation;
  box.flipX = stored.flipX;
  box.flipY = stored.flipY;
  box.opacity = stored.opacity;
  box.cropTop = stored.cropTop;
  box.cropRight = stored.cropRight;
  box.cropBottom = stored.cropBottom;
  box.cropLeft = stored.cropLeft;
  return box;
}

function textBox(
  node: Element,
  frame: Pick<TextBox, "x" | "y" | "w" | "h">,
  slide: number,
  slidePoints: number,
  sw: number,
  sh: number,
  clrMap: Record<string, string>,
  theme: Theme,
): TextBox | null {
  const body = first(node, P, "txBody");
  if (!body) return null;
  const rpr = first(node, A, "rPr");
  const latin = rpr ? first(rpr, A, "latin") : undefined;
  const typeface = latin?.getAttribute("typeface") ?? "";
  const fontFamily = FONT_FAMILIES.includes(typeface as (typeof FONT_FAMILIES)[number])
    ? typeface
    : "Visby CF Extra Bold";
  const sz = rpr?.getAttribute("sz");
  const fontSize = (sz ? Number(sz) / 100 : 72) / slidePoints;
  const ppr = first(node, A, "pPr");
  const align = ({ ctr: "center", r: "right", just: "center" }[ppr?.getAttribute("algn") ?? "ctr"] ?? "left") as TextAlign;
  const bodyPr = first(node, A, "bodyPr");
  const anchor = ({ ctr: "center", b: "end" }[bodyPr?.getAttribute("anchor") ?? "t"] ?? "start") as TextAnchor;
  const cnv = first(node, P, "cNvPr");
  const rawId = cnv?.getAttribute("id") || String(Math.round(frame.y * 1000));
  return {
    id: `s${slide}-${rawId}`.replace(/[^\w-]/g, "").slice(0, 40),
    name: (cnv?.getAttribute("name") || "Text").slice(0, 80),
    ...frame,
    text: textOf(node).slice(0, 800),
    fontFamily,
    fontSize: Number(fontSize.toFixed(5)),
    color: colorOf(rpr, clrMap, theme) || themeColor("tx1", clrMap, theme) || "#FFFFFF",
    align,
    anchor,
    italic: rpr?.getAttribute("i") === "1",
    padTop: inset(bodyPr, "tIns", sh),
    padRight: inset(bodyPr, "rIns", sw),
    padBottom: inset(bodyPr, "bIns", sh),
    padLeft: inset(bodyPr, "lIns", sw),
  };
}

function textShapeUnsupported(node: Element): boolean {
  const spPr = first(node, P, "spPr");
  if (!spPr) return false;
  if (hasVisibleFill(spPr) || hasVisibleLine(spPr)) return true;
  const xfrm = first(spPr, A, "xfrm");
  if (xfrm) {
    if (num(xfrm, "rot") !== 0) return true;
    if (xfrm.getAttribute("flipH") === "1" || xfrm.getAttribute("flipV") === "1") return true;
  }
  if (first(spPr, A, "scene3d") || first(spPr, A, "sp3d")) return true;
  const effects = first(spPr, A, "effectLst") ?? first(spPr, A, "effectDag");
  if (effects && effects.children.length) return true;
  const bodyPr = first(node, A, "bodyPr");
  const vert = bodyPr?.getAttribute("vert");
  if (vert && vert !== "horz") return true;
  if (first(node, A, "buChar") || first(node, A, "buAutoNum") || first(node, A, "buBlip")) return true;
  return false;
}

function hasVisibleFill(parent: Element): boolean {
  for (const child of [...parent.children]) {
    if (child.localName === "solidFill") {
      const alpha = first(child, A, "alpha");
      if (alpha && Number(alpha.getAttribute("val") ?? 100000) === 0) continue;
      return true;
    }
    if (child.localName === "gradFill" || child.localName === "pattFill" || child.localName === "blipFill") {
      return true;
    }
  }
  return false;
}

function hasVisibleLine(parent: Element): boolean {
  const line = [...parent.children].find((child) => child.localName === "ln");
  if (!line) return false;
  if ([...line.children].some((child) => child.localName === "noFill")) return false;
  if (Number(line.getAttribute("w") ?? 0) > 0) return true;
  return [...line.children].some(
    (child) => child.localName === "solidFill" || child.localName === "gradFill" || child.localName === "pattFill" || child.localName === "blipFill",
  );
}

function pictureOpacity(blip: Element | undefined): number {
  if (!blip) return 1;
  for (const child of [...blip.children]) {
    if (child.localName === "alphaModFix" || child.localName === "alphaMod") {
      const amount = Number(child.getAttribute("amt"));
      if (Number.isFinite(amount)) return Math.min(1, Math.max(0, amount / 100000));
    }
  }
  return 1;
}

function pictureUnsupported(node: Element, blip: Element | undefined): boolean {
  const spPr = first(node, P, "spPr");
  if (spPr) {
    const effects = first(spPr, A, "effectLst") ?? first(spPr, A, "effectDag");
    if (effects && effects.children.length) return true;
    if (first(spPr, A, "scene3d") || first(spPr, A, "sp3d")) return true;
  }
  if (blip) {
    for (const child of [...blip.children]) {
      if (
        child.localName === "duotone" ||
        child.localName === "grayscl" ||
        child.localName === "biLevel" ||
        child.localName === "lum" ||
        child.localName === "hsl" ||
        child.localName === "tint" ||
        child.localName === "fillOverlay" ||
        child.localName === "clrChange" ||
        child.localName === "clrRepl"
      ) {
        return true;
      }
    }
  }
  return false;
}

async function imageAspect(bytes: Uint8Array, mime: string): Promise<number> {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const aspect = image.naturalWidth / image.naturalHeight;
    return Number.isFinite(aspect) && aspect > 0 ? Math.min(10, Math.max(0.1, aspect)) : 16 / 9;
  } catch {
    return 16 / 9;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function rasterize(
  file: File,
  indexes: Set<number>,
  media: PptxMedia[],
  used: Set<string>,
): Promise<Map<number, string>> {
  const rendered = new Map<number, string>();
  let renderer: PptxRenderer | null = null;
  try {
    const module = await import("pptx-browser");
    renderer = new module.PptxRenderer();
    await renderer.load(file);
    for (const index of [...indexes].sort((a, b) => a - b)) {
      if (index >= renderer.slideCount) continue;
      try {
        const canvas = document.createElement("canvas");
        await renderer.renderSlide(index, canvas, 1920);
        const bytes = await canvasPng(canvas);
        const name = uniqueName(`slide-${index + 1}.png`, used);
        media.push({ name, mime: "image/png", bytes });
        rendered.set(index, name);
      } catch (caught) {
        console.warn(`Could not render PowerPoint slide ${index + 1} as an image.`, caught);
      }
    }
  } catch (caught) {
    console.warn("Could not load the PowerPoint renderer.", caught);
  } finally {
    try {
      renderer?.destroy();
    } catch {
      // The renderer may not have finished loading; there is nothing left to release.
    }
  }
  return rendered;
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The slide image could not be encoded."));
        return;
      }
      blob
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(reject);
    }, "image/png");
  });
}

function uniqueName(base: string, used: Set<string>): string {
  const clean = base.replace(/[^\w.-]/g, "").slice(0, 80) || "image.png";
  let candidate = clean.includes(".") ? clean : `${clean}.png`;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const dot = candidate.lastIndexOf(".");
  const stem = dot > 0 ? candidate.slice(0, dot) : candidate;
  const ext = dot > 0 ? candidate.slice(dot) : "";
  let count = 2;
  while (used.has(`${stem}-${count}${ext}`)) count += 1;
  candidate = `${stem}-${count}${ext}`;
  used.add(candidate);
  return candidate;
}

function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function transform(node: Element, sw: number, sh: number): Pick<TextBox, "x" | "y" | "w" | "h"> | null {
  const xfrm = first(node, A, "xfrm");
  const off = xfrm ? first(xfrm, A, "off") : undefined;
  const ext = xfrm ? first(xfrm, A, "ext") : undefined;
  if (!off || !ext) return null;
  return {
    x: round(num(off, "x") / sw),
    y: round(num(off, "y") / sh),
    w: round(num(ext, "cx") / sw),
    h: round(num(ext, "cy") / sh),
  };
}

function textOf(node: Element): string {
  const lines: string[] = [];
  for (const para of node.getElementsByTagNameNS(A, "p")) {
    let line = "";
    for (const child of [...para.children]) {
      if (child.localName === "r") line += first(child, A, "t")?.textContent ?? "";
      if (child.localName === "br") line += "\n";
    }
    lines.push(line);
  }
  return lines.join("\n").replace(/\u00a0/g, " ").trim();
}

function colorOf(rpr: Element | undefined, clrMap: Record<string, string>, theme: Theme): string | null {
  if (!rpr) return null;
  const solid = first(rpr, A, "solidFill");
  return solid ? colorNode(solid, clrMap, theme) : null;
}

function inset(bodyPr: Element | undefined, attr: string, axis: number): number {
  if (!bodyPr || bodyPr.getAttribute(attr) == null) return 0;
  return round(Number(bodyPr.getAttribute(attr)) / axis);
}

async function titleOf(zip: JSZip): Promise<string> {
  const file = zip.file("docProps/core.xml");
  if (!file) return "";
  return first(parse(await file.async("string")), DC, "title")?.textContent?.trim() ?? "";
}

function displayTitle(fromFile: string, name: string): string {
  const cleaned = fromFile.replace(/\s+/g, " ").trim();
  if (cleaned && !/^(powerpoint presentation|presentation)$/i.test(cleaned)) return cleaned;
  return name.replace(/\.pptx$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled";
}

async function relationships(zip: JSZip, path: string): Promise<Record<string, string>> {
  const file = zip.file(path);
  if (!file) return {};
  const rels: Record<string, string> = {};
  for (const node of parse(await file.async("string")).getElementsByTagNameNS(PR, "Relationship")) {
    const id = node.getAttribute("Id");
    const target = node.getAttribute("Target");
    if (id && target) rels[id] = target;
  }
  return rels;
}

async function read(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing ${path}`);
  return file.async("string");
}

function parse(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("This PowerPoint file could not be read.");
  return doc;
}

function first(root: Document | Element, ns: string, local: string): Element | undefined {
  return root.getElementsByTagNameNS(ns, local)[0];
}

function num(node: Element, attr: string): number {
  return Number(node.getAttribute(attr) ?? 0);
}

function round(value: number): number {
  return Number(value.toFixed(5));
}

function relsPath(path: string): string {
  const parts = path.split("/");
  const name = parts.pop() ?? "";
  return `${parts.join("/")}/_rels/${name}.rels`;
}

function join(base: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : `${base}/${target}`).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function extension(path: string): string {
  return (path.split(".").pop() ?? "").toLowerCase();
}
