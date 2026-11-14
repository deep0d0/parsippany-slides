declare module "pptx-browser" {
  export class PptxRenderer {
    slideCount: number;
    slideSize: { cx: number; cy: number };
    load(
      source: File | Blob | ArrayBuffer | Uint8Array,
      onProgress?: (progress: number, message: string) => void,
    ): Promise<void>;
    renderSlide(index: number, canvas: HTMLCanvasElement, width?: number): Promise<void>;
    destroy(): void;
  }

  export default PptxRenderer;
}
