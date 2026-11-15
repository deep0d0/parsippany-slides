import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { SLIDE_POINTS, imageTintFilter, isImageBox, type TextBox } from "../shared/types";
import type { Slide } from "../shared/types";

type Stage = { w: number; h: number };
type Frame = Pick<TextBox, "x" | "y" | "w" | "h">;
type FramePatch = Frame & { fontSize?: number };
type Handle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function SlideView({
  slide,
  editable = false,
  selectedIds = [],
  editingId,
  onSelect,
  onEdit,
  onText,
  onFrame,
  onContextMenu,
}: {
  slide: Slide;
  editable?: boolean;
  selectedIds?: string[];
  editingId?: string | null;
  onSelect?: (boxId: string, shift?: boolean) => void;
  onEdit?: (boxId: string | null) => void;
  onText?: (boxId: string, text: string) => void;
  onFrame?: (boxId: string, patch: FramePatch) => void;
  onContextMenu?: (boxId: string, x: number, y: number) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>({ w: 0, h: 0 });
  const [draft, setDraft] = useState<{ id: string; patch: FramePatch } | null>(null);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const measure = () => setStage({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={editable ? "slide is-editable" : "slide"}
      ref={frameRef}
      style={slide.backgroundColor ? { backgroundColor: slide.backgroundColor } : undefined}
      onPointerDown={
        editable
          ? () => {
              onSelect?.("");
              onEdit?.(null);
            }
          : undefined
      }
      onContextMenu={
        editable
          ? (event) => {
              event.preventDefault();
              onContextMenu?.("", event.clientX, event.clientY);
            }
          : undefined
      }
    >
      {slide.background ? (
        <img
          className="slide-art"
          src={slide.background}
          alt=""
          draggable={false}
          decoding="async"
          style={{ filter: imageTintFilter(slide.backgroundTint) }}
        />
      ) : null}
      {stage.h > 0
        ? slide.boxes.map((box) => {
            const shown = draft?.id === box.id ? { ...box, ...draft.patch } : box;
            return (
              <Line
                key={box.id}
                box={shown}
                stage={stage}
                editable={editable}
                selected={selectedIds.includes(box.id)}
                handles={selectedIds[selectedIds.length - 1] === box.id && !box.locked && !box.positionLocked}
                editing={editingId === box.id && !isImageBox(box) && !box.locked}
                onSelect={onSelect}
                onEdit={onEdit}
                onText={onText}
                onContextMenu={onContextMenu}
                onDraft={(patch) => setDraft({ id: box.id, patch })}
                onCommit={(patch) => {
                  setDraft(null);
                  onFrame?.(box.id, patch);
                }}
              />
            );
          })
        : null}
    </div>
  );
}

function Line({
  box,
  stage,
  editable,
  selected,
  handles,
  editing,
  onSelect,
  onEdit,
  onText,
  onContextMenu,
  onDraft,
  onCommit,
}: {
  box: TextBox;
  stage: Stage;
  editable: boolean;
  selected: boolean;
  handles: boolean;
  editing: boolean;
  onSelect?: (boxId: string, shift?: boolean) => void;
  onEdit?: (boxId: string | null) => void;
  onText?: (boxId: string, text: string) => void;
  onContextMenu?: (boxId: string, x: number, y: number) => void;
  onDraft: (patch: FramePatch) => void;
  onCommit: (patch: FramePatch) => void;
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const image = isImageBox(box);
  const empty = !image && box.text.trim().length === 0;

  useEffect(() => {
    const element = textRef.current;
    if (!element || (editing && document.activeElement === element)) return;
    if (element.innerText !== box.text) element.innerText = box.text;
  }, [box.text, editing]);

  useEffect(() => {
    if (editing) textRef.current?.focus();
  }, [editing]);

  if (!editable && empty) return null;

  const justify =
    box.anchor === "center" ? "center" : box.anchor === "end" ? "flex-end" : "flex-start";

  const gesture = (handle?: Handle) => (event: ReactPointerEvent) => {
    if (!editable) return;
    event.stopPropagation();
    onSelect?.(box.id, event.shiftKey);
    if (box.locked || box.positionLocked) return;
    if (handle || image) onEdit?.(null);
    else if (editing) return;

    const start = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      frame: { x: box.x, y: box.y, w: box.w, h: box.h },
    };
    const angle = image ? ((box.rotation ?? 0) * Math.PI) / 180 : 0;
    let latest = start.frame;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.pointerX) / stage.w;
      const dy = (ev.clientY - start.pointerY) / stage.h;
      if (!moved && Math.hypot(ev.clientX - start.pointerX, ev.clientY - start.pointerY) < 3) return;
      moved = true;
      let localDx = dx;
      let localDy = dy;
      if (handle && angle) {
        const pixelX = dx * stage.w;
        const pixelY = dy * stage.h;
        const cos = Math.cos(-angle);
        const sin = Math.sin(-angle);
        localDx = (pixelX * cos - pixelY * sin) / stage.w;
        localDy = (pixelX * sin + pixelY * cos) / stage.h;
      }
      const frame = handle ? resize(start.frame, handle, localDx, localDy) : move(start.frame, dx, dy);
      latest = textScalePatch(start.frame, frame, handle, box);
      onDraft(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) onCommit(latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className={["line", image ? "is-image" : "", selected ? "is-selected" : "", editing ? "is-editing" : "", empty ? "is-empty" : "", box.locked ? "is-locked" : "", box.positionLocked ? "is-position-locked" : ""]
        .filter(Boolean)
        .join(" ")}
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
        padding: image
          ? 0
          : `${stage.h * box.padTop}px ${stage.w * box.padRight}px ${stage.h * box.padBottom}px ${stage.w * box.padLeft}px`,
        justifyContent: justify,
        color: box.color,
        textAlign: box.align,
        transform: image
          ? `rotate(${box.rotation ?? 0}deg) scaleX(${box.flipX ? -1 : 1}) scaleY(${box.flipY ? -1 : 1})`
          : undefined,
      }}
      onPointerDown={gesture()}
      onContextMenu={(event) => {
        if (!editable || editing) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu?.(box.id, event.clientX, event.clientY);
      }}
      onDoubleClick={(event) => {
        if (!editable || image || box.locked) return;
        event.stopPropagation();
        onEdit?.(box.id);
      }}
    >
      {isImageBox(box) ? (
        <div
          className="line-art"
          role="img"
          aria-label={box.name}
          style={{ ...imageStyle(box, stage), opacity: box.opacity ?? 1, filter: imageTintFilter(box.tint) }}
        />
      ) : (
        <div
          ref={textRef}
          className="line-text"
          contentEditable={editable && editing && !box.locked}
          suppressContentEditableWarning
          role={editable ? "textbox" : undefined}
          aria-label={box.text || "Empty text box"}
          spellCheck={false}
          style={{
            fontFamily: `"${box.fontFamily}", Arial, sans-serif`,
            fontSize: `${stage.h * box.fontSize}px`,
            fontStyle: box.italic ? "oblique" : "normal",
          }}
          onInput={(event) => {
            const value = event.currentTarget.innerText.replace(/\n$/, "");
            onText?.(box.id, value);
          }}
          onBlur={() => onEdit?.(null)}
        />
      )}
      {editable && handles
        ? HANDLES.map((handle) => (
            <span
              key={handle}
              className={`handle handle-${handle}`}
              data-handle={handle}
              onPointerDown={gesture(handle)}
            />
          ))
        : null}
    </div>
  );
}


/** Map the current frame, fit, and source crop to a CSS background cover. */
function imageStyle(box: TextBox, stage: Stage): CSSProperties {
  if (!isImageBox(box)) return {};
  const frameW = box.w * stage.w;
  const frameH = box.h * stage.h;
  if (frameW <= 0 || frameH <= 0) return {};
  const left = box.cropLeft ?? 0;
  const right = box.cropRight ?? 0;
  const top = box.cropTop ?? 0;
  const bottom = box.cropBottom ?? 0;
  const sourceW = Math.max(0.1, 1 - left - right);
  const sourceH = Math.max(0.1, 1 - top - bottom);
  const sourceAspect = Math.max(0.1, box.aspect ?? 16 / 9) * (sourceW / sourceH);
  const frameAspect = frameW / frameH;
  const cover = box.fit !== "contain";
  let regionW: number;
  let regionH: number;
  if ((cover && sourceAspect >= frameAspect) || (!cover && sourceAspect < frameAspect)) {
    regionH = frameH;
    regionW = regionH * sourceAspect;
  } else {
    regionW = frameW;
    regionH = regionW / sourceAspect;
  }
  const imageW = regionW / sourceW;
  const imageH = regionH / sourceH;
  return {
    backgroundImage: `url("${box.src}")`,
    backgroundSize: `${imageW}px ${imageH}px`,
    backgroundPosition: `${(frameW - regionW) / 2 - left * imageW}px ${(frameH - regionH) / 2 - top * imageH}px`,
    backgroundRepeat: "no-repeat",
  };
}

/** Scale a text box's font with the dimension being resized, keeping images unchanged. */
function textScalePatch(start: Frame, frame: Frame, handle: Handle | undefined, box: TextBox): FramePatch {
  if (!handle || isImageBox(box)) return frame;
  const horizontal = handle.includes("e") || handle.includes("w");
  const vertical = handle.includes("n") || handle.includes("s");
  const scale = horizontal && vertical
    ? Math.min(frame.w / start.w, frame.h / start.h)
    : horizontal
      ? frame.w / start.w
      : frame.h / start.h;
  if (!Number.isFinite(scale) || scale <= 0) return frame;
  return {
    ...frame,
    fontSize: Math.min(1, Math.max(8 / SLIDE_POINTS, box.fontSize * scale)),
  };
}

function move(start: Frame, dx: number, dy: number): Frame {
  return fit({ ...start, x: start.x + dx, y: start.y + dy });
}

function resize(start: Frame, handle: Handle, dx: number, dy: number): Frame {
  let { x, y, w, h } = start;
  if (handle.includes("e")) w += dx;
  if (handle.includes("s")) h += dy;
  if (handle.includes("w")) {
    x += dx;
    w -= dx;
  }
  if (handle.includes("n")) {
    y += dy;
    h -= dy;
  }
  if (w < 0.04) {
    if (handle.includes("w")) x -= 0.04 - w;
    w = 0.04;
  }
  if (h < 0.03) {
    if (handle.includes("n")) y -= 0.03 - h;
    h = 0.03;
  }
  return fit({ x, y, w, h });
}

function fit(frame: Frame): Frame {
  const w = Math.min(1, Math.max(0.04, frame.w));
  const h = Math.min(1, Math.max(0.03, frame.h));
  const x = Math.min(Math.max(0, frame.x), 1 - w);
  const y = Math.min(Math.max(0, frame.y), 1 - h);
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}
