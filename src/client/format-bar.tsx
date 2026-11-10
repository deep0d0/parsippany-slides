import { useEffect, useState } from "react";
import { FONT_FAMILIES, SLIDE_POINTS, isImageBox, type BoxPatch, type ImageFit, type TextBox } from "../shared/types";
import type { AlignEdge, AlignTarget, DistributeAxis } from "./align";
import type { FitMode } from "./fit-text";

const SWATCHES = ["#FFFFFF", "#F6E7C1", "#E4C27A", "#F4F4F6", "#1C1C1F", "#7A1F2B"];

export function FormatBar({
  box,
  slidePoints = SLIDE_POINTS,
  selectionCount,
  onNewSlide,
  onAddBox,
  onAddImage,
  onPatch,
  onAlign,
  onDistribute,
  onFit,
  onImageFit,
}: {
  box: TextBox | null;
  slidePoints?: number;
  selectionCount: number;
  onNewSlide: () => void;
  onAddBox: () => void;
  onAddImage: () => void;
  onPatch: (patch: BoxPatch) => void;
  onAlign: (edge: AlignEdge, target: AlignTarget) => void;
  onDistribute: (axis: DistributeAxis, target: AlignTarget) => void;
  onFit: (mode: FitMode) => void;
  onImageFit: (fit: ImageFit) => void;
}) {
  const image = box ? isImageBox(box) : false;
  const text = image ? null : box;
  const points = text ? Math.round(text.fontSize * slidePoints) : 80;
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);
  const [alignTarget, setAlignTarget] = useState<AlignTarget>("slide");
  const canDistribute = alignTarget === "slide" ? selectionCount >= 2 : selectionCount >= 3;

  useEffect(() => {
    setSizeDraft(null);
  }, [box?.id]);

  const commitSize = (raw: string) => {
    const next = Number(raw);
    if (Number.isFinite(next) && next >= 8 && next <= slidePoints) onPatch({ fontSize: next / slidePoints });
    setSizeDraft(null);
  };

  return (
    <div className="ribbon" role="toolbar" aria-label="Slide formatting">
      <div className="ribbon-group">
        <button type="button" className="tool is-primary" onClick={onNewSlide}>
          New slide
        </button>
        <button type="button" className="tool" onClick={onAddBox}>
          Text box
        </button>
        <button type="button" className="tool" onClick={onAddImage}>
          Image
        </button>
      </div>
      <div className="ribbon-group">
        <label className="tool-field">
          <span className="sr">Font</span>
          <select
            aria-label="Font"
            disabled={!text}
            value={text?.fontFamily ?? "Visby CF Extra Bold"}
            onChange={(event) => onPatch({ fontFamily: event.target.value })}
          >
            {FONT_FAMILIES.map((family) => (
              <option key={family} value={family}>
                {family.replace("Visby CF", "Visby")}
              </option>
            ))}
          </select>
        </label>
        <label className="tool-field">
          <span className="sr">Font size</span>
          <input
            aria-label="Font size"
            inputMode="numeric"
            disabled={!text}
            value={sizeDraft ?? (text ? String(points) : "")}
            onFocus={() => setSizeDraft(String(points))}
            onChange={(event) => {
              setSizeDraft(event.target.value);
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next >= 8 && next <= slidePoints) onPatch({ fontSize: next / slidePoints });
            }}
            onBlur={(event) => commitSize(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <button
          type="button"
          className={text?.italic ? "tool is-on" : "tool"}
          aria-pressed={Boolean(text?.italic)}
          disabled={!text}
          onClick={() => text && onPatch({ italic: !text.italic })}
        >
          Italic
        </button>
      </div>
      <div className="ribbon-group" role="group" aria-label="Object alignment">
        <button
          type="button"
          className={alignTarget === "selection" ? "tool is-on" : "tool"}
          aria-pressed={alignTarget === "selection"}
          disabled={!box}
          onClick={() => setAlignTarget("selection")}
        >
          Selection
        </button>
        <button
          type="button"
          className={alignTarget === "slide" ? "tool is-on" : "tool"}
          aria-pressed={alignTarget === "slide"}
          disabled={!box}
          onClick={() => setAlignTarget("slide")}
        >
          Slide
        </button>
        {(["left", "center", "right", "top", "middle", "bottom"] as const).map((edge) => (
          <button
            key={edge}
            type="button"
            className="tool is-icon"
            aria-label={`Align ${edge} to ${alignTarget}`}
            disabled={!box}
            onClick={() => onAlign(edge, alignTarget)}
          >
            <AlignIcon edge={edge} />
          </button>
        ))}
        {(["horizontal", "vertical"] as const).map((axis) => (
          <button
            key={axis}
            type="button"
            className="tool is-icon"
            aria-label={`Distribute ${axis} across ${alignTarget}`}
            disabled={!canDistribute}
            onClick={() => onDistribute(axis, alignTarget)}
          >
            <DistributeIcon axis={axis} />
          </button>
        ))}
      </div>
      <div className="ribbon-group" role="group" aria-label="Text fitting">
        <button type="button" className="tool" disabled={!text} onClick={() => onFit("width")}>
          Slide width
        </button>
        <button type="button" className="tool" disabled={!text} onClick={() => onFit("text")}>
          Fit text
        </button>
      </div>
      <div className="ribbon-group" role="group" aria-label="Image size">
        <button
          type="button"
          className={image && box?.fit === "cover" ? "tool is-on" : "tool"}
          aria-pressed={image && box?.fit === "cover"}
          disabled={!image}
          onClick={() => onImageFit("cover")}
        >
          Scale to slide
        </button>
        <button
          type="button"
          className={image && box?.fit === "contain" ? "tool is-on" : "tool"}
          aria-pressed={image && box?.fit === "contain"}
          disabled={!image}
          onClick={() => onImageFit("contain")}
        >
          Keep proportions
        </button>
      </div>
      <div className="ribbon-group" role="group" aria-label="Text alignment">
        {(["left", "center", "right"] as const).map((align) => (
          <button
            key={align}
            type="button"
            className={text?.align === align ? "tool is-on" : "tool"}
            aria-pressed={text?.align === align}
            disabled={!text}
            onClick={() => onPatch({ align })}
          >
            {align === "left" ? "Left" : align === "center" ? "Center" : "Right"}
          </button>
        ))}
      </div>
      <div className="ribbon-group" role="group" aria-label="Vertical alignment">
        {(
          [
            ["start", "Top"],
            ["center", "Middle"],
            ["end", "Bottom"],
          ] as const
        ).map(([anchor, label]) => (
          <button
            key={anchor}
            type="button"
            className={text?.anchor === anchor ? "tool is-on" : "tool"}
            aria-pressed={text?.anchor === anchor}
            disabled={!text}
            onClick={() => onPatch({ anchor })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ribbon-group" role="group" aria-label="Text color">
        {SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            className={text?.color.toLowerCase() === color.toLowerCase() ? "swatch is-on" : "swatch"}
            style={{ background: color }}
            aria-label={color}
            disabled={!text}
            onClick={() => onPatch({ color })}
          />
        ))}
        <input
          className="color-input"
          type="color"
          aria-label="Custom color"
          disabled={!text}
          value={text?.color ?? "#FFFFFF"}
          onChange={(event) => onPatch({ color: event.target.value })}
        />
      </div>
    </div>
  );
}

function DistributeIcon({ axis }: { axis: DistributeAxis }) {
  const bars = axis === "horizontal" ? ["M2 3h2.2v10H2z", "M6.9 5h2.2v6H6.9z", "M11.8 3h2.2v10H11.8z"] : ["M3 2h10v2.2H3z", "M5 6.9h6v2.2H5z", "M3 11.8h10v2.2H3z"];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {bars.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function AlignIcon({ edge }: { edge: AlignEdge }) {
  const frames: Record<AlignEdge, { bar: string; box: string }> = {
    left: { bar: "M2 1.5v13", box: "M4 4h9v8H4z" },
    center: { bar: "M8 1.5v13", box: "M3 4h10v8H3z" },
    right: { bar: "M14 1.5v13", box: "M3 4h9v8H3z" },
    top: { bar: "M1.5 2h13", box: "M4 4h8v9H4z" },
    middle: { bar: "M1.5 8h13", box: "M4 3h8v10H4z" },
    bottom: { bar: "M1.5 14h13", box: "M4 3h8v9H4z" },
  };
  const frame = frames[edge];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={frame.bar} />
      <path d={frame.box} />
    </svg>
  );
}
