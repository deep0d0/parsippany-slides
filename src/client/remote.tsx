import { useEffect } from "react";
import { ShowControls } from "./show-controls";
import { useRoom } from "./use-room";

export function Remote() {
  const { state, status, send } = useRoom("remote");

  useEffect(() => {
    document.title = "Show";
  }, []);

  return <ShowControls state={state} status={status} send={send} />;
}
