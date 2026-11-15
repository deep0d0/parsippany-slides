import { useEffect, useState } from "react";
import {
  ATTENDANCE_DATE_ID,
  ATTENDANCE_LOCATION_ID,
  ATTENDANCE_TITLE_ID,
  attendanceValues,
  type AttendanceDetails,
} from "../shared/attendance";
import type { Slide } from "../shared/types";

export function AttendancePanel({
  slide,
  busy,
  note,
  error,
  onUpload,
  onText,
}: {
  slide: Slide;
  busy: string | null;
  note: string | null;
  error: string | null;
  onUpload: () => void;
  onText: (boxId: string, text: string) => void;
}) {
  const values = attendanceValues(slide);
  const [draft, setDraft] = useState<AttendanceDetails>(values);
  const hasLayout = slide.boxes.some((box) => box.id === ATTENDANCE_TITLE_ID);

  useEffect(() => {
    setDraft(values);
  }, [slide.id, values.title, values.location, values.date]);

  const commit = (key: keyof AttendanceDetails) => {
    const id =
      key === "title" ? ATTENDANCE_TITLE_ID : key === "location" ? ATTENDANCE_LOCATION_ID : ATTENDANCE_DATE_ID;
    onText(id, draft[key]);
  };

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
      {hasLayout ? (
        <fieldset className="attendance-details">
          <legend>Slide details</legend>
          <label>
            <span>Event</span>
            <input
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              onBlur={() => commit("title")}
            />
          </label>
          <label>
            <span>Location</span>
            <input
              value={draft.location}
              onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))}
              onBlur={() => commit("location")}
            />
          </label>
          <label>
            <span>Date &amp; time</span>
            <textarea
              rows={2}
              value={draft.date}
              onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
              onBlur={() => commit("date")}
            />
          </label>
        </fieldset>
      ) : (
        <p className="hint">Upload the first flyer to create the QR and editable details.</p>
      )}
    </div>
  );
}
