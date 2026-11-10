import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isImageBox, type TextBox } from "../shared/types";
import type { Slide } from "../shared/types";

type Stage = { w: number; h: number };
type Frame = Pick<TextBox, "x" | "y" | "w" | "h">;
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
  onFrame?: (boxId: string, frame: Frame) => void;
  onContextMenu?: (boxId: string, x: number, y: number) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>({ w: 0, h: 0 });
  const [draft, setDraft] = useState<{ id: string; frame: Frame } | null>(null);

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
        <img className="slide-art" src={slide.background} alt="" draggable={false} decoding="async" />
      ) : null}
      {stage.h > 0
        ? orderedBoxes(slide.boxes).map((box) => {
            const shown = draft?.id === box.id ? { ...box, ...draft.frame } : box;
            return (
              <Line
                key={box.id}
                box={shown}
                stage={stage}
                editable={editable}
                selected={selectedIds.includes(box.id)}
                handles={selectedIds[selectedIds.length - 1] === box.id}
                editing={editingId === box.id && !isImageBox(box)}
                onSelect={onSelect}
                onEdit={onEdit}
                onText={onText}
                onContextMenu={onContextMenu}
                onDraft={(frame) => setDraft({ id: box.id, frame })}
                onCommit={(frame) => {
                  setDraft(null);
                  onFrame?.(box.id, frame);
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
  onDraft: (frame: Frame) => void;
  onCommit: (frame: Frame) => void;
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
    if (handle || image) onEdit?.(null);
    else if (editing) return;

    const start = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      frame: { x: box.x, y: box.y, w: box.w, h: box.h },
    };
    let latest = start.frame;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.pointerX) / stage.w;
      const dy = (ev.clientY - start.pointerY) / stage.h;
      if (!moved && Math.hypot(ev.clientX - start.pointerX, ev.clientY - start.pointerY) < 3) return;
      moved = true;
      latest = handle ? resize(start.frame, handle, dx, dy) : move(start.frame, dx, dy);
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
      className={["line", image ? "is-image" : "", selected ? "is-selected" : "", editing ? "is-editing" : "", empty ? "is-empty" : ""]
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
      }}
      onPointerDown={gesture()}
      onContextMenu={(event) => {
        if (!editable || editing) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu?.(box.id, event.clientX, event.clientY);
      }}
      onDoubleClick={(event) => {
        if (!editable || image) return;
        event.stopPropagation();
        onEdit?.(box.id);
      }}
    >
      {image ? (
        <img
          className="line-art"
          src={box.src}
          alt=""
          draggable={false}
          decoding="async"
          style={{ objectFit: box.fit }}
        />
      ) : (
        <div
          ref={textRef}
          className="line-text"
          contentEditable={editable && editing}
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

function orderedBoxes(boxes: TextBox[]): TextBox[] {
  return [...boxes.filter(isImageBox), ...boxes.filter((box) => !isImageBox(box))];
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
