import JSZip from "jszip";
import { FONT_FAMILIES, type Slide, type TextAlign, type TextAnchor, type TextBox } from "../shared/types";

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
  const order = await slideOrder(zip, presentation);
  if (order.length === 0) throw new Error("This PowerPoint file has no slides.");

  const media: PptxMedia[] = [];
  const used = new Set<string>();
  const slides: Slide[] = [];

  for (let index = 0; index < Math.min(order.length, 60); index += 1) {
    const path = order[index];
    const root = parse(await read(zip, path)).documentElement;
    const rels = await relationships(zip, relsPath(path));
    const tree = first(root, P, "spTree");
    let background: string | null = null;
    const boxes: TextBox[] = [];
    if (tree) {
      for (const child of [...tree.children]) {
        const frame = transform(child, sw, sh);
        if (!frame) continue;
        const tag = child.localName;
        if (tag === "pic" && !background) {
          const stored = await picture(zip, child, rels, used, media);
          if (stored) background = stored;
        } else if (tag === "sp") {
          const box = textBox(child, frame, index + 1, slidePoints, sw, sh, clrMap);
          if (box) boxes.push(box);
        }
      }
    }
    slides.push({
      id: `s${index + 1}`,
      hidden: root.getAttribute("show") === "0",
      background,
      boxes,
    });
  }

  if (slides.length === 0) throw new Error("No slides could be read from this file.");
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

async function picture(
  zip: JSZip,
  node: Element,
  rels: Record<string, string>,
  used: Set<string>,
  media: PptxMedia[],
): Promise<string | null> {
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
  if (!used.has(name)) {
    used.add(name);
    media.push({ name, mime, bytes: await file.async("uint8array") });
  }
  return name;
}

function textBox(
  node: Element,
  frame: Pick<TextBox, "x" | "y" | "w" | "h">,
  slide: number,
  slidePoints: number,
  sw: number,
  sh: number,
  clrMap: Record<string, string>,
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
    color: colorOf(rpr, clrMap) || "#FFFFFF",
    align,
    anchor,
    italic: rpr?.getAttribute("i") === "1",
    padTop: inset(bodyPr, "tIns", sh),
    padRight: inset(bodyPr, "rIns", sw),
    padBottom: inset(bodyPr, "bIns", sh),
    padLeft: inset(bodyPr, "lIns", sw),
  };
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

function colorOf(rpr: Element | undefined, clrMap: Record<string, string>): string | null {
  if (!rpr) return null;
  const solid = first(rpr, A, "solidFill");
  if (!solid) return null;
  const srgb = first(solid, A, "srgbClr")?.getAttribute("val");
  if (srgb) return `#${srgb}`;
  const scheme = first(solid, A, "schemeClr")?.getAttribute("val") ?? "";
  const mapped = clrMap[scheme] ?? scheme;
  return SCHEME[mapped] ?? "#FFFFFF";
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
