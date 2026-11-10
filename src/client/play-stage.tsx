import { useEffect } from "react";
import { isImageBox, type Slide } from "../shared/types";
import { preloadImages } from "./preload";
import { SlideView } from "./slide-view";

export function PlayStage({ slides, index }: { slides: Slide[]; index: number }) {
  useEffect(() => {
    preloadImages(slides.flatMap(mediaOf));
  }, [slides]);

  const current = slides[index];
  if (!current) return null;
  const shown = [index - 1, index, index + 1]
    .filter((item) => item >= 0 && item < slides.length)
    .map((item) => slides[item]);

  return (
    <div className="play-stage">
      <div className="play-prefetch" aria-hidden="true">
        {slides.flatMap((slide) =>
          mediaOf(slide).map((src) => <img key={`${slide.id}:${src}`} src={src} alt="" />),
        )}
      </div>
      {shown.map((slide) => (
        <div
          key={slide.id}
          className={slide.id === current.id ? "play-layer is-on" : "play-layer"}
          aria-hidden={slide.id !== current.id}
        >
          <SlideView slide={slide} />
        </div>
      ))}
    </div>
  );
}

function mediaOf(slide: Slide): string[] {
  const urls: string[] = [];
  if (slide.background) urls.push(slide.background);
  for (const box of slide.boxes) {
    if (isImageBox(box)) urls.push(box.src);
  }
  return urls;
}
