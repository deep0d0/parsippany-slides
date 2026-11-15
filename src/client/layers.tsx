import { useRef, useState, type DragEvent } from "react";
import { isImageBox, type TextBox } from "../shared/types";

type LayersPanelProps = {
  boxes: TextBox[];
  selectedIds: string[];
  onSelect: (boxId: string, shift?: boolean) => void;
  onReorder: (boxId: string, toIndex: number) => void;
};

export function LayersPanel({ boxes, selectedIds, onSelect, onReorder }: LayersPanelProps) {
  const layers = [...boxes].reverse();
  const draggedRef = useRef<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);

  const moveLayer = (dragged: string, target: string, after: boolean) => {
    if (dragged === target) return;
    const display = [...boxes].reverse();
    const from = display.findIndex((box) => box.id === dragged);
    const targetIndex = display.findIndex((box) => box.id === target);
    if (from === -1 || targetIndex === -1) return;

    const next = display.filter((box) => box.id !== dragged);
    let insert = targetIndex + (after ? 1 : 0);
    if (from < insert) insert -= 1;
    insert = Math.max(0, Math.min(next.length, insert));
    next.splice(insert, 0, display[from]);

    const bottomToTop = next.reverse();
    const toIndex = bottomToTop.findIndex((box) => box.id === dragged);
    const originalIndex = boxes.length - 1 - from;
    if (toIndex !== -1 && toIndex !== originalIndex) onReorder(dragged, toIndex);
  };

  const dropAfter = (event: DragEvent<HTMLLIElement>): boolean => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  };

  return (
    <section className="layers" aria-label="Layers">
      <div className="layers-head">
        <h3>Layers</h3>
        <span className="layers-count">{boxes.length}</span>
      </div>
      {layers.length ? (
        <>
          <ol className="layer-list">
            {layers.map((box, index) => {
              const selected = selectedIds.includes(box.id);
              const name = layerName(box);
              const marked = drop?.id === box.id && draggedId !== box.id;
              return (
                <li
                  key={box.id}
                  className={[
                    "layer-row",
                    selected ? "is-selected" : "",
                    draggedId === box.id ? "is-dragging" : "",
                    marked && !drop?.after ? "is-drop-before" : "",
                    marked && drop?.after ? "is-drop-after" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={box.locked ? "Unlock this object before moving its layer." : undefined}
                  onDragStart={(event) => {
                    if (box.locked) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", box.id);
                    draggedRef.current = box.id;
                    setDraggedId(box.id);
                  }}
                  onDragOver={(event) => {
                    const source = draggedRef.current || draggedId || event.dataTransfer.getData("text/plain");
                    if (!source || source === box.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDrop({ id: box.id, after: dropAfter(event) });
                  }}
                  onDragLeave={(event) => {
                    const related = event.relatedTarget;
                    if (!(related instanceof Node) || !event.currentTarget.contains(related)) setDrop(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const source = draggedRef.current || draggedId || event.dataTransfer.getData("text/plain");
                    if (source) moveLayer(source, box.id, dropAfter(event));
                    draggedRef.current = null;
                    setDraggedId(null);
                    setDrop(null);
                  }}
                  onDragEnd={() => {
                    draggedRef.current = null;
                    setDraggedId(null);
                    setDrop(null);
                  }}
                >
                  <button
                    type="button"
                    className="layer-row-button"
                    draggable={!box.locked}
                    aria-current={selected ? "true" : undefined}
                    aria-label={`Layer ${index + 1}: ${name}${box.locked ? ", locked" : ""}`}
                    onClick={(event) => onSelect(box.id, event.shiftKey)}
                  >
                    <span className="layer-grip" aria-hidden="true">
                      ⋮⋮
                    </span>
                    <span className={isImageBox(box) ? "layer-kind is-image" : "layer-kind"} aria-hidden="true">
                      {isImageBox(box) ? <ImageIcon /> : "T"}
                    </span>
                    <span className="layer-name">{name}</span>
                    {box.locked ? (
                      <span className="layer-lock" title="Locked" aria-label="Locked">
                        <LockIcon />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="hint layers-hint">Drag a layer to move it in front or behind another.</p>
        </>
      ) : (
        <p className="hint layers-hint">No objects on this slide yet.</p>
      )}
    </section>
  );
}

function layerName(box: TextBox): string {
  const line = (isImageBox(box) ? box.name : box.text)
    .replace(/\s+/g, " ")
    .trim();
  return line || (isImageBox(box) ? "Image" : "Text");
}

function ImageIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
      <rect x="1.5" y="2" width="10" height="9" rx="1.5" fill="none" stroke="currentColor" />
      <path d="m2.5 9 2.6-3 2 2.2 1.2-1.3 2.2 2.6" fill="none" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.5" y="5.2" width="7" height="5.3" rx="1" fill="none" stroke="currentColor" />
      <path d="M4 5.2V3.9a2 2 0 0 1 4 0v1.3" fill="none" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}
