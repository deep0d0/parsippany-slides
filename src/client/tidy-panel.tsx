import { useMemo, useState } from "react";
import type { Slide } from "../shared/types";
import { applyTidyFixes, tidyViews } from "./tidy";

export function TidyPanel({
  slides,
  slidePoints,
  currentSlideId,
  onApply,
  onClose,
}: {
  slides: Slide[];
  slidePoints?: number;
  currentSlideId: string;
  onApply: (slides: Slide[]) => void;
  onClose: () => void;
}) {
  const [includeHidden, setIncludeHidden] = useState(false);
  const [references, setReferences] = useState<Record<string, string>>({});
  const views = useMemo(
    () => tidyViews(slides, includeHidden, references, slidePoints),
    [slides, includeHidden, references, slidePoints],
  );
  const total = views.reduce((sum, view) => sum + view.fixes.length, 0);

  return (
    <div className="sheet-back" role="presentation" onClick={onClose}>
      <div
        className="sheet tidy-sheet"
        role="dialog"
        aria-labelledby="tidy-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <h2 id="tidy-title">Tidy up</h2>
            <p className="hint">Compare text size and padding with a reference slide from the same design.</p>
          </div>
          <button type="button" className="tool" onClick={onClose}>
            Close
          </button>
        </div>

        <label className="checkline">
          <input
            type="checkbox"
            checked={includeHidden}
            onChange={(event) => setIncludeHidden(event.currentTarget.checked)}
          />
          Include hidden slides
        </label>

        {views.length === 0 ? (
          <p className="hint tidy-empty">
            No similar slides yet. Tidy compares slides that share the same background art (or the same layout
            when there is no art).
          </p>
        ) : (
          <div className="tidy-groups">
            {views.map((group) => {
              const referenceNumber =
                group.numbers[group.slides.findIndex((slide) => slide.id === group.referenceId)] ?? group.numbers[0];
              return (
                <section className="tidy-group" key={group.id}>
                  <div className="tidy-group-head">
                    <div>
                      <h3>{group.label}</h3>
                      <p className="hint">
                        {group.slides.length} slides
                        {group.art ? " · same background" : " · same layout"}
                      </p>
                    </div>
                    <label className="tidy-ref">
                      <span>Match to</span>
                      <select
                        className="tidy-select"
                        value={group.referenceId}
                        onChange={(event) =>
                          setReferences((current) => ({ ...current, [group.id]: event.currentTarget.value }))
                        }
                      >
                        {group.slides.map((item, index) => (
                          <option key={item.id} value={item.id}>
                            Slide {group.numbers[index]}
                            {item.id === currentSlideId ? " (current)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {group.fixes.length === 0 ? (
                    <p className="tidy-ok">Everything matches slide {referenceNumber}.</p>
                  ) : (
                    <>
                      <ul className="tidy-list">
                        {group.fixes.map((fix) => (
                          <li key={`${fix.slideId}:${fix.boxId}`}>
                            <span className="tidy-what">
                              <span className="tidy-slide">Slide {fix.slideNumber}</span>
                              {fix.label}
                            </span>
                            <span className="tidy-change">{fix.changes.join(" · ")}</span>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        className="tool tidy-apply"
                        onClick={() => onApply(applyTidyFixes(slides, group.fixes))}
                      >
                        Apply {group.fixes.length} {group.fixes.length === 1 ? "fix" : "fixes"} to this group
                      </button>
                    </>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <div className="tidy-foot">
          <p className="hint">
            Font family, color, alignment, and box positions are never changed. Each apply is one undo step.
          </p>
          <div className="tidy-foot-actions">
            <button type="button" className="tool" onClick={onClose}>
              Done
            </button>
            <button
              type="button"
              className="fill-button"
              disabled={total === 0}
              onClick={() => onApply(applyTidyFixes(slides, views.flatMap((view) => view.fixes)))}
            >
              Apply all {total > 0 ? `${total} ` : ""}fixes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
