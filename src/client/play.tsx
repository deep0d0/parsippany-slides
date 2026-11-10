import { useEffect, useState } from "react";
import { visibleSlides } from "../shared/types";
import { PlayStage } from "./play-stage";
import { ShowControls } from "./show-controls";
import { useRoom } from "./use-room";
import { useHandheld } from "./use-handheld";

export function Play() {
  const { state, status, send } = useRoom("play");
  const handheld = useHandheld();
  const [fontsReady, setFontsReady] = useState(false);

  const deck = state?.hold && state.heldDeck ? state.heldDeck : state?.deck;
  const index = state?.hold && state.heldDeck ? state.heldIndex : (state?.index ?? 0);
  const slides = deck ? visibleSlides(deck) : [];

  useEffect(() => {
    document.title = handheld ? "Show" : "Sponsorships";
    if (handheld) {
      delete document.body.dataset.view;
      return;
    }
    document.body.dataset.view = "play";
    return () => {
      delete document.body.dataset.view;
    };
  }, [handheld]);

  useEffect(() => {
    let cancel = false;
    void Promise.all([
      document.fonts.load('16px "Visby CF Heavy"'),
      document.fonts.load('16px "Visby CF Extra Bold"'),
      document.fonts.ready,
    ]).then(() => {
      if (!cancel) setFontsReady(true);
    });
    return () => {
      cancel = true;
    };
  }, []);

  if (handheld) return <ShowControls state={state} status={status} send={send} fontsReady={fontsReady} />;

  return (
    <div className="play">
      {slides.length ? (
        <div className={fontsReady ? "play-frame is-ready" : "play-frame"}>
          <PlayStage slides={slides} index={index} />
        </div>
      ) : state ? (
        <p className="play-empty">No slides in the show</p>
      ) : null}
      {status !== "live" && state ? <p className="play-status">Reconnecting</p> : null}
    </div>
  );
}
