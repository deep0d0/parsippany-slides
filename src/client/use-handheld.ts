import { useEffect, useState } from "react";

const HANDHELD = "(max-width: 840px), (max-height: 520px)";

export function useHandheld() {
  const [matches, setMatches] = useState(() => window.matchMedia(HANDHELD).matches);

  useEffect(() => {
    const media = window.matchMedia(HANDHELD);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return matches;
}
