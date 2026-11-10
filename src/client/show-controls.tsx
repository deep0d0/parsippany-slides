import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { slideLabel, visibleSlides, type ClientMessage, type RoomState } from "../shared/types";
import { PlayStage } from "./play-stage";
import { SlideView } from "./slide-view";
import type { ConnectionStatus } from "./use-room";

export function ShowControls({
  state,
  status,
  send,
  fontsReady = true,
}: {
  state: RoomState | null;
  status: ConnectionStatus;
  send: (message: ClientMessage) => void;
  fontsReady?: boolean;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const totalRef = useRef(0);

  const screenDeck = state?.hold && state.heldDeck ? state.heldDeck : state?.deck;
  const screenIndex = state?.hold && state.heldDeck ? state.heldIndex : (state?.index ?? 0);
  const liveSlides = state ? visibleSlides(state.deck) : [];
  const screenSlides = screenDeck ? visibleSlides(screenDeck) : [];
  const onScreen = screenSlides[screenIndex];
  indexRef.current = state?.index ?? 0;
  totalRef.current = liveSlides.length;
  const atStart = !state || indexRef.current <= 0;
  const atEnd = !state || indexRef.current >= liveSlides.length - 1;

  const go = (delta: number) => {
    const next = indexRef.current + delta;
    if (next < 0 || next >= totalRef.current) return;
    indexRef.current = next;
    send({ type: "index", index: next });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  useEffect(() => {
    const strip = stripRef.current;
    const current = strip?.querySelector<HTMLElement>(".is-current");
    if (!strip || !current) return;
    const left = current.offsetLeft - (strip.clientWidth - current.clientWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left) });
  }, [screenIndex, state?.deck]);

  if (!state || !screenDeck) {
    return (
      <main className="deck-remote">
        <p className="waiting">Opening the show</p>
      </main>
    );
  }

  const deckNumber = onScreen ? state.deck.slides.findIndex((item) => item.id === onScreen.id) + 1 : 0;
  const label = onScreen ? slideLabel(onScreen, deckNumber) : "Nothing on screen";

  const onStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const onUp = (up: PointerEvent) => {
      window.removeEventListener("pointerup", onUp);
      const dx = up.clientX - startX;
      const dy = up.clientY - startY;
      if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy)) {
        go(dx < 0 ? 1 : -1);
        return;
      }
      if (Math.hypot(dx, dy) > 12) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      go(up.clientX - bounds.left > bounds.width / 2 ? 1 : -1);
    };
    window.addEventListener("pointerup", onUp);
  };

  return (
    <main className={state.hold ? "deck-remote is-held" : "deck-remote"}>
      <header className="deck-head">
        <Status status={status} hold={state.hold} />
        <div className="deck-switches">
          <button
            type="button"
            className={state.autoplay ? "hold is-on" : "hold"}
            role="switch"
            aria-checked={state.autoplay}
            title="Advance slides on the timer set in the editor"
            onClick={() => send({ type: "autoplay", autoplay: !state.autoplay })}
          >
            Auto
            <span className="switch-track" aria-hidden="true">
              <span className="switch-knob" />
            </span>
          </button>
          <button
            type="button"
            className={state.hold ? "hold is-on" : "hold"}
            role="switch"
            aria-checked={state.hold}
            onClick={() => send({ type: "hold", hold: !state.hold })}
          >
            Hold
            <span className="switch-track" aria-hidden="true">
              <span className="switch-knob" />
            </span>
          </button>
        </div>
      </header>

      <div
        className={fontsReady ? "deck-stage is-ready" : "deck-stage"}
        onPointerDown={onStagePointerDown}
      >
        {onScreen ? <PlayStage slides={screenSlides} index={screenIndex} /> : <p className="deck-empty">No slides in the show</p>}
      </div>

      <div className="deck-caption">
        <p className="deck-count">
          {liveSlides.length === 0 ? "0" : screenIndex + 1} of {liveSlides.length}
        </p>
        <p className="deck-title">{label}</p>
        {state.hold ? <p className="deck-note">Lobby stays on this slide until you release Hold.</p> : null}
      </div>

      <div className="deck-strip" ref={stripRef} role="group" aria-label="Slides">
        {liveSlides.map((slide, index) => {
          const number = state.deck.slides.findIndex((item) => item.id === slide.id) + 1;
          const current = index === screenIndex;
          return (
            <button
              key={slide.id}
              type="button"
              className={current ? "is-current" : ""}
              aria-current={current ? "true" : undefined}
              aria-label={`Show slide ${number}, ${slideLabel(slide, number)}`}
              onClick={() => send({ type: "index", index })}
            >
              <SlideView slide={slide} />
              <span className="deck-num">{number}</span>
            </button>
          );
        })}
      </div>

      <div className="deck-bar">
        <button type="button" disabled={atStart} onClick={() => go(-1)}>
          Previous
        </button>
        <button type="button" className="is-next" disabled={atEnd} onClick={() => go(1)}>
          Next
        </button>
      </div>
    </main>
  );
}

function Status({ status, hold }: { status: ConnectionStatus; hold: boolean }) {
  const label = status === "live" ? (hold ? "Held" : "Live") : status === "reconnecting" ? "Reconnecting" : "Connecting";
  const tone = status !== "live" ? "wait" : hold ? "held" : "live";
  return (
    <p className={`status is-${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </p>
  );
}
