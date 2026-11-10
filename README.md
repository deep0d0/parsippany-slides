# Parsippany Slides

A browser-based announcement deck for the lobby screen. Staff edit slides, the desk remote
moves the show, and the screen follows along live. It is a React client plus a small Node
server that keeps room state in appdata and the deck archive on a mounted share, so it runs
on a home server instead of Cloudflare.

| Page | Address | Who uses it |
|---|---|---|
| Editor | `/` | Staff. Add, duplicate, and reorder slides; move and style text boxes; upload PPTX files and images; set timing; tag sponsorship slides; run Tidy up; manage the deck library. |
| Lobby screen | `/play` | The ProPresenter browser (or a phone, which turns it into the desk remote). No chrome, just the slide. Auto and Hold live here too. |
| Desk remote | `/remote` | Front desk. Previous, Next, jump list, and Hold. Same layout as a phone on `/play`. |

Edits, slide changes, Hold, and Auto are pushed to every open page over one WebSocket, so
the lobby updates while someone types.

## Autoplay

Set **Deck default** seconds and an optional **Auto-advance** override for the selected slide in
the editor's Slide panel. Turn **Auto** on from `/remote` or a phone on `/play`: the server
advances the room through the visible slides and loops back to the first, so every open screen
follows even when no lobby tab is open. Hold pauses it, and any manual Next/Previous restarts
the timer for the slide you land on.

## Deck library

**File → Open deck library…** lists every saved deck. **Make current** opens that deck for the
lobby and the digest, **Archive** keeps the files but takes the deck out of rotation, **Restore**
puts it back, and **Delete** removes the deck file and its uploaded art. The live deck cannot be
archived or deleted, and an archived deck cannot be opened until it is restored.

## Slide archive

Decks, uploaded images, and the deck-library index live in `SLIDES_ARCHIVE_DIR`. The app image
ships only a blank starter slide and contains no deck content. On unRAID the template mounts
`/mnt/user/AVMandal Files/Sponsorship Slides Archive` at `/slides`. The app creates `decks/`,
`media/`, and `library.json` there. `DATA_DIR` keeps only the live room state and Telegram
settings.

## Tidy up

**Tidy up** compares slides that share the same background art (or the same layout when a deck has
no art). Each group gets a reference slide; the panel lists every text box whose font size or
padding differs from the matching box on the reference. You can review the changes, change the
reference, apply one group, or apply everything. Only font size and padding are changed — font
family, color, alignment, and box positions are untouched. Each apply is one undo step. Hidden
slides are excluded unless you tick **Include hidden slides**.

## Sponsorship digest

The **Digest** button connects the live deck to a text-only Telegram channel post. A slide is
included when it is visible, has text, and either mentions “sponsor” in a text box or is switched
on manually in the Slide panel. The inspector switch also lets you keep an automatically tagged
slide out, and **Use automatic tag** clears the override.

Message format, one text box per line and slides in deck order:

```text
Autumn 2026 Sponsorships

1. Presenting Sponsor
Example Name

2. Community Sponsor
Example Name

🕒 Updated Sun, Nov 8, 2026, 12:59 PM
```

Set it up with the token from @BotFather. Add the bot to the channel as an administrator with
**Post Messages**, post once in the channel, then use **Find from recent post** (or paste the
channel `@username`/ID). Turn on **Automatic updates**, **Save**, and **Sync now** once. The bot
only edits its own message; if that message is gone it posts a new one silently and removes the
old one when Telegram allows it.

Automatic updates are edit-driven. After a tagged slide changes, the post is edited in place once
the text has been quiet for five minutes. If editing continues, it still refreshes after 45 minutes
without an update. There is no fixed weekday or 30-minute polling schedule, and unchanged text is
not reposted.

The token is stored on the server in `DATA_DIR/telegram.json` with mode `600`, is never returned
to the browser, and is not part of the repository. Back that file up with the rest of `data`, or
re-enter the token after restoring a backup. To move an existing channel connection, copy
`telegram.json` too; re-entering only the token makes the new install send a new post because
the stored message ID is missing.

## Run it locally

Needs Node 20 or newer.

```sh
npm install
npm run build
npm start
```

Then open <http://localhost:8080>. Decks, images, and the deck index are written to
`SLIDES_ARCHIVE_DIR`; the room state and Telegram settings stay in `./data`. For local runs
`SLIDES_ARCHIVE_DIR` defaults to `DATA_DIR`, so the app opens with one blank starter slide until
you upload a PowerPoint or copy a deck into the archive.

For development, run the API server and the Vite dev server side by side:

```sh
npm run dev:server   # API + WebSocket on :8080 (restarts on change)
npm run dev          # client on :5173, proxies /api to :8080
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP and WebSocket port. |
| `HOST` | `0.0.0.0` | Interface to bind. |
| `DATA_DIR` | `./data` | Room state and Telegram settings. |
| `SLIDES_ARCHIVE_DIR` | `DATA_DIR` | Decks, media, and the deck-library index. Mount this on the share. |
| `DIST_DIR` | `./dist` | Built client. |
| `API_ORIGIN` | `http://127.0.0.1:8080` | Dev only: where Vite proxies `/api`. |

## Data

```
DATA_DIR/
  state.json             live room state; may cache the current deck
  telegram.json          bot token, channel, message IDs, and digest status (private)

SLIDES_ARCHIVE_DIR/
  decks/<fileId>.json    every saved deck
  media/<fileId>/<file>  uploaded slide art
  media/_shared/<file>   background art used by a copied legacy deck
  library.json           archived deck IDs
```

`state.json` and the deck files are rewritten atomically (temp file + rename), so a power
cut leaves the previous copy intact. The archive is the canonical deck storage; back it up
by copying that folder. Deleting `DATA_DIR` resets the room to the blank starter deck; it
does not delete the archive.

### Coming from Cloudflare

No deck ships in the image. Import the original `.pptx` files, or copy an existing deck into
`SLIDES_ARCHIVE_DIR/decks/` and choose it in the deck library. The old Cloudflare Worker has
been retired; its source remains in `src/worker` for reference, but it is not deployed. Decks
uploaded through that editor lived inside its Durable Object and are not exported automatically.

## Docker

```sh
docker compose up -d --build
```

That builds `parsippany-slides:local`, keeps room state in `./appdata`, and mounts the deck
archive from `./Sponsorship Slides Archive`. Set `TZ`, `PUID`, and `PGID` in
`docker-compose.yml` if your host needs different values.

## unRAID

The app is a single container: one port, two mounted folders, no database. `unraid/parsippany-slides.xml`
is a Docker template, so it installs from the Docker tab and is managed there like any other
container (icon, WebUI button, start/stop, logs, autostart).

Every push to `main` builds a `linux/amd64` image with GitHub Actions and publishes it to
`ghcr.io/deep0d0/parsippany-slides:latest`.

The image contains only the app and a blank starter deck; the archive is never copied into it.
The repository and the `ghcr.io/deep0d0/parsippany-slides` package are public, so unRAID pulls
`latest` without a registry credential. The public repository and package contain no deck
content, and the older image versions have been removed.

### 1. Install the template once

On a new install, copy the template from this project to the server:

```sh
cp unraid/parsippany-slides.xml /boot/config/plugins/dockerMan/templates-user/
```

Then in the web UI: **Docker** tab → **Add Container** → open the **Template** dropdown and
choose **ParsippanySlides** → check the Appdata path (`/mnt/user/appdata/parsippany-slides`),
the **Sponsorship Slides Archive** path (`/mnt/user/AVMandal Files/Sponsorship Slides Archive`),
and the port → **Apply**. Create the archive folder in the AVMandal Files share first, or let
the template create it, then copy the contents of the project's `Sponsorship Slides Archive`
handoff folder into it.

If ParsippanySlides is already installed with the old local image, open it in the Docker tab,
choose **Edit**, set **Repository** to `ghcr.io/deep0d0/parsippany-slides:latest`, add the
archive path mapping, and **Apply**. On first start the app copies any decks/images still in
appdata into the archive once. Telegram settings stay in appdata.

### 2. First start

Turn on **Autostart** in the Docker tab. Use the container's **WebUI** link to open the editor.
Logs, start/stop, and the resource readout all work from the same page.

### 3. Point the lobby at it

- Editor: `http://tower:8080/` (or the array's IP)
- Lobby screen for ProPresenter: `http://tower:8080/play`
- Desk remote: `http://tower:8080/remote`

If ProPresenter runs on another machine, use the server's LAN IP or hostname, not
`localhost`.

### Updating

In the Docker tab, open **ParsippanySlides** → **Check for Updates** → **Apply**. That pulls the
latest GHCR image and recreates the container; the archive and appdata are untouched. The
Community Applications **Auto Update** plugin can watch this container too.

### Building locally (optional)

If you want to build on the unRAID box instead of pulling the published image:

```sh
cd /mnt/user/appdata/parsippany-slides-src
docker build -t parsippany-slides:local .
docker rm -f parsippany-slides
```

Then start **ParsippanySlides** again from the Docker tab. If you use this path, change the
template's **Repository** back to `parsippany-slides:local`; otherwise Docker will keep pulling
the GHCR image.

### Showing up in the Apps tab

A template in `templates-user` shows up in **Add Container** and the Docker tab, which is
where day-to-day management happens. Getting it into the **Apps** tab's search is a separate
step: Community Applications only lists templates published in a public repository and
submitted to CA. The template file already has the fields CA needs; publishing it needs a
public GitHub repo with `<TemplateURL>` set to the raw XML URL, plus a CA submission.

### Permission error on /data or /slides

The container runs as `PUID`/`PGID` (99:100 by default) and fixes ownership of both mounted
trees on every start. If the log shows `EACCES: permission denied`, a mount is refusing that
change. Fix both on the host:

```sh
chown -R 99:100 /mnt/user/appdata/parsippany-slides '/mnt/user/AVMandal Files/Sponsorship Slides Archive'
```

Then restart the container. If the archive is on a filesystem that will not accept ownership
changes (some unassigned devices or network mounts), set **PUID** and **PGID** to `0` in the
template so the container runs as root.

### Networking notes

- The app has no login, exactly like the Cloudflare version. Keep it on the LAN, or put it
  behind a reverse proxy with its own authentication before exposing it to the internet.
- If you front it with a proxy (SWAG, Nginx Proxy Manager, Traefik), the proxy must pass
  WebSocket upgrades for `/api/room`, or live updates fall back to the 2-second poll.
- Container port `8080` is the only port the app needs.
