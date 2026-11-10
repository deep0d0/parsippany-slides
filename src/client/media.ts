import { isMediaUrl } from "../shared/types";

const MAX_BYTES = 2_500_000;

export function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export async function saveImage(fileId: string, file: File): Promise<{ src: string; aspect: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, JPEG, WebP, or GIF.");
  if (file.size > MAX_BYTES) throw new Error("That image is too large to save.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const aspect = await imageAspect(bytes, file.type);
  const name = `${mediaId()}.${extension(file)}`;
  const sent = await fetch(`/api/files/${fileId}/media/${name}`, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
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

function extension(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (fromName === "jpeg") return "jpg";
  if (fromName === "jpg" || fromName === "png" || fromName === "gif" || fromName === "webp") return fromName;
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "png";
}

function imageAspect(bytes: Uint8Array, mime: string): Promise<number> {
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
