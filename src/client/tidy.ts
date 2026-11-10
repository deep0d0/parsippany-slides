import type { BoxPatch, Slide, TextBox } from "../shared/types";

export type TidyFix = {
  slideId: string;
  slideNumber: number;
  boxId: string;
  label: string;
  changes: string[];
  patch: BoxPatch;
};

export type TidyGroup = {
  id: string;
  label: string;
  slides: Slide[];
  numbers: number[];
  art: string | null;
};

export type TidyGroupView = TidyGroup & {
  referenceId: string;
  fixes: TidyFix[];
};

type NumberedSlide = { slide: Slide; number: number };

function textBoxes(slide: Slide): TextBox[] {
  return slide.boxes.filter((box) => box.kind !== "image" && box.text.trim().length > 0);
}

function headerBox(slide: Slide): TextBox | undefined {
  return textBoxes(slide)
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)[0];
}

function round(value: number, step = 100): number {
  return Math.round(value * step) / step;
}

/** A stable way to say "these slides share a visual design". */
function groupKey(slide: Slide): string | null {
  const boxes = textBoxes(slide);
  if (boxes.length === 0) return null;
  if (slide.background) return `art:${slide.background}`;
  const header = headerBox(slide);
  if (!header) return null;
  return `plain:${round(header.x)},${round(header.y)},${round(header.w)},${round(header.h)}:${boxes.length}`;
}

function rangeLabel(numbers: number[]): string {
  if (numbers.length === 1) return `Slide ${numbers[0]}`;
  let contiguous = true;
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] !== numbers[index - 1] + 1) contiguous = false;
  }
  if (contiguous) {
    return numbers.length === 2
      ? `Slides ${numbers[0]} and ${numbers[1]}`
      : `Slides ${numbers[0]}–${numbers[numbers.length - 1]}`;
  }
  return `Slides ${numbers.join(", ")}`;
}

export function buildTidyGroups(slides: Slide[], includeHidden: boolean): TidyGroup[] {
  const buckets = new Map<string, NumberedSlide[]>();
  slides.forEach((slide, index) => {
    if (slide.hidden && !includeHidden) return;
    const key = groupKey(slide);
    if (!key) return;
    const bucket = buckets.get(key) ?? [];
    bucket.push({ slide, number: index + 1 });
    buckets.set(key, bucket);
  });

  return [...buckets.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => {
      const numbers = items.map((item) => item.number);
      return {
        id: key,
        label: rangeLabel(numbers),
        slides: items.map((item) => item.slide),
        numbers,
        art: items[0].slide.background,
      };
    })
    .sort((a, b) => a.numbers[0] - b.numbers[0]);
}

function frameDistance(a: TextBox, b: TextBox): number {
  return Math.abs(a.y - b.y) * 2 + Math.abs(a.x - b.x) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h) * 2;
}

function matchingBox(reference: TextBox[], target: TextBox): TextBox | undefined {
  let best: TextBox | undefined;
  let score = Number.POSITIVE_INFINITY;
  for (const box of reference) {
    if (Math.abs(box.y - target.y) > 0.045) continue;
    if (Math.abs(box.h - target.h) > 0.04) continue;
    if (Math.abs(box.w - target.w) > 0.09) continue;
    if (Math.abs(box.x - target.x) > 0.12) continue;
    const distance = frameDistance(box, target);
    if (distance < score) {
      score = distance;
      best = box;
    }
  }
  return best;
}

function pointLabel(value: number): string {
  return `${Math.round(value)} pt`;
}

function paddingLabel(box: TextBox): string {
  return [box.padTop, box.padRight, box.padBottom, box.padLeft]
    .map((value) => Math.round(value * 2160))
    .join("/");
}

export function tidyFixes(group: TidyGroup, referenceId: string, slidePoints = 2160): TidyFix[] {
  const reference = group.slides.find((slide) => slide.id === referenceId) ?? group.slides[0];
  if (!reference) return [];
  const referenceBoxes = textBoxes(reference);
  const fixes: TidyFix[] = [];

  for (const slide of group.slides) {
    if (slide.id === reference.id) continue;
    const number = group.numbers[group.slides.indexOf(slide)] ?? 0;
    for (const box of textBoxes(slide)) {
      const match = matchingBox(referenceBoxes, box);
      if (!match) continue;
      const patch: BoxPatch = {};
      const changes: string[] = [];

      const fromPoints = box.fontSize * slidePoints;
      const toPoints = match.fontSize * slidePoints;
      if (Math.abs(fromPoints - toPoints) >= 1) {
        patch.fontSize = match.fontSize;
        changes.push(`${pointLabel(fromPoints)} → ${pointLabel(toPoints)}`);
      }

      const paddingDiffers =
        Math.abs(box.padTop - match.padTop) > 0.0015 ||
        Math.abs(box.padRight - match.padRight) > 0.0015 ||
        Math.abs(box.padBottom - match.padBottom) > 0.0015 ||
        Math.abs(box.padLeft - match.padLeft) > 0.0015;
      if (paddingDiffers) {
        patch.padTop = match.padTop;
        patch.padRight = match.padRight;
        patch.padBottom = match.padBottom;
        patch.padLeft = match.padLeft;
        changes.push(`padding ${paddingLabel(box)} → ${paddingLabel(match)} pt`);
      }

      if (changes.length === 0) continue;
      const line = box.text.replace(/\s+/g, " ").trim();
      fixes.push({
        slideId: slide.id,
        slideNumber: number,
        boxId: box.id,
        label: line.length > 42 ? `${line.slice(0, 41)}…` : line,
        changes,
        patch,
      });
    }
  }

  return fixes.sort((a, b) => a.slideNumber - b.slideNumber);
}

export function tidyViews(
  slides: Slide[],
  includeHidden: boolean,
  references: Record<string, string>,
  slidePoints = 2160,
): TidyGroupView[] {
  return buildTidyGroups(slides, includeHidden).map((group) => {
    const chosen = references[group.id];
    const referenceId = group.slides.some((slide) => slide.id === chosen) ? chosen : group.slides[0]?.id;
    return {
      ...group,
      referenceId: referenceId ?? "",
      fixes: referenceId ? tidyFixes(group, referenceId, slidePoints) : [],
    };
  });
}

export function applyTidyFixes(slides: Slide[], fixes: TidyFix[]): Slide[] {
  const next = structuredClone(slides);
  for (const fix of fixes) {
    const box = next
      .find((slide) => slide.id === fix.slideId)
      ?.boxes.find((item) => item.id === fix.boxId);
    if (box) Object.assign(box, fix.patch);
  }
  return next;
}
