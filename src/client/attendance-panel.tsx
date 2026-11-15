import { ATTENDANCE_TITLE_ID } from "../shared/attendance";
import type { Slide } from "../shared/types";

export function AttendancePanel({
  slide,
  busy,
  note,
  error,
  onUpload,
}: {
  slide: Slide;
  busy: string | null;
  note: string | null;
  error: string | null;
  onUpload: () => void;
}) {
  const hasLayout = slide.boxes.some((box) => box.id === ATTENDANCE_TITLE_ID);

  return (
    <div className="attendance-controls">
      <div className="image-controls-head">
        <h3>Attendance slide</h3>
        <span className="flag">Persistent</span>
      </div>
      <p className="hint">
        Paste the weekly flyer anywhere on the slide, or upload it here. The QR code is read and rebuilt cleanly.
      </p>
      <button type="button" className="fill-button" disabled={Boolean(busy)} onClick={onUpload}>
        {hasLayout ? "Replace weekly flyer" : "Upload weekly flyer"}
      </button>
      <p className="hint">You can also press ⌘V / Ctrl+V with an image on the clipboard while this slide is selected.</p>
      {busy ? <p className="attendance-status">{busy}…</p> : null}
      {note ? <p className="attendance-note">{note}</p> : null}
      {error ? <p className="attendance-error">{error}</p> : null}
      <p className="hint">
        {hasLayout
          ? "Edit the event text directly on the slide. Select a line on the canvas to change or remove it."
          : "Upload the first flyer to create the QR and editable event text."}
      </p>
    </div>
  );
}
