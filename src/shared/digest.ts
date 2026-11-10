import { isImageBox, isSponsorSlide, visibleSlides, type Deck, type Slide } from "./types";

/** Every text box becomes one line, ordered top-to-bottom and then left-to-right. */
export function slideDigestLines(slide: Slide): string[] {
  return slide.boxes
    .filter((box) => !isImageBox(box))
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((box) => box.text.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Visible slides that are tagged for the sponsorship digest, in deck order. */
export function digestSlides(deck: Deck): Slide[] {
  return visibleSlides(deck).filter((slide) => isSponsorSlide(slide) && slideDigestLines(slide).length > 0);
}

/**
 * The message body without its timestamp, so an edit can be detected without
 * treating the clock itself as a change.
 */
export function digestBody(deck: Deck): string {
  const slides = digestSlides(deck);
  if (slides.length === 0) return "";
  const blocks = slides.map((slide, index) => {
    const [heading, ...names] = slideDigestLines(slide);
    return [`${index + 1}. ${heading}`, ...names].join("\n");
  });
  return [deck.title.trim(), "", blocks.join("\n\n")].join("\n").trim();
}

export function digestTimestamp(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** One clock, no other decoration. */
export function buildDigest(deck: Deck, updatedAt: number): string {
  const body = digestBody(deck);
  if (!body) return "";
  return `${body}\n\n🕒 Updated ${digestTimestamp(updatedAt)}`;
}
