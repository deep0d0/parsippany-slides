import jsQR from "jsqr";
import type { AttendanceDetails } from "../shared/attendance";

export type AttendanceRead = AttendanceDetails & {
  qrText: string;
  warning?: string;
};

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";

/**
 * Decode the QR from the weekly flyer, then read the lines below it. OCR is a
 * convenience: the QR is required, but the event details can always be edited.
 */
export async function readAttendanceImage(
  file: File,
  onStage: (stage: string) => void,
): Promise<AttendanceRead> {
  onStage("Reading the QR code");
  const canvas = await imageCanvas(file);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not read that image.");
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(pixels.data, pixels.width, pixels.height, {
    inversionAttempts: "attemptBoth",
  });
  if (!code?.data) {
    throw new Error("Could not find a readable QR code in that image. Try a sharper crop of the flyer.");
  }

  onStage("Reading the text");
  let raw = "";
  let warning: string | undefined;
  try {
    raw = await readText(canvas, onStage);
  } catch (error) {
    console.warn("Attendance OCR failed.", error);
    warning = "The QR code was updated, but the text was not read automatically. Edit the details below.";
  }
  const details = parseDetails(raw);
  if (!warning && !details.title && !details.location && !details.date) {
    warning = "The QR code was updated, but the text was hard to read. Edit the details below.";
  }
  return { qrText: code.data, ...details, warning };
}

export async function makeQrFile(value: string): Promise<File> {
  const module = await import("qrcode");
  const dataUrl = await module.toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 1024,
    color: { dark: "#152C3A", light: "#FFFFFF" },
  });
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], "attendance-qr.png", { type: "image/png" });
}

async function imageCanvas(file: File): Promise<HTMLCanvasElement> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, JPEG, WebP, or GIF image.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That image could not be opened.");
  }
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Could not read that image.");
  }
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

async function readText(
  canvas: HTMLCanvasElement,
  onStage: (stage: string) => void,
): Promise<string> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", undefined, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    gzip: true,
    logger: (message) => {
      if (message.status === "recognizing text") {
        onStage(`Reading the text (${Math.round((message.progress || 0) * 100)}%)`);
      } else if (message.status === "loading language traineddata") {
        onStage("Loading text reader");
      }
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const result = await worker.recognize(canvas);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

export function parseDetails(raw: string): AttendanceDetails {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").replace(/^[|_]+|[|_]+$/g, "").trim())
    .filter((line) => line.length > 1);
  const dateAt = lines.findIndex(
    (line) => new RegExp(MONTH, "i").test(line) && /\d{4}/.test(line),
  );
  if (dateAt === -1) return { title: "", location: "", date: "" };

  const dateParts = [lines[dateAt]];
  if (!/\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(dateParts[0]) && lines[dateAt + 1] && /\d{1,2}:\d{2}/.test(lines[dateAt + 1])) {
    dateParts.push(lines[dateAt + 1]);
  }
  const date = normalizeDate(dateParts.join(" "));
  const location = dateAt > 0 ? cleanLine(lines[dateAt - 1]) : "";
  const title = dateAt > 1 ? cleanLine(lines.slice(Math.max(0, dateAt - 2), dateAt - 1).join(" ")) : "";
  return {
    title: title && title.length > 2 ? title : "",
    location: location && location.length > 2 ? location : "",
    date,
  };
}

function cleanLine(value: string): string {
  return value
    .replace(new RegExp(`^${MONTH}\\s*`, "i"), "")
    .replace(/^[•·*\-–—\s]+|[•·*\-–—\s]+$/g, "")
    .trim();
}

function normalizeDate(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+[,;]\s+/g, ", ")
    .replace(/\s*[-–—]\s*/g, " – ")
    .replace(/\s+(AM|PM)\b/gi, " $1")
    .trim();
}
