export type TextAlign = "left" | "center" | "right";
export type TextAnchor = "start" | "center" | "end";

/** Slide height of an imported deck, in points. Font sizes are stored as a fraction of this. */
export const SLIDE_POINTS = 2160;
export const SLIDE_ASPECT = 16 / 9;
export const DEFAULT_ADVANCE_SECONDS = 8;
export const MIN_ADVANCE_SECONDS = 1;
export const MAX_ADVANCE_SECONDS = 600;
export const MAX_MEDIA_BYTES = 20_000_000;
export type ImageFit = "cover" | "contain";
export type ImageTint = "white" | "black";

export const FONT_FAMILIES = [
  "Visby CF Thin",
  "Visby CF Light",
  "Visby CF",
  "Visby CF Medium",
  "Visby CF Demi Bold",
  "Visby CF Bold",
  "Visby CF Extra Bold",
  "Visby CF Heavy",
] as const;

export type TextBox = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  align: TextAlign;
  anchor: TextAnchor;
  italic?: boolean;
  padTop: number;
  padRight: number;
  padBottom: number;
  padLeft: number;
  kind?: "text" | "image";
  /** Prevent edits, movement, resizing, and deletion from the editor. */
  locked?: boolean;
  /** Prevent movement and resizing while leaving content editable. */
  positionLocked?: boolean;
  src?: string;
  fit?: ImageFit;
  /** Image-only: render the artwork as a solid white or black silhouette. */
  tint?: ImageTint;
  aspect?: number;
  /** Image-only: clockwise rotation in degrees. */
  rotation?: number;
  /** Image-only: mirror across the vertical or horizontal axis. */
  flipX?: boolean;
  flipY?: boolean;
  /** Image-only: 0–1. */
  opacity?: number;
  /** Image-only: source crop insets, each 0–0.45. */
  cropTop?: number;
  cropRight?: number;
  cropBottom?: number;
  cropLeft?: number;
};

export type BoxPatch = Partial<
  Pick<
    TextBox,
    | "x"
    | "y"
    | "w"
    | "h"
    | "text"
    | "fontFamily"
    | "fontSize"
    | "color"
    | "align"
    | "anchor"
    | "italic"
    | "locked"
    | "positionLocked"
    | "fit"
    | "rotation"
    | "flipX"
    | "flipY"
    | "opacity"
    | "cropTop"
    | "cropRight"
    | "cropBottom"
    | "cropLeft"
    | "padTop"
    | "padRight"
    | "padBottom"
    | "padLeft"
  >
> & { tint?: ImageTint | null };

export type Slide = {
  id: string;
  /** Special fixed slides, such as the weekly attendance slide. */
  kind?: "attendance";
  hidden: boolean;
  background: string | null;
  /** Solid fill behind the background image, as #RRGGBB. */
  backgroundColor?: string;
  /** Render an SVG background as a solid silhouette. */
  backgroundTint?: ImageTint;
  /** Paint order, bottom to top. The layers panel edits this order. */
  boxes: TextBox[];
  /** Seconds this slide stays up during autoplay. Missing means the deck default. */
  advanceSeconds?: number;
  /**
   * Sponsorship digest override. Missing means automatic: the slide is included
   * when its text mentions "sponsor". True forces it in, false keeps it out.
   */
  sponsor?: boolean;
};

export type Deck = {
  id: string;
  title: string;
  seedRevision: number;
  slidePoints?: number;
  /** Default seconds per slide during autoplay. Missing means DEFAULT_ADVANCE_SECONDS. */
  advanceSeconds?: number;
  slides: Slide[];
};

export type RoomState = {
  fileId: string;
  deck: Deck;
  index: number;
  hold: boolean;
  autoplay: boolean;
  heldDeck: Deck | null;
  heldIndex: number;
  rev: number;
};

export type SavedFile = {
  id: string;
  title: string;
  updated: number;
  slides: number;
  archived: boolean;
};

export type TelegramStatus = {
  enabled: boolean;
  tokenSet: boolean;
  chatId: string;
  chatTitle: string;
  messageCount: number;
  lastSyncedAt: number;
  lastContentAt: number;
  lastError: string;
  nextRunAt: number;
  digest: string;
  tagged: number;
  visible: number;
};

export function isMediaUrl(value: string): boolean {
  return /^\/media\/[\w.-]{1,80}$/.test(value) || /^\/api\/media\/[\w-]{1,40}\/[\w.-]{1,80}$/.test(value);
}

export function isImageBox(box: TextBox): box is TextBox & { kind: "image"; src: string; fit: ImageFit } {
  return box.kind === "image" && typeof box.src === "string" && isMediaUrl(box.src);
}

export function isSvgBox(box: TextBox): boolean {
  return isImageBox(box) && /\.svg(?:[?#]|$)/i.test(box.src);
}

export function imageTintFilter(tint: ImageTint | undefined): string | undefined {
  if (tint === "white") return "brightness(0) invert(1)";
  if (tint === "black") return "brightness(0)";
  return undefined;
}

export type ClientMessage =
  | { type: "text"; slideId: string; boxId: string; text: string }
  | { type: "index"; index: number }
  | { type: "hold"; hold: boolean }
  | { type: "visibility"; slideId: string; hidden: boolean }
  | { type: "insertSlide"; afterId: string | null; slide: Slide }
  | { type: "deleteSlide"; slideId: string }
  | { type: "moveSlide"; slideId: string; toIndex: number }
  | { type: "addBox"; slideId: string; box: TextBox }
  | { type: "reorderBox"; slideId: string; boxId: string; toIndex: number }
  | { type: "deleteBox"; slideId: string; boxId: string }
  | { type: "updateBox"; slideId: string; boxId: string; patch: BoxPatch }
  | { type: "autoplay"; autoplay: boolean }
  | { type: "deckTiming"; seconds: number }
  | { type: "slideTiming"; slideId: string; seconds: number | null }
  | { type: "sponsor"; slideId: string; sponsor: boolean | null }
  | { type: "setDeck"; slides: Slide[] };

const MESSAGE_TYPES = new Set<ClientMessage["type"]>([
  "text",
  "index",
  "hold",
  "autoplay",
  "deckTiming",
  "slideTiming",
  "sponsor",
  "visibility",
  "insertSlide",
  "deleteSlide",
  "moveSlide",
  "addBox",
  "reorderBox",
  "deleteBox",
  "updateBox",
  "setDeck",
]);

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as { type?: string };
  return typeof message.type === "string" && MESSAGE_TYPES.has(message.type as ClientMessage["type"]);
}

export function visibleSlides(deck: Deck): Slide[] {
  return deck.slides.filter((slide) => !slide.hidden);
}

/** A slide is part of the sponsorship digest unless its override says otherwise. */
export function isSponsorSlide(slide: Slide): boolean {
  if (typeof slide.sponsor === "boolean") return slide.sponsor;
  return slide.boxes.some(
    (box) => box.kind !== "image" && typeof box.text === "string" && /sponsor/i.test(box.text),
  );
}

export function clampIndex(deck: Deck, index: number): number {
  const count = visibleSlides(deck).length;
  if (count === 0) return 0;
  return Math.max(0, Math.min(index, count - 1));
}

export function slideLabel(slide: Slide, number: number): string {
  if (slide.kind === "attendance") return "Attendance";
  const line = slide.boxes.map((box) => (isImageBox(box) ? "" : box.text.trim())).find(Boolean);
  return line?.split("\n")[0] ?? `Slide ${number}`;
}
