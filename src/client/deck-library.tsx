import { useCallback, useEffect, useState } from "react";
import type { SavedFile } from "../shared/types";

type Library = { current: string; files: SavedFile[] };

async function read(response: Response): Promise<Library & { error?: string }> {
  const data = (await response.json().catch(() => null)) as (Library & { error?: string }) | null;
  if (!response.ok) throw new Error(data?.error || "The deck library did not answer.");
  if (!data) throw new Error("The deck library did not answer.");
  return data;
}

export function DeckLibrary({
  open,
  currentId,
  onClose,
}: {
  open: boolean;
  currentId: string;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<SavedFile[]>([]);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError("");
    fetch("/api/files")
      .then(read)
      .then((data) => {
        if (live) setFiles(data.files);
      })
      .catch((caught) => {
        if (live) setError(caught instanceof Error ? caught.message : "Could not load the deck library.");
      });
    return () => {
      live = false;
    };
  }, [open, currentId, version]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  const openDeck = async (file: SavedFile) => {
    setBusy("Making that deck current");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/files/${file.id}/open`, { method: "POST" });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Could not open that deck.");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open that deck.");
    } finally {
      setBusy("");
    }
  };

  const archive = async (file: SavedFile, archived: boolean) => {
    setBusy(archived ? "Archiving" : "Restoring");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/files/${file.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Could not update that deck.");
      setNotice(archived ? "Deck archived." : "Deck restored.");
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update that deck.");
    } finally {
      setBusy("");
    }
  };

  const remove = async (file: SavedFile) => {
    setBusy("Deleting the deck");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Could not delete that deck.");
      setConfirmId(null);
      setNotice("Deck deleted.");
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete that deck.");
    } finally {
      setBusy("");
    }
  };

  if (!open) return null;
  const current = files.find((file) => file.id === currentId);
  const active = files.filter((file) => file.id !== currentId && !file.archived);
  const archived = files.filter((file) => file.archived);
  const row = (file: SavedFile) => {
    const live = file.id === currentId;
    return (
      <li key={file.id} className={live ? "deck-row is-live" : "deck-row"}>
        <div className="deck-row-main">
          <div className="deck-row-title">{file.title}</div>
          <div className="deck-row-meta">
            {file.slides} {file.slides === 1 ? "slide" : "slides"} · {when(file.updated)}
          </div>
        </div>
        <div className="deck-row-badges">
          {live ? <span className="flag">Live</span> : null}
          {file.archived ? <span className="flag is-muted">Archived</span> : null}
        </div>
        {live ? null : confirmId === file.id ? (
          <div className="deck-confirm">
            <span>Delete this deck and its images permanently?</span>
            <button type="button" className="tool is-danger" onClick={() => void remove(file)}>
              Delete
            </button>
            <button type="button" className="tool" onClick={() => setConfirmId(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="deck-row-actions">
            {file.archived ? (
              <button type="button" className="tool" onClick={() => void archive(file, false)}>
                Restore
              </button>
            ) : (
              <>
                <button type="button" className="tool" onClick={() => void openDeck(file)}>
                  Make current
                </button>
                <button type="button" className="tool" onClick={() => void archive(file, true)}>
                  Archive
                </button>
              </>
            )}
            <button type="button" className="tool is-danger" onClick={() => setConfirmId(file.id)}>
              Delete
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="sheet-back" role="presentation" onClick={onClose}>
      <div
        className="sheet deck-sheet"
        role="dialog"
        aria-labelledby="deck-library-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <h2 id="deck-library-title">Decks</h2>
            <p className="hint">The live deck is what the lobby and the sponsorship digest use.</p>
          </div>
          <button type="button" className="tool" onClick={onClose}>
            Close
          </button>
        </div>

        {error ? <p className="sheet-error">{error}</p> : null}
        {notice ? <p className="sheet-note">{notice}</p> : null}
        {busy ? <p className="sheet-note">{busy}…</p> : null}

        {current ? <ul className="library-list">{row(current)}</ul> : null}

        <section className="library-section">
          <h3>Other decks</h3>
          {active.length === 0 ? (
            <p className="hint">No other decks yet. Upload a PowerPoint from the File menu.</p>
          ) : (
            <ul className="library-list">{active.map(row)}</ul>
          )}
        </section>

        {archived.length > 0 ? (
          <section className="library-section">
            <h3>Archived</h3>
            <ul className="library-list">{archived.map(row)}</ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function when(value: number): string {
  const delta = Date.now() - value;
  if (delta < 60_000) return "Just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} min ago`;
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
