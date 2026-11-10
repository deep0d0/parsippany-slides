# unRAID template

`parsippany-slides.xml` is a Docker template for the app. It gives you the usual unRAID
container page: icon, WebUI button, start/stop, logs, autostart, the appdata path, and the
Sponsorship Slides Archive path.

## Install

1. Copy the template into the user template folder:

   ```sh
   cp unraid/parsippany-slides.xml /boot/config/plugins/dockerMan/templates-user/
   ```

2. Docker tab → **Add Container** → **Template** dropdown → **ParsippanySlides** → **Apply**.

The template pulls `ghcr.io/deep0d0/parsippany-slides:latest`. The image contains only the app
and a blank starter deck; decks and images are on the archive mount. The package is public, so
no registry credential is needed.

If ParsippanySlides is already installed with the old local image, open it in the Docker tab,
choose **Edit**, change **Repository** to the GHCR tag, add the archive path below, and **Apply**.

## Archive folder

Create this folder in the AVMandal Files share:

```text
/mnt/user/AVMandal Files/Sponsorship Slides Archive
```

Copy the contents of the project's `Sponsorship Slides Archive` handoff folder into it:
`decks/`, `media/`, and `library.json`. The deployment zip intentionally omits this folder, so
copy it from the project folder separately. The template mounts that host path at `/slides`; the
app creates missing subfolders. The current deck is `decks/diwali-2026.json` and its artwork is
`media/_shared/image1.png` through `image6.png`.

The first start also copies any decks or uploaded images left in appdata into the archive once,
and writes `archive-migrated.json` in appdata. It does not delete the old appdata copies; remove
them after you verify the archive.

## Defaults

| Setting | Value |
|---|---|
| Repository | `ghcr.io/deep0d0/parsippany-slides:latest` |
| Port | `8080` → `8080` |
| Appdata | `/mnt/user/appdata/parsippany-slides` → `/data` |
| Slides Archive | `/mnt/user/AVMandal Files/Sponsorship Slides Archive` → `/slides` |
| PUID / PGID | `99` / `100` |
| Timezone | `America/New_York` |

The icon points at the app itself (`/icon.svg`), so it appears once the container is
running. Change `<Icon>` to a public URL before publishing the template.

## Updating

Docker tab → **ParsippanySlides** → **Check for Updates** → **Apply**. The Community
Applications **Auto Update** plugin can watch the container too. Decks and images live in the
archive; the Telegram token and room state live in appdata; both survive the update. If you are
moving an existing Telegram connection, copy `telegram.json` from the old `DATA_DIR` into the
new appdata folder so the same channel post is edited instead of a new one being sent.

Every push to `main` runs `.github/workflows/image.yml`, which builds `linux/amd64` and
pushes the new image.

## Permissions

The entrypoint chowns both the appdata and archive trees to `PUID`/`PGID` on every start. If a
mount refuses that (`EACCES: permission denied` in the log), run this on the host and restart
the container:

```sh
chown -R 99:100 /mnt/user/appdata/parsippany-slides '/mnt/user/AVMandal Files/Sponsorship Slides Archive'
```

If ownership cannot be changed at all, set `PUID` and `PGID` to `0` in the template so the
container runs as root.

## Publishing to the Apps tab

Community Applications needs a public template. The source repository is public, so the XML can
be hosted from it. To list the template in CA, set `<TemplateURL>` to its raw URL and submit the
repository to Community Applications.
