import { useEffect, useRef, useState } from "react";
import { DeckLibrary } from "./deck-library";
import { copyBytes } from "./media";
import { importPptx } from "./pptx";

export function FileMenu({ currentId }: { currentId: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const upload = async (file: File) => {
    setBusy("Reading PowerPoint");
    setError(null);
    try {
      const imported = await importPptx(file);
      setBusy("Saving the file");
      const created = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: imported.title }),
      });
      const made = (await created.json()) as { id?: string; error?: string };
      if (!created.ok || !made.id) throw new Error(made.error || "Could not save that file.");
      for (const item of imported.media) {
        const sent = await fetch(`/api/files/${made.id}/media/${item.name}`, {
          method: "PUT",
          headers: { "Content-Type": item.mime },
          body: copyBytes(item.bytes),
        });
        if (!sent.ok) {
          const data = (await sent.json()) as { error?: string };
          throw new Error(data.error || `Could not save ${item.name}.`);
        }
      }
      const slides = imported.slides.map((slide) => ({
        ...slide,
        background: slide.background ? `/api/media/${made.id}/${slide.background}` : null,
      }));
      const opened = await fetch(`/api/files/${made.id}/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: imported.title, slides, slidePoints: imported.slidePoints }),
      });
      const data = (await opened.json()) as { error?: string };
      if (!opened.ok) throw new Error(data.error || "Could not open the imported file.");
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import that PowerPoint file.");
    } finally {
      setBusy(null);
      if (pickerRef.current) pickerRef.current.value = "";
    }
  };

  return (
    <div className="file-nav" ref={rootRef}>
      <button
        type="button"
        className={open ? "tool is-on" : "tool"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        File
      </button>
      {open ? (
        <div className="menu file-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setError(null);
              setLibrary(true);
            }}
          >
            Open deck library…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              pickerRef.current?.click();
            }}
          >
            Upload PowerPoint…
          </button>
        </div>
      ) : null}
      <input
        ref={pickerRef}
        className="sr"
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void upload(file);
        }}
      />
      <DeckLibrary open={library} currentId={currentId} onClose={() => setLibrary(false)} />
      {busy ? (
        <div className="sheet-back" role="status">
          <p className="sheet-busy">{busy}</p>
        </div>
      ) : null}
      {error && !library ? <p className="file-toast">{error}</p> : null}
    </div>
  );
}
