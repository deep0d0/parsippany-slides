import { SLIDE_POINTS, type Slide, type TextBox } from "./types";

export const ATTENDANCE_SLIDE_ID = "attendance";
export const ATTENDANCE_KIND = "attendance";
export const ATTENDANCE_BACKGROUND = "#F4EEE3";
export const ATTENDANCE_HEADING = "Scan for\nRavisabha Attendance";

export const ATTENDANCE_TITLE_ID = "attendance-title";
export const ATTENDANCE_LOCATION_ID = "attendance-location";
export const ATTENDANCE_DATE_ID = "attendance-date";
export const ATTENDANCE_HEADING_ID = "attendance-heading";
export const ATTENDANCE_QR_ID = "attendance-qr";
export const ATTENDANCE_KICKER_ID = "attendance-kicker";

export type AttendanceDetails = {
  title: string;
  location: string;
  date: string;
};

const DEFAULT_DETAILS: AttendanceDetails = {
  title: "Ravi Sabha – 2026",
  location: "Parsippany",
  date: "Add date and time",
};

export function attendanceSlide(): Slide {
  return {
    id: ATTENDANCE_SLIDE_ID,
    kind: ATTENDANCE_KIND,
    hidden: false,
    background: null,
    backgroundColor: ATTENDANCE_BACKGROUND,
    boxes: [],
  };
}

/**
 * There is one attendance slide per deck, and it always sits first. It is
 * allowed to be hidden, but deleting it should not remove the slot entirely.
 */
export function ensureAttendanceSlide(slides: Slide[]): Slide[] {
  const found =
    slides.find((slide) => slide.kind === ATTENDANCE_KIND) ??
    slides.find((slide) => slide.id === ATTENDANCE_SLIDE_ID);
  const attendance: Slide = found ? { ...found, kind: ATTENDANCE_KIND } : attendanceSlide();
  const rest = slides
    .filter((slide) => slide !== found)
    .map((slide) => {
      if (slide.kind !== ATTENDANCE_KIND) return slide;
      const copy = structuredClone(slide);
      delete copy.kind;
      return copy;
    });
  return [attendance, ...rest];
}

export function attendanceValues(slide: Slide | undefined): AttendanceDetails {
  if (!slide) return { ...DEFAULT_DETAILS };
  const read = (id: string) =>
    slide.boxes.find((box) => box.id === id && box.kind !== "image")?.text ?? "";
  return {
    title: read(ATTENDANCE_TITLE_ID) || DEFAULT_DETAILS.title,
    location: read(ATTENDANCE_LOCATION_ID) || DEFAULT_DETAILS.location,
    date: read(ATTENDANCE_DATE_ID) || DEFAULT_DETAILS.date,
  };
}

export function attendanceLayout(qrSrc: string, details: AttendanceDetails): TextBox[] {
  const values = {
    title: details.title.trim() || DEFAULT_DETAILS.title,
    location: details.location.trim() || DEFAULT_DETAILS.location,
    date: details.date.trim() || DEFAULT_DETAILS.date,
  };

  return [
    qrBox(qrSrc),
    textBox({
      id: ATTENDANCE_KICKER_ID,
      text: "WEEKLY ATTENDANCE",
      x: 0.52,
      y: 0.145,
      w: 0.43,
      h: 0.055,
      fontFamily: "Visby CF Medium",
      points: 34,
      color: "#B15C3C",
      align: "left",
      anchor: "end",
    }),
    textBox({
      id: ATTENDANCE_TITLE_ID,
      text: values.title,
      x: 0.52,
      y: 0.205,
      w: 0.43,
      h: 0.24,
      fontFamily: "Visby CF Extra Bold",
      points: 108,
      color: "#18384A",
      align: "left",
      anchor: "start",
    }),
    textBox({
      id: ATTENDANCE_LOCATION_ID,
      text: values.location,
      x: 0.52,
      y: 0.475,
      w: 0.43,
      h: 0.08,
      fontFamily: "Visby CF",
      points: 62,
      color: "#6C5C4D",
      align: "left",
      anchor: "start",
    }),
    textBox({
      id: ATTENDANCE_DATE_ID,
      text: splitDate(values.date),
      x: 0.52,
      y: 0.57,
      w: 0.43,
      h: 0.14,
      fontFamily: "Visby CF",
      points: 62,
      color: "#18384A",
      align: "left",
      anchor: "start",
    }),
    textBox({
      id: ATTENDANCE_HEADING_ID,
      text: ATTENDANCE_HEADING,
      x: 0.52,
      y: 0.73,
      w: 0.43,
      h: 0.14,
      fontFamily: "Visby CF Extra Bold",
      points: 52,
      color: "#B15C3C",
      align: "left",
      anchor: "start",
    }),
  ];
}

function qrBox(src: string): TextBox {
  // The slide is 16:9, so a 0.38-wide square is 0.676-high.
  return {
    id: ATTENDANCE_QR_ID,
    name: "Attendance QR",
    x: 0.05,
    y: 0.16,
    w: 0.38,
    h: 0.676,
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
    fit: "contain",
    aspect: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
    cropTop: 0,
    cropRight: 0,
    cropBottom: 0,
    cropLeft: 0,
  };
}

function textBox({
  id,
  text,
  x,
  y,
  w,
  h,
  fontFamily,
  points,
  color,
  align,
  anchor,
}: {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontFamily: string;
  points: number;
  color: string;
  align: TextBox["align"];
  anchor: TextBox["anchor"];
}): TextBox {
  return {
    id,
    name: id.replace("attendance-", "").replace(/-/g, " "),
    x,
    y,
    w,
    h,
    text,
    fontFamily,
    fontSize: points / SLIDE_POINTS,
    color,
    align,
    anchor,
    italic: false,
    padTop: 0,
    padRight: 0,
    padBottom: 0,
    padLeft: 0,
  };
}

/** Put the clock time on its own line so the layout keeps breathing room. */
function splitDate(value: string): string {
  const normalized = value.replace(/\s+/g, " ").replace(/\s+[–-]\s+/, " – ").trim();
  const match = normalized.match(/^(.+?\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM).*)$/i);
  return match ? `${match[1]}\n${match[2]}` : normalized;
}
