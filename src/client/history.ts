import { useCallback, useRef, useState } from "react";
import type { ClientMessage, RoomState, Slide } from "../shared/types";

const LIMIT = 80;

function editsDeck(message: ClientMessage): boolean {
  return (
    message.type !== "index" &&
    message.type !== "hold" &&
    message.type !== "autoplay" &&
    message.type !== "deckTiming" &&
    message.type !== "slideTiming" &&
    message.type !== "setDeck"
  );
}

export function useDeckHistory(state: RoomState | null, send: (message: ClientMessage) => void) {
  const undoStack = useRef<Slide[][]>([]);
  const redoStack = useRef<Slide[][]>([]);
  const present = useRef<Slide[] | null>(null);
  const batch = useRef(false);
  const typing = useRef<string | null>(null);
  const typingTimer = useRef(0);
  const fileId = useRef<string | null>(null);
  const [, setVersion] = useState(0);
  if (fileId.current !== (state?.fileId ?? null)) {
    fileId.current = state?.fileId ?? null;
    undoStack.current = [];
    redoStack.current = [];
  }
  present.current = state?.deck.slides ?? null;
  const refresh = () => setVersion((version) => version + 1);

  const tracked = useCallback(
    (message: ClientMessage) => {
      const slides = present.current;
      if (editsDeck(message) && slides) {
        const key = message.type === "text" ? `${message.slideId}:${message.boxId}` : null;
        const continuing = key !== null && key === typing.current;
        if (!continuing && !batch.current) {
          undoStack.current.push(structuredClone(slides));
          if (undoStack.current.length > LIMIT) undoStack.current.shift();
          redoStack.current = [];
          batch.current = true;
          queueMicrotask(() => {
            batch.current = false;
          });
          refresh();
        }
        if (key) {
          typing.current = key;
          window.clearTimeout(typingTimer.current);
          typingTimer.current = window.setTimeout(() => {
            typing.current = null;
          }, 700);
        } else {
          typing.current = null;
          window.clearTimeout(typingTimer.current);
        }
      }
      send(message);
    },
    [send],
  );

  const restore = useCallback(
    (slides: Slide[]) => {
      typing.current = null;
      window.clearTimeout(typingTimer.current);
      present.current = slides;
      send({ type: "setDeck", slides });
      refresh();
    },
    [send],
  );

  /** One undoable change for a whole-deck operation such as Tidy up. */
  const apply = useCallback(
    (slides: Slide[]) => {
      const current = present.current;
      if (!current) return;
      undoStack.current.push(structuredClone(current));
      if (undoStack.current.length > LIMIT) undoStack.current.shift();
      redoStack.current = [];
      typing.current = null;
      window.clearTimeout(typingTimer.current);
      present.current = slides;
      send({ type: "setDeck", slides });
      refresh();
    },
    [send],
  );

  const undo = useCallback(() => {
    const current = present.current;
    const slides = undoStack.current.pop();
    if (!slides || !current) return false;
    redoStack.current.push(structuredClone(current));
    restore(slides);
    return true;
  }, [restore]);

  const redo = useCallback(() => {
    const current = present.current;
    const slides = redoStack.current.pop();
    if (!slides || !current) return false;
    undoStack.current.push(structuredClone(current));
    restore(slides);
    return true;
  }, [restore]);

  return {
    send: tracked,
    apply,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}
