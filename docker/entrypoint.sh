#!/bin/sh
set -eu

PUID="${PUID:-99}"
PGID="${PGID:-100}"
DATA_DIR="${DATA_DIR:-/data}"
ARCHIVE_DIR="${SLIDES_ARCHIVE_DIR:-/slides}"

mkdir -p "$DATA_DIR" "$ARCHIVE_DIR/decks" "$ARCHIVE_DIR/media/_shared"

# The volume roots can already belong to PUID while folders left behind by an
# earlier root run do not, so fix both trees on every start instead of only
# when the top-level owner differs.
chown -R "$PUID:$PGID" "$DATA_DIR" "$ARCHIVE_DIR" 2>/dev/null || true

if gosu "$PUID:$PGID" sh -c "test -w '$DATA_DIR' && test -w '$ARCHIVE_DIR' && test -w '$ARCHIVE_DIR/decks' && test -w '$ARCHIVE_DIR/media'" 2>/dev/null; then
  exec gosu "$PUID:$PGID" "$@"
fi

echo "slides: WARNING: $DATA_DIR or $ARCHIVE_DIR is not writable as $PUID:$PGID." >&2
echo "slides: On the unRAID host run: chown -R $PUID:$PGID /mnt/user/appdata/parsippany-slides '/mnt/user/AVMandal Files/Sponsorship Slides Archive'" >&2
echo "slides: Or set PUID and PGID to 0 in the template. Starting as root so the app still runs." >&2
exec "$@"
