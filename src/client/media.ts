import { MAX_MEDIA_BYTES, isMediaUrl } from "../shared/types";

export function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export async function saveImage(fileId: string, file: File): Promise<{ src: string; aspect: number }> {
  const mime = imageMime(file);
  if (!mime.startsWith("image/")) throw new Error("Choose a PNG, JPEG, WebP, GIF, or SVG.");
  if (file.size > MAX_MEDIA_BYTES) {
    throw new Error(`That image is too large to save. The limit is ${MAX_MEDIA_BYTES / 1_000_000} MB.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const aspect = await imageAspect(bytes, mime);
  const name = `${mediaId()}.${extension(file)}`;
  const sent = await fetch(`/api/files/${fileId}/media/${name}`, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: copyBytes(bytes),
  });
  if (!sent.ok) {
    const data = (await sent.json()) as { error?: string };
    throw new Error(data.error || "Could not save that image.");
  }
  const src = `/api/media/${fileId}/${name}`;
  if (!isMediaUrl(src)) throw new Error("Could not save that image.");
  return { src, aspect };
}

function mediaId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `img-${suffix}`;
}

function imageMime(file: File): string {
  const declared = file.type.split(";", 1)[0]?.toLowerCase() ?? "";
  if (declared.startsWith("image/")) return declared;
  return IMAGE_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? declared;
}

function extension(file: File): string {
  const declared = file.type.split(";", 1)[0]?.toLowerCase() ?? "";
  const fromName = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (fromName === "jpeg") return "jpg";
  if (fromName === "jpg" || fromName === "png" || fromName === "gif" || fromName === "webp" || fromName === "svg") return fromName;
  if (declared === "image/jpeg") return "jpg";
  if (declared === "image/webp") return "webp";
  if (declared === "image/gif") return "gif";
  if (declared === "image/svg+xml") return "svg";
  return "png";
}

function imageAspect(bytes: Uint8Array, mime: string): Promise<number> {
  if (mime === "image/svg+xml") {
    const svg = svgAspect(bytes);
    if (svg !== null) return Promise.resolve(svg);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([copyBytes(bytes)], { type: mime }));
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth < 1 || image.naturalHeight < 1) {
        reject(new Error("That image could not be read."));
        return;
      }
      resolve(image.naturalWidth / image.naturalHeight);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    image.src = url;
  });
}

/** Read the intrinsic aspect from SVG before falling back to the browser's 300×150 default. */
export function svgAspect(bytes: Uint8Array): number | null {
  const source = new TextDecoder().decode(bytes);
  const tag = source.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;
  const attr = (name: string) =>
    tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']+)`, "i"))?.[1]?.trim();
  const box = attr("viewBox")?.split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box[2] > 0 && box[3] > 0) return box[2] / box[3];
  const number = (value: string | undefined) => {
    const match = value?.match(/^([0-9]*\.?[0-9]+)/);
    return match ? Number(match[1]) : NaN;
  };
  const width = number(attr("width"));
  const height = number(attr("height"));
  return width > 0 && height > 0 ? width / height : null;
}
