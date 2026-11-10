import {
  FONT_FAMILIES,
  MAX_ADVANCE_SECONDS,
  MIN_ADVANCE_SECONDS,
  SLIDE_POINTS,
  clampIndex,
  isMediaUrl,
  visibleSlides,
  type BoxPatch,
  type ClientMessage,
  type RoomState,
  type Slide,
  type TextBox,
} from "./types";

const MAX_SLIDES = 60;
const MAX_BOXES = 40;

function watchingId(state: RoomState): string | undefined {
  return visibleSlides(state.deck)[state.index]?.id;
}

function restoreWatching(state: RoomState, id: string | undefined, fallbackIndex: number) {
  if (!id) {
    state.index = clampIndex(state.deck, fallbackIndex);
    return;
  }
  const index = visibleSlides(state.deck).findIndex((slide) => slide.id === id);
  state.index = index === -1 ? clampIndex(state.deck, fallbackIndex) : index;
}

function clampUnit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Whole seconds for autoplay. Returns null for anything that is not a usable duration. */
export function sanitizeSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(MAX_ADVANCE_SECONDS, Math.max(MIN_ADVANCE_SECONDS, Math.round(value)));
}

function fitFrame(frame: Pick<TextBox, "x" | "y" | "w" | "h">): Pick<TextBox, "x" | "y" | "w" | "h"> {
  const w = clampUnit(frame.w, 0.04, 1);
  const h = clampUnit(frame.h, 0.03, 1);
  const x = clampUnit(frame.x, 0, 1 - w);
  const y = clampUnit(frame.y, 0, 1 - h);
  return { x, y, w, h };
}

function sanitizeBox(box: TextBox): TextBox | null {
  if (!box || typeof box.id !== "string" || !/^[\w-]{1,40}$/.test(box.id)) return null;
  const frame = fitFrame(box);
  const points = clampUnit(box.fontSize * SLIDE_POINTS, 8, SLIDE_POINTS);
  const color = /^#[0-9a-fA-F]{6}$/.test(box.color) ? box.color : "#FFFFFF";
  const align = box.align === "left" || box.align === "right" ? box.align : "center";
  const anchor = box.anchor === "start" || box.anchor === "end" ? box.anchor : "center";
  const fontFamily = FONT_FAMILIES.includes(box.fontFamily as (typeof FONT_FAMILIES)[number])
    ? box.fontFamily
    : "Visby CF Extra Bold";
  const cleaned: TextBox = {
    ...box,
    ...frame,
    name: typeof box.name === "string" ? box.name.slice(0, 80) : "Text",
    text: typeof box.text === "string" ? box.text.slice(0, 800) : "",
    fontFamily,
    fontSize: points / SLIDE_POINTS,
    color,
    align,
    anchor,
    italic: Boolean(box.italic),
    padTop: clampUnit(box.padTop ?? 0, 0, 0.2),
    padRight: clampUnit(box.padRight ?? 0, 0, 0.2),
    padBottom: clampUnit(box.padBottom ?? 0, 0, 0.2),
    padLeft: clampUnit(box.padLeft ?? 0, 0, 0.2),
  };
  if (box.kind === "image") {
    if (typeof box.src !== "string" || !isMediaUrl(box.src)) return null;
    cleaned.kind = "image";
    cleaned.src = box.src;
    cleaned.fit = box.fit === "contain" ? "contain" : "cover";
    cleaned.aspect = clampUnit(typeof box.aspect === "number" ? box.aspect : 16 / 9, 0.1, 10);
    cleaned.text = "";
    cleaned.padTop = 0;
    cleaned.padRight = 0;
    cleaned.padBottom = 0;
    cleaned.padLeft = 0;
    return cleaned;
  }
  delete cleaned.kind;
  delete cleaned.src;
  delete cleaned.fit;
  delete cleaned.aspect;
  return cleaned;
}

function sanitizeSlide(slide: Slide): Slide | null {
  if (!slide || typeof slide.id !== "string" || !/^[\w-]{1,40}$/.test(slide.id)) return null;
  const boxes = Array.isArray(slide.boxes) ? slide.boxes.slice(0, MAX_BOXES).map(sanitizeBox) : [];
  const cleaned: Slide = {
    id: slide.id,
    hidden: Boolean(slide.hidden),
    background: typeof slide.background === "string" && isMediaUrl(slide.background) ? slide.background : null,
    boxes: boxes.filter((box): box is TextBox => box !== null),
  };
  const seconds = sanitizeSeconds(slide.advanceSeconds);
  if (seconds !== null) cleaned.advanceSeconds = seconds;
  if (typeof slide.sponsor === "boolean") cleaned.sponsor = slide.sponsor;
  return cleaned;
}

function applyPatch(box: TextBox, patch: BoxPatch) {
  if (typeof patch.text === "string" && box.kind !== "image") box.text = patch.text.slice(0, 800);
  if (typeof patch.fontFamily === "string" && FONT_FAMILIES.includes(patch.fontFamily as (typeof FONT_FAMILIES)[number])) {
    box.fontFamily = patch.fontFamily;
  }
  if (typeof patch.fontSize === "number") {
    box.fontSize = clampUnit(patch.fontSize * SLIDE_POINTS, 8, SLIDE_POINTS) / SLIDE_POINTS;
  }
  if (typeof patch.color === "string" && /^#[0-9a-fA-F]{6}$/.test(patch.color)) box.color = patch.color;
  if (patch.align === "left" || patch.align === "center" || patch.align === "right") box.align = patch.align;
  if (patch.anchor === "start" || patch.anchor === "center" || patch.anchor === "end") box.anchor = patch.anchor;
  if (typeof patch.italic === "boolean") box.italic = patch.italic;
  if (typeof patch.padTop === "number") box.padTop = clampUnit(patch.padTop, 0, 0.2);
  if (typeof patch.padRight === "number") box.padRight = clampUnit(patch.padRight, 0, 0.2);
  if (typeof patch.padBottom === "number") box.padBottom = clampUnit(patch.padBottom, 0, 0.2);
  if (typeof patch.padLeft === "number") box.padLeft = clampUnit(patch.padLeft, 0, 0.2);
  if (box.kind === "image" && (patch.fit === "cover" || patch.fit === "contain")) box.fit = patch.fit;
  if (patch.x !== undefined || patch.y !== undefined || patch.w !== undefined || patch.h !== undefined) {
    Object.assign(
      box,
      fitFrame({
        x: patch.x ?? box.x,
        y: patch.y ?? box.y,
        w: patch.w ?? box.w,
        h: patch.h ?? box.h,
      }),
    );
  }
}

export function reduce(state: RoomState, message: ClientMessage): RoomState {
  const next = structuredClone(state);
  next.rev += 1;

  if (message.type === "text") {
    const box = findBox(next, message.slideId, message.boxId);
    if (!box || box.kind === "image" || typeof message.text !== "string") return state;
    box.text = message.text.slice(0, 800);
    return next;
  }

  if (message.type === "updateBox") {
    const box = findBox(next, message.slideId, message.boxId);
    if (!box || !message.patch) return state;
    applyPatch(box, message.patch);
    return next;
  }

  if (message.type === "addBox") {
    const slide = next.deck.slides.find((item) => item.id === message.slideId);
    const box = sanitizeBox(message.box);
    if (!slide || !box || slide.boxes.length >= MAX_BOXES || slide.boxes.some((item) => item.id === box.id)) {
      return state;
    }
    slide.boxes.push(box);
    return next;
  }

  if (message.type === "deleteBox") {
    const slide = next.deck.slides.find((item) => item.id === message.slideId);
    if (!slide) return state;
    const before = slide.boxes.length;
    slide.boxes = slide.boxes.filter((item) => item.id !== message.boxId);
    return slide.boxes.length === before ? state : next;
  }

  if (message.type === "index") {
    next.index = clampIndex(next.deck, message.index);
    if (next.hold) next.heldIndex = next.index;
    return next;
  }

  if (message.type === "hold") {
    if (message.hold && !next.hold) {
      next.hold = true;
      next.heldDeck = structuredClone(next.deck);
      next.heldIndex = next.index;
    } else if (!message.hold && next.hold) {
      next.hold = false;
      next.heldDeck = null;
    } else {
      return state;
    }
    return next;
  }

  if (message.type === "visibility") {
    const slide = next.deck.slides.find((item) => item.id === message.slideId);
    if (!slide || slide.hidden === message.hidden) return state;
    const previous = watchingId(next);
    const previousIndex = next.index;
    slide.hidden = message.hidden;
    restoreWatching(next, previous === slide.id ? undefined : previous, previousIndex);
    return next;
  }

  if (message.type === "autoplay") {
    if (typeof message.autoplay !== "boolean" || next.autoplay === message.autoplay) return state;
    next.autoplay = message.autoplay;
    return next;
  }

  if (message.type === "deckTiming") {
    const seconds = sanitizeSeconds(message.seconds);
    if (seconds === null || next.deck.advanceSeconds === seconds) return state;
    next.deck.advanceSeconds = seconds;
    return next;
  }

  if (message.type === "slideTiming") {
    const slide = next.deck.slides.find((item) => item.id === message.slideId);
    if (!slide) return state;
    const seconds = sanitizeSeconds(message.seconds);
    if (seconds === null) {
      if (slide.advanceSeconds === undefined) return state;
      delete slide.advanceSeconds;
    } else {
      if (slide.advanceSeconds === seconds) return state;
      slide.advanceSeconds = seconds;
    }
    return next;
  }

  if (message.type === "sponsor") {
    const slide = next.deck.slides.find((item) => item.id === message.slideId);
    if (!slide) return state;
    if (message.sponsor === null || message.sponsor === undefined) {
      if (slide.sponsor === undefined) return state;
      delete slide.sponsor;
      return next;
    }
    if (typeof message.sponsor !== "boolean" || slide.sponsor === message.sponsor) return state;
    slide.sponsor = message.sponsor;
    return next;
  }

  if (message.type === "insertSlide") {
    if (next.deck.slides.length >= MAX_SLIDES) return state;
    const slide = sanitizeSlide(message.slide);
    if (!slide || next.deck.slides.some((item) => item.id === slide.id)) return state;
    const previous = watchingId(next);
    const at = next.deck.slides.findIndex((item) => item.id === message.afterId);
    next.deck.slides.splice(at === -1 ? next.deck.slides.length : at + 1, 0, slide);
    restoreWatching(next, previous, next.index);
    return next;
  }

  if (message.type === "deleteSlide") {
    if (next.deck.slides.length <= 1) return state;
    const previous = watchingId(next);
    const previousIndex = next.index;
    const before = next.deck.slides.length;
    next.deck.slides = next.deck.slides.filter((item) => item.id !== message.slideId);
    if (next.deck.slides.length === before) return state;
    restoreWatching(next, previous === message.slideId ? undefined : previous, previousIndex);
    return next;
  }

  if (message.type === "setDeck") {
    const slides = sanitizeSlides(message.slides);
    if (slides.length === 0) return state;
    const previous = watchingId(next);
    next.deck.slides = slides;
    restoreWatching(next, previous, next.index);
    return next;
  }

  const from = next.deck.slides.findIndex((item) => item.id === message.slideId);
  if (from === -1 || from === message.toIndex || !Number.isInteger(message.toIndex)) return state;
  const previous = watchingId(next);
  const [moved] = next.deck.slides.splice(from, 1);
  const dest = Math.min(next.deck.slides.length, Math.max(0, message.toIndex));
  next.deck.slides.splice(dest, 0, moved);
  restoreWatching(next, previous, next.index);
  return next;
}

function findBox(state: RoomState, slideId: string, boxId: string): TextBox | undefined {
  return state.deck.slides.find((slide) => slide.id === slideId)?.boxes.find((box) => box.id === boxId);
}

export function sanitizeSlides(list: unknown): Slide[] {
  if (!Array.isArray(list)) return [];
  const slides: Slide[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, MAX_SLIDES)) {
    const slide = sanitizeSlide(item as Slide);
    if (!slide || seen.has(slide.id)) continue;
    seen.add(slide.id);
    slides.push(slide);
  }
  return slides;
}

export function sanitizeTitle(value: unknown): string {
  if (typeof value !== "string") return "Untitled";
  const title = value.replace(/\s+/g, " ").trim().slice(0, 120);
  return title || "Untitled";
}
