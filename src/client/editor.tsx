import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_ADVANCE_SECONDS,
  MAX_ADVANCE_SECONDS,
  MIN_ADVANCE_SECONDS,
  isImageBox,
  isSponsorSlide,
  slideLabel,
  visibleSlides,
  type BoxPatch,
  type ImageFit,
  type TextBox,
} from "../shared/types";
import { alignFrames, distributeFrames, type AlignEdge, type AlignTarget, type DistributeAxis } from "./align";
import { fitBox, type FitMode } from "./fit-text";
import { ContextMenu, type MenuItem } from "./context-menu";
import { FileMenu } from "./file-menu";
import { FormatBar } from "./format-bar";
import { useDeckHistory } from "./history";
import { duplicateSlide, imageBox, nativeImageFrame, newId, textBox } from "./ids";
import { saveImage } from "./media";
import { SlideView } from "./slide-view";
import { TelegramPanel } from "./telegram-panel";
import { TidyPanel } from "./tidy-panel";
import { useRoom, type ConnectionStatus } from "./use-room";

type OpenMenu =
  | { kind: "slide"; slideId: string; x: number; y: number }
  | { kind: "box"; boxId: string; x: number; y: number };

export function Editor() {
  const { state, status, send: publish } = useRoom("edit");
  const { send, apply: applySlides, undo, redo, canUndo, canRedo } = useDeckHistory(state, publish);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [pendingImage, setPendingImage] = useState<{ src: string; aspect: number } | null>(null);
  const [imageBusy, setImageBusy] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [tidyOpen, setTidyOpen] = useState(false);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const lineField = useRef<HTMLTextAreaElement>(null);
  const imagePickerRef = useRef<HTMLInputElement>(null);
  const openFileId = useRef<string | null>(null);
  const clipboard = useRef<TextBox[]>([]);
  const slide = state
    ? (state.deck.slides.find((item) => item.id === selectedSlideId) ?? state.deck.slides[0])
    : undefined;
  const primaryId = selectedIds[selectedIds.length - 1] ?? null;
  const box = slide?.boxes.find((item) => item.id === primaryId) ?? null;
  const selectedImage = box ? isImageBox(box) : false;
  const sponsorTagged = slide ? isSponsorSlide(slide) : false;

  useEffect(() => {
    document.title = state ? state.deck.title : "Slides";
    void document.fonts.load('16px "Visby CF Heavy"');
    void document.fonts.load('16px "Visby CF Extra Bold"');
  }, [state]);

  useEffect(() => {
    const field = lineField.current;
    if (!field) return;
    if (!box || isImageBox(box)) {
      field.value = "";
      delete field.dataset.box;
      return;
    }
    const fromHistory = historyEpoch !== Number(field.dataset.epoch ?? 0);
    if (document.activeElement === field && field.dataset.box === box.id && !fromHistory) return;
    field.value = box.text;
    field.dataset.box = box.id;
    field.dataset.epoch = String(historyEpoch);
  }, [box, historyEpoch, slide?.id]);

  useEffect(() => {
    if (!state) return;
    if (openFileId.current !== state.fileId) {
      openFileId.current = state.fileId;
      const current = visibleSlides(state.deck)[state.index] ?? state.deck.slides[0];
      setSelectedSlideId(current?.id ?? null);
      setSelectedIds([]);
      setEditingId(null);
      clipboard.current = [];
      return;
    }
    if (!selectedSlideId) {
      const current = visibleSlides(state.deck)[state.index];
      setSelectedSlideId(current?.id ?? state.deck.slides[0]?.id ?? null);
      return;
    }
    if (state.deck.slides.some((item) => item.id === selectedSlideId)) return;
    setSelectedSlideId(state.deck.slides[0]?.id ?? null);
    setSelectedIds([]);
    setEditingId(null);
  }, [selectedSlideId, state]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";
      if (event.key === "Escape") {
        setEditingId(null);
        setSelectedIds([]);
        setMenu(null);
        setPendingImage(null);
        setImageError(null);
      }
      if ((event.key === "Backspace" || event.key === "Delete") && !typing && selectedIds.length && slide) {
        event.preventDefault();
        for (const boxId of selectedIds) send({ type: "deleteBox", slideId: slide.id, boxId });
        setSelectedIds([]);
        setEditingId(null);
      }
      const accel = (event.metaKey || event.ctrlKey) && !event.altKey;
      if (!typing && accel && event.code === "KeyC" && slide) {
        const chosen = slide.boxes.filter((item) => selectedIds.includes(item.id));
        if (chosen.length) {
          event.preventDefault();
          clipboard.current = structuredClone(chosen);
        }
      }
      if (!typing && accel && event.code === "KeyV" && slide && clipboard.current.length) {
        event.preventDefault();
        const pasted = clipboard.current.map((item) => {
          const copy = { ...structuredClone(item), id: newId("b") };
          if (!event.shiftKey) {
            copy.x = Math.min(item.x + 0.03, Math.max(0, 1 - item.w));
            copy.y = Math.min(item.y + 0.03, Math.max(0, 1 - item.h));
          }
          return copy;
        });
        for (const item of pasted) send({ type: "addBox", slideId: slide.id, box: item });
        setSelectedIds(pasted.map((item) => item.id));
        setEditingId(null);
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.code === "KeyZ" || event.code === "KeyY")) {
        event.preventDefault();
        const applied = event.code === "KeyY" || event.shiftKey ? redo() : undo();
        if (!applied) return;
        setEditingId(null);
        setHistoryEpoch((epoch) => epoch + 1);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && slide) {
        event.preventDefault();
        const created = duplicateSlide(slide);
        send({ type: "insertSlide", afterId: slide.id, slide: created });
        setSelectedSlideId(created.id);
        setSelectedIds([]);
        setEditingId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redo, selectedIds, send, slide, undo]);

  if (!state || !slide) {
    return (
      <main className="editor">
        <p className="waiting">Opening the deck</p>
      </main>
    );
  }
  const screen = visibleSlides(state.hold && state.heldDeck ? state.heldDeck : state.deck);
  const screenIndex = state.hold && state.heldDeck ? state.heldIndex : state.index;
  const onScreenId = screen[screenIndex]?.id;
  const visibleIndex = slide ? visibleSlides(state.deck).findIndex((item) => item.id === slide.id) : -1;
  const origin = window.location.origin;
  const patchBox = (patch: BoxPatch) => {
    for (const boxId of selectedIds) send({ type: "updateBox", slideId: slide.id, boxId, patch });
  };
  const align = (edge: AlignEdge, target: AlignTarget) => {
    const chosen = slide.boxes.filter((item) => selectedIds.includes(item.id));
    for (const frame of alignFrames(chosen, target, edge)) {
      send({ type: "updateBox", slideId: slide.id, boxId: frame.id, patch: { x: frame.x, y: frame.y } });
    }
  };
  const distribute = (axis: DistributeAxis, target: AlignTarget) => {
    const chosen = slide.boxes.filter((item) => selectedIds.includes(item.id));
    for (const frame of distributeFrames(chosen, target, axis)) {
      send({ type: "updateBox", slideId: slide.id, boxId: frame.id, patch: { x: frame.x, y: frame.y } });
    }
  };
  const fit = async (mode: FitMode) => {
    const stage = document.querySelector(".canvas .slide");
    if (!stage) return;
    const size = { w: stage.clientWidth, h: stage.clientHeight };
    const chosen = slide.boxes.filter((item) => selectedIds.includes(item.id));
    const patches: Array<{ boxId: string; patch: BoxPatch }> = [];
    for (const item of chosen) {
      const patch = await fitBox(item, size, mode);
      if (patch) patches.push({ boxId: item.id, patch });
    }
    for (const item of patches) send({ type: "updateBox", slideId: slide.id, boxId: item.boxId, patch: item.patch });
  };
  const insert = (created: ReturnType<typeof duplicateSlide>, boxId: string | null) => {
    send({ type: "insertSlide", afterId: slide.id, slide: created });
    setSelectedSlideId(created.id);
    setSelectedIds(boxId ? [boxId] : []);
    setEditingId(boxId);
  };
  const removeSlide = (slideId: string) => {
    if (state.deck.slides.length <= 1) return;
    const index = state.deck.slides.findIndex((item) => item.id === slideId);
    const neighbor = state.deck.slides[index + 1] ?? state.deck.slides[index - 1];
    send({ type: "deleteSlide", slideId });
    setSelectedSlideId(neighbor?.id ?? null);
    setSelectedIds([]);
    setEditingId(null);
  };
  const copySlide = (slideId: string) => {
    const source = state.deck.slides.find((item) => item.id === slideId);
    if (!source) return;
    const created = duplicateSlide(source);
    send({ type: "insertSlide", afterId: source.id, slide: created });
    setSelectedSlideId(created.id);
    setSelectedIds([]);
    setEditingId(null);
  };
  const copyBox = (source: TextBox) => {
    const { id: _ignored, ...rest } = source;
    const created = isImageBox(source)
      ? imageBox(source.src, source.aspect ?? 16 / 9, source.fit)
      : textBox({
          ...rest,
          x: Math.min(source.x + 0.03, Math.max(0, 1 - source.w)),
          y: Math.min(source.y + 0.03, Math.max(0, 1 - source.h)),
        });
    if (isImageBox(created)) {
      created.x = Math.min(source.x + 0.03, Math.max(0, 1 - source.w));
      created.y = Math.min(source.y + 0.03, Math.max(0, 1 - source.h));
      created.w = source.w;
      created.h = source.h;
    }
    send({ type: "addBox", slideId: slide.id, box: created });
    setSelectedIds([created.id]);
    setEditingId(null);
  };
  const placeImage = (fit: ImageFit) => {
    if (!pendingImage) return;
    const created = imageBox(pendingImage.src, pendingImage.aspect, fit);
    send({ type: "addBox", slideId: slide.id, box: created });
    setSelectedIds([created.id]);
    setEditingId(null);
    setPendingImage(null);
  };
  const applyImageFit = (fit: ImageFit) => {
    const chosen = slide.boxes.filter((item) => selectedIds.includes(item.id) && isImageBox(item));
    for (const item of chosen) {
      const frame = fit === "cover" ? { x: 0, y: 0, w: 1, h: 1 } : nativeImageFrame(item.aspect ?? 16 / 9);
      send({ type: "updateBox", slideId: slide.id, boxId: item.id, patch: { fit, ...frame } });
    }
  };
  const pickImage = async (file: File) => {
    setImageBusy("Saving the image");
    setImageError(null);
    try {
      const saved = await saveImage(state.fileId, file);
      setPendingImage(saved);
    } catch (caught) {
      setImageError(caught instanceof Error ? caught.message : "Could not add that image.");
    } finally {
      setImageBusy(null);
      if (imagePickerRef.current) imagePickerRef.current.value = "";
    }
  };
  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    if (menu.kind === "slide") {
      const target = state.deck.slides.find((item) => item.id === menu.slideId) ?? slide;
      return [
        { label: "Duplicate", onSelect: () => copySlide(target.id) },
        {
          label: target.hidden ? "Enable" : "Disable",
          onSelect: () => send({ type: "visibility", slideId: target.id, hidden: !target.hidden }),
        },
        {
          label: "Delete",
          danger: true,
          disabled: state.deck.slides.length <= 1,
          onSelect: () => removeSlide(target.id),
        },
      ];
    }
    const target = slide.boxes.find((item) => item.id === menu.boxId) ?? box;
    const ids = target && selectedIds.includes(target.id) ? selectedIds : target ? [target.id] : [];
    const image = target && isImageBox(target);
    return [
      { label: "Duplicate", disabled: !target, onSelect: () => target && copyBox(target) },
      ...(image
        ? [
            { label: "Scale to slide", onSelect: () => applyImageFit("cover") },
            { label: "Keep proportions", onSelect: () => applyImageFit("contain") },
          ]
        : []),
      {
        label: ids.length > 1 ? "Delete boxes" : "Delete",
        danger: true,
        disabled: ids.length === 0,
        onSelect: () => {
          for (const boxId of ids) send({ type: "deleteBox", slideId: slide.id, boxId });
          setSelectedIds([]);
          setEditingId(null);
        },
      },
    ];
  };

  return (
    <div className="editor">
      <header className="topbar">
        <FileMenu currentId={state.fileId} />
        <div className="brand">
          <span className="brand-name">Slides</span>
          <h1>{state.deck.title}</h1>
        </div>
        <div className="history" role="group" aria-label="History">
          <button
            type="button"
            className="tool"
            aria-label="Undo"
            title="Undo"
            disabled={!canUndo}
            onClick={() => {
              if (!undo()) return;
              setEditingId(null);
              setHistoryEpoch((epoch) => epoch + 1);
            }}
          >
            <HistoryIcon direction="undo" />
            Undo
          </button>
          <button
            type="button"
            className="tool"
            aria-label="Redo"
            title="Redo"
            disabled={!canRedo}
            onClick={() => {
              if (!redo()) return;
              setEditingId(null);
              setHistoryEpoch((epoch) => epoch + 1);
            }}
          >
            <HistoryIcon direction="redo" />
            Redo
          </button>
        </div>
        <div className="top-actions">
          <button type="button" className="tool" onClick={() => setTidyOpen(true)}>
            Tidy up
          </button>
          <button type="button" className="tool" onClick={() => setTelegramOpen(true)}>
            Digest
          </button>
        </div>
        <Status status={status} hold={state.hold} />
        <nav className="top-links">
          <a href="/remote" target="_blank" rel="noreferrer">
            Remote
          </a>
          <a href="/play" target="_blank" rel="noreferrer">
            Play
          </a>
        </nav>
      </header>
      <FormatBar
        box={box}
        slidePoints={state.deck.slidePoints}
        selectionCount={selectedIds.length}
        onNewSlide={() => {
          const createdBox = textBox();
          insert(
            {
              id: newId("s"),
              hidden: false,
              background: null,
              boxes: [createdBox],
            },
            createdBox.id,
          );
        }}
        onAddBox={() => {
          const created = textBox();
          send({ type: "addBox", slideId: slide.id, box: created });
          setSelectedIds([created.id]);
          setEditingId(created.id);
        }}
        onAddImage={() => imagePickerRef.current?.click()}
        onPatch={patchBox}
        onAlign={align}
        onDistribute={distribute}
        onFit={(mode) => void fit(mode)}
        onImageFit={applyImageFit}
      />
      <input
        ref={imagePickerRef}
        className="sr"
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void pickImage(file);
        }}
      />

      <div className="workspace">
        <aside className="rail" aria-label="Slides">
          {state.deck.slides.map((item, index) => {
            const onScreen = item.id === onScreenId;
            const selected = item.id === slide?.id;
            return (
              <button
                key={item.id}
                type="button"
                className={["thumb", selected ? "is-selected" : "", item.hidden ? "is-hidden" : ""]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={onScreen ? "true" : undefined}
                aria-label={`Slide ${index + 1}. ${slideLabel(item, index + 1)}${item.hidden ? ". Hidden" : ""}${onScreen ? ". On screen" : ""}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", item.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const slideId = event.dataTransfer.getData("text/plain");
                  if (!slideId || slideId === item.id) return;
                  send({ type: "moveSlide", slideId, toIndex: index });
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelectedSlideId(item.id);
                  setSelectedIds([]);
                  setEditingId(null);
                  setMenu({ kind: "slide", slideId: item.id, x: event.clientX, y: event.clientY });
                }}
                onClick={() => {
                  setSelectedSlideId(item.id);
                  setSelectedIds([]);
                  setEditingId(null);
                }}
              >
                <span className="thumb-frame">
                  <SlideView slide={item} />
                </span>
                <span className="thumb-meta">
                  <span>{index + 1}</span>
                  {isSponsorSlide(item) ? <span className="flag">Sponsor</span> : null}
                  {onScreen ? <span className="flag">Screen</span> : null}
                  {item.hidden ? <span className="flag is-muted">Hidden</span> : null}
                </span>
              </button>
            );
          })}
        </aside>

        <main className="canvas">
          {slide ? (
            <div className="stage-wrap">
              <SlideView
                slide={slide}
                editable
                selectedIds={selectedIds}
                editingId={editingId}
                onSelect={(id, shift) => {
                  if (!id) {
                    setSelectedIds([]);
                    setEditingId(null);
                    return;
                  }
                  setSelectedIds((current) => {
                    if (!shift) return [id];
                    return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
                  });
                  if (!shift && id !== editingId) setEditingId(null);
                }}
                onContextMenu={(boxId, x, y) => {
                  if (!boxId) {
                    setMenu({ kind: "slide", slideId: slide.id, x, y });
                    return;
                  }
                  setSelectedIds((current) => (current.includes(boxId) ? current : [boxId]));
                  if (boxId !== editingId) setEditingId(null);
                  setMenu({ kind: "box", boxId, x, y });
                }}
                onEdit={setEditingId}
                onText={(boxId, text) => send({ type: "text", slideId: slide.id, boxId, text })}
                onFrame={(boxId, frame) =>
                  send({ type: "updateBox", slideId: slide.id, boxId, patch: frame })
                }
              />
            </div>
          ) : null}
        </main>

        <aside className="inspector" aria-label="Slide">
          {slide ? (
            <>
              <p className="inspector-kicker">
                Slide {state.deck.slides.findIndex((item) => item.id === slide.id) + 1}
              </p>
              {slide.boxes.some((item) => !isImageBox(item) && item.text.trim()) ? (
                <h2>{slide.boxes.map((item) => (isImageBox(item) ? "" : item.text.trim())).find(Boolean)?.split("\n")[0]}</h2>
              ) : null}

              <button
                type="button"
                className="fill-button"
                disabled={slide.hidden || slide.id === onScreenId}
                onClick={() => send({ type: "index", index: visibleIndex })}
              >
                {slide.id === onScreenId ? "On screen" : "Show this slide"}
              </button>

              <div className="sponsor-control">
                <button
                  type="button"
                  className={sponsorTagged ? "switch is-on" : "switch"}
                  aria-pressed={sponsorTagged}
                  onClick={() => send({ type: "sponsor", slideId: slide.id, sponsor: !sponsorTagged })}
                >
                  <span className="switch-track">
                    <span className="switch-knob" />
                  </span>
                  <span>Sponsor slide</span>
                </button>
                {slide.sponsor !== undefined ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => send({ type: "sponsor", slideId: slide.id, sponsor: null })}
                  >
                    Use automatic tag
                  </button>
                ) : null}
              </div>
              <p className="hint">
                {slide.sponsor !== undefined
                  ? slide.sponsor
                    ? "Always included in the sponsorship digest."
                    : "Kept out of the sponsorship digest."
                  : sponsorTagged
                    ? "Tagged automatically because the slide text mentions sponsor."
                    : "Not tagged automatically. Turn this on to include it."}
              </p>

              <label className="field">
                <span>{selectedImage ? "Image" : box ? "Selected line" : "Line"}</span>
                <textarea
                  ref={lineField}
                  rows={4}
                  disabled={!box || selectedImage}
                  placeholder={
                    selectedImage
                      ? "Scale to slide fills the slide. Keep proportions leaves the photo uncropped."
                      : box
                        ? ""
                        : "Select a line on the slide"
                  }
                  defaultValue={box && !selectedImage ? box.text : ""}
                  onInput={(event) => {
                    if (!box || selectedImage) return;
                    send({
                      type: "text",
                      slideId: slide.id,
                      boxId: box.id,
                      text: event.currentTarget.value,
                    });
                  }}
                />
              </label>
              <p className="hint">
                New slide starts blank. Add a text box or an image, then right-click to duplicate or delete.
                Ctrl+C copies the selection and Ctrl+Shift+V pastes it in place (⌘ on a Mac).
              </p>
              {box && !isImageBox(box) ? <p className="font-note">{box.fontFamily}</p> : null}

              <SecondsField
                label="Auto-advance"
                value={slide.advanceSeconds ?? null}
                placeholder={`Deck default (${state.deck.advanceSeconds ?? DEFAULT_ADVANCE_SECONDS}s)`}
                onCommit={(seconds) => send({ type: "slideTiming", slideId: slide.id, seconds })}
              />
              <SecondsField
                label="Deck default"
                value={state.deck.advanceSeconds ?? DEFAULT_ADVANCE_SECONDS}
                placeholder={`${DEFAULT_ADVANCE_SECONDS}s`}
                onCommit={(seconds) => {
                  if (seconds !== null) send({ type: "deckTiming", seconds });
                }}
              />
              <p className="hint">
                Auto-advance uses this slide's seconds when set, otherwise the deck default. Turn Auto on from
                the remote.
              </p>

              <label className="field">
                <span>Play link</span>
                <input readOnly value={`${origin}/play`} onFocus={(event) => event.currentTarget.select()} />
              </label>
              <label className="field">
                <span>Remote link</span>
                <input readOnly value={`${origin}/remote`} onFocus={(event) => event.currentTarget.select()} />
              </label>
            </>
          ) : null}
        </aside>
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} /> : null}
      {tidyOpen ? (
        <TidyPanel
          slides={state.deck.slides}
          slidePoints={state.deck.slidePoints}
          currentSlideId={slide.id}
          onApply={applySlides}
          onClose={() => setTidyOpen(false)}
        />
      ) : null}
      {telegramOpen ? <TelegramPanel onClose={() => setTelegramOpen(false)} /> : null}
      {pendingImage ? (
        <div className="sheet-back" role="presentation" onClick={() => setPendingImage(null)}>
          <div className="sheet" role="dialog" aria-labelledby="place-image-title" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-head">
              <h2 id="place-image-title">Place image</h2>
              <button type="button" className="tool" onClick={() => setPendingImage(null)}>
                Cancel
              </button>
            </div>
            <div className="place-actions">
              <button type="button" className="fill-button" onClick={() => placeImage("cover")}>
                Scale to slide
              </button>
              <button type="button" className="tool place-secondary" onClick={() => placeImage("contain")}>
                Keep proportions
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {imageBusy ? (
        <div className="sheet-back" role="status">
          <p className="sheet-busy">{imageBusy}</p>
        </div>
      ) : null}
      {imageError ? <p className="file-toast image-toast">{imageError}</p> : null}
    </div>
  );
}

function SecondsField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: number | null;
  placeholder: string;
  onCommit: (seconds: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(value === null ? "" : String(value));
  }, [value]);

  const commit = () => {
    editing.current = false;
    const trimmed = text.trim();
    if (!trimmed) {
      setText(value === null ? "" : String(value));
      onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setText(value === null ? "" : String(value));
      return;
    }
    const seconds = Math.min(MAX_ADVANCE_SECONDS, Math.max(MIN_ADVANCE_SECONDS, Math.round(parsed)));
    setText(String(seconds));
    onCommit(seconds);
  };

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={MIN_ADVANCE_SECONDS}
        max={MAX_ADVANCE_SECONDS}
        step={1}
        value={text}
        placeholder={placeholder}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(event) => setText(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function HistoryIcon({ direction }: { direction: "undo" | "redo" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={direction === "redo" ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M3.5 6.5h7a2.5 2.5 0 0 1 0 5H8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 3.8 3.5 6.5 6 9.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Status({ status, hold }: { status: ConnectionStatus; hold: boolean }) {
  const label =
    status === "live" ? (hold ? "Screen held" : "Live") : status === "reconnecting" ? "Reconnecting" : "Connecting";
  const tone = status !== "live" ? "wait" : hold ? "held" : "live";
  return (
    <p className={`status is-${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </p>
  );
}
