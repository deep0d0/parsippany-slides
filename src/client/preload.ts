const images = new Map<string, HTMLImageElement>();

export function preloadImages(urls: Array<string | null | undefined>) {
  for (const url of urls) {
    if (!url || images.has(url)) continue;
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    images.set(url, image);
    void image.decode().catch(() => undefined);
  }
}
