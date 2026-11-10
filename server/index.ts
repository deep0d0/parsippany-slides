/**
 * Self-hosted replacement for the Cloudflare Worker + DeckRoom Durable Object.
 *
 * Serves the built client from ./dist, answers the same /api/* routes, and runs
 * the live room over a WebSocket. State lives in DATA_DIR:
 *
 *   state.json             the room the lobby is watching
 *   decks/<fileId>.json    every saved deck
 *   media/<fileId>/<name>  uploaded slide art
 */
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import seedJson from "../src/data/deck.json";
import { reduce, sanitizeSeconds, sanitizeSlides, sanitizeTitle } from "../src/shared/reduce";
import { TelegramError, TelegramService } from "./telegram";
import {
  DEFAULT_ADVANCE_SECONDS,
  isClientMessage,
  visibleSlides,
  type Deck,
  type RoomState,
  type SavedFile,
} from "../src/shared/types";

const seed = seedJson as Deck;
const MAX_MEDIA_BYTES = 2_500_000;
const MAX_FILES = 20;
const MAX_BODY_BYTES = 8_000_000;

function envPort(): number {
  const value = Number(process.env.PORT);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : 8080;
}

const PORT = envPort();
const HOST = process.env.HOST || "0.0.0.0";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const DIST_DIR = resolve(process.env.DIST_DIR ?? join(projectRoot, "dist"));
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(projectRoot, "data"));
const SLIDES_ARCHIVE_DIR = resolve(process.env.SLIDES_ARCHIVE_DIR ?? DATA_DIR);
const DECKS_DIR = join(SLIDES_ARCHIVE_DIR, "decks");
const MEDIA_DIR = join(SLIDES_ARCHIVE_DIR, "media");
const STATE_FILE = join(DATA_DIR, "state.json");
const LIBRARY_FILE = join(SLIDES_ARCHIVE_DIR, "library.json");
const TELEGRAM_FILE = join(DATA_DIR, "telegram.json");
const ARCHIVE_MIGRATION_FILE = join(DATA_DIR, "archive-migrated.json");

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type FileEntry = {
  id: string;
  title: string;
  updated: number;
  slides: number;
};

type OpenBody = {
  title?: string;
  slides?: unknown;
  slidePoints?: number;
  advanceSeconds?: number;
};

function initialState(fileId: string): RoomState {
  return {
    fileId,
    deck: { ...seed, id: fileId },
    index: 0,
    hold: false,
    autoplay: false,
    heldDeck: null,
    heldIndex: 0,
    rev: 1,
  };
}

async function writeAtomic(target: string, data: string | Uint8Array): Promise<void> {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, data);
  await rename(temp, target);
}

function mediaType(name: string): string {
  const extension = extname(name).slice(1).toLowerCase();
  return MEDIA_TYPES[extension] ?? "application/octet-stream";
}

function safeSegment(value: string): string {
  if (!/^[\w-][\w.-]{0,79}$/.test(value) || value.includes("..")) {
    throw new HttpError("Not found", 404);
  }
  return value;
}

class Room {
  private state: RoomState | null = null;
  private readonly files = new Map<string, FileEntry>();
  private readonly archived = new Set<string>();
  readonly telegram = new TelegramService(TELEGRAM_FILE, () => this.state?.deck ?? null);
  private readonly sockets = new Set<WebSocket>();
  private readonly living = new Set<WebSocket>();
  private writes: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerKey = "off";

  get now(): RoomState {
    if (!this.state) throw new Error("The room has not been loaded yet.");
    return this.state;
  }

  async init(): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    await mkdir(SLIDES_ARCHIVE_DIR, { recursive: true });
    await mkdir(DECKS_DIR, { recursive: true });
    await mkdir(MEDIA_DIR, { recursive: true });
    if (SLIDES_ARCHIVE_DIR !== DATA_DIR) await this.migrateLegacyArchive();
    await this.loadLibrary();
    await this.scan();
    const state = await this.loadState();
    this.state = state;
    if (this.archived.has(state.fileId)) {
      this.archived.delete(state.fileId);
      await this.persistLibrary();
    }
    if (!this.files.has(state.fileId)) {
      await writeAtomic(join(DECKS_DIR, `${state.fileId}.json`), JSON.stringify(state.deck));
      this.files.set(state.fileId, {
        id: state.fileId,
        title: sanitizeTitle(state.deck.title),
        updated: Date.now(),
        slides: state.deck.slides.length,
      });
    }
    await this.queue(() => writeAtomic(STATE_FILE, JSON.stringify(state)));
    this.scheduleAutoplay();
    await this.telegram.load();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerKey = "off";
    this.telegram.stop();
  }

  getState(): RoomState {
    return this.now;
  }

  listFiles(): SavedFile[] {
    return [...this.files.values()]
      .filter((file) => file.slides > 0)
      .sort((a, b) => b.updated - a.updated)
      .map(({ id, title, updated, slides }) => ({
        id,
        title,
        updated,
        slides,
        archived: this.archived.has(id),
      }));
  }

  async archiveFile(id: string, archived: boolean): Promise<void> {
    if (!this.files.has(id)) throw new HttpError("Unknown file", 404);
    if (archived && id === this.now.fileId) {
      throw new HttpError("Open another deck before archiving the live one.", 400);
    }
    if (archived) this.archived.add(id);
    else this.archived.delete(id);
    await this.persistLibrary();
  }

  async deleteFile(id: string): Promise<void> {
    if (!this.files.has(id)) throw new HttpError("Unknown file", 404);
    if (id === this.now.fileId) {
      throw new HttpError("Open another deck before deleting the live one.", 400);
    }
    this.files.delete(id);
    this.archived.delete(id);
    await rm(join(DECKS_DIR, `${id}.json`), { force: true });
    await rm(join(MEDIA_DIR, id), { recursive: true, force: true });
    await this.persistLibrary();
  }

  async createFile(title: string): Promise<{ id: string; title: string }> {
    if (this.files.size >= MAX_FILES) {
      throw new HttpError("You already have the maximum number of saved files.", 400);
    }
    const id = `f-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const empty: Deck = { id, title, seedRevision: seed.seedRevision, slides: [] };
    await writeAtomic(join(DECKS_DIR, `${id}.json`), JSON.stringify(empty));
    this.files.set(id, { id, title, updated: Date.now(), slides: 0 });
    return { id, title };
  }

  async openFile(id: string, body: OpenBody | null): Promise<{ id: string; title: string }> {
    const entry = this.files.get(id);
    if (!entry) throw new HttpError("Unknown file", 404);
    if (this.archived.has(id)) {
      throw new HttpError("This deck is archived. Restore it before opening it.", 400);
    }
    const stored =
      id === this.now.fileId
        ? this.now.deck
        : (JSON.parse(await readFile(join(DECKS_DIR, `${id}.json`), "utf8")) as Deck);
    const slides = body?.slides ? sanitizeSlides(body.slides) : sanitizeSlides(stored.slides);
    if (slides.length === 0) throw new HttpError("This file has no slides yet.", 400);
    const title = sanitizeTitle(body?.title ?? stored.title ?? entry.title);
    const slidePoints =
      typeof body?.slidePoints === "number" && Number.isFinite(body.slidePoints)
        ? body.slidePoints
        : stored.slidePoints;
    const deck: Deck = { id, title, seedRevision: seed.seedRevision, slidePoints, slides };
    const advanceSeconds = sanitizeSeconds(body?.advanceSeconds ?? stored.advanceSeconds);
    if (advanceSeconds !== null) deck.advanceSeconds = advanceSeconds;
    const next: RoomState = {
      fileId: id,
      deck,
      index: 0,
      hold: false,
      autoplay: false,
      heldDeck: null,
      heldIndex: 0,
      rev: this.now.rev + 1,
    };
    await this.save(next);
    this.broadcast(next);
    this.scheduleAutoplay();
    return { id, title };
  }

  async saveMedia(fileId: string, name: string, mime: string, bytes: Uint8Array): Promise<void> {
    if (!this.files.has(fileId)) throw new HttpError("Unknown file", 404);
    if (bytes.byteLength < 8 || bytes.byteLength > MAX_MEDIA_BYTES) {
      throw new HttpError("That image is too large to save.", 413);
    }
    if (!mime.startsWith("image/")) throw new HttpError("Only images can be stored.", 415);
    const directory = join(MEDIA_DIR, fileId);
    await mkdir(directory, { recursive: true });
    await writeAtomic(join(directory, name), bytes);
  }

  async readMedia(fileId: string, name: string): Promise<{ mime: string; bytes: Buffer } | null> {
    const target = join(MEDIA_DIR, fileId, name);
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) return null;
    return { mime: mediaType(name), bytes: await readFile(target) };
  }

  attach(socket: WebSocket): void {
    this.sockets.add(socket);
    this.living.add(socket);
    socket.on("pong", () => this.living.add(socket));
    socket.on("message", (data) => {
      void this.receive(data.toString());
    });
    socket.on("close", () => this.forget(socket));
    socket.on("error", () => this.forget(socket));
    socket.send(JSON.stringify({ type: "state", ...this.now }));
  }

  /** Keeps idle lobby screens from being dropped by proxies, and clears dead ones. */
  keepAlive(): void {
    for (const socket of this.sockets) {
      if (!this.living.has(socket)) {
        this.forget(socket);
        socket.terminate();
        continue;
      }
      this.living.delete(socket);
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
  }

  async flush(): Promise<void> {
    await this.writes;
  }

  private forget(socket: WebSocket): void {
    this.sockets.delete(socket);
    this.living.delete(socket);
  }

  private async receive(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isClientMessage(parsed)) return;
    const current = this.now;
    const next = reduce(current, parsed);
    if (next === current) return;
    await this.save(next);
    this.broadcast(next);
    this.scheduleAutoplay();
  }

  /**
   * Autoplay lives here rather than in a browser tab: the room keeps moving when
   * no screen is open, every screen shows the same slide, and a phone remote
   * cannot start a second clock.
   */
  private scheduleAutoplay(): void {
    const state = this.state;
    const visible = state ? visibleSlides(state.deck) : [];
    const current = state ? visible[state.index] : undefined;
    const seconds = current?.advanceSeconds ?? state?.deck.advanceSeconds ?? DEFAULT_ADVANCE_SECONDS;
    const running = Boolean(state?.autoplay) && !state?.hold && visible.length > 1;
    const key = running ? `${state?.index}:${current?.id ?? ""}:${seconds}:${visible.length}` : "off";
    if (key === this.timerKey) return;
    this.timerKey = key;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!running || !state) return;
    this.timer = setTimeout(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    this.timer = null;
    const state = this.state;
    if (!state || !state.autoplay || state.hold) {
      this.timerKey = "off";
      return;
    }
    const visible = visibleSlides(state.deck);
    if (visible.length < 2) {
      this.timerKey = "off";
      return;
    }
    const current = Math.min(state.index, visible.length - 1);
    const next = reduce(state, { type: "index", index: (current + 1) % visible.length });
    if (next !== state) {
      await this.save(next);
      this.broadcast(next);
    }
    this.scheduleAutoplay();
  }

  /** One-time copy of decks/media from an older appdata-only install. */
  private async migrateLegacyArchive(): Promise<void> {
    const marker = await stat(ARCHIVE_MIGRATION_FILE).catch(() => null);
    if (marker?.isFile()) return;
    let copied = 0;
    const copyTree = async (source: string, target: string): Promise<void> => {
      const entries = await readdir(source, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const from = join(source, entry.name);
        const to = join(target, entry.name);
        if (entry.isDirectory()) {
          await mkdir(to, { recursive: true });
          await copyTree(from, to);
        } else if (entry.isFile()) {
          const exists = await stat(to).catch(() => null);
          if (!exists) {
            await copyFile(from, to);
            copied += 1;
          }
        }
      }
    };
    await copyTree(join(DATA_DIR, "decks"), DECKS_DIR);
    await copyTree(join(DATA_DIR, "media"), MEDIA_DIR);
    const oldLibrary = join(DATA_DIR, "library.json");
    const newLibrary = join(SLIDES_ARCHIVE_DIR, "library.json");
    if (!(await stat(newLibrary).catch(() => null))) {
      try {
        await copyFile(oldLibrary, newLibrary);
        copied += 1;
      } catch {
        // No old library index.
      }
    }
    await writeAtomic(ARCHIVE_MIGRATION_FILE, JSON.stringify({ migratedAt: Date.now(), copied }));
    if (copied > 0) console.log(`slides: copied ${copied} legacy file(s) into ${SLIDES_ARCHIVE_DIR}`);
  }

  private async loadLibrary(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(LIBRARY_FILE, "utf8")) as { archived?: unknown };
      if (Array.isArray(raw?.archived)) {
        for (const id of raw.archived) {
          if (typeof id === "string" && /^[\w-]{1,40}$/.test(id)) this.archived.add(id);
        }
      }
    } catch {
      // No library index yet.
    }
  }

  private persistLibrary(): Promise<void> {
    return this.queue(() => writeAtomic(LIBRARY_FILE, JSON.stringify({ archived: [...this.archived] })));
  }

  private async scan(): Promise<void> {
    const names = await readdir(DECKS_DIR).catch(() => [] as string[]);
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const file = join(DECKS_DIR, name);
      const id = name.slice(0, -".json".length);
      try {
        const [raw, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
        const deck = JSON.parse(raw) as Deck;
        this.files.set(id, {
          id,
          title: sanitizeTitle(deck?.title),
          updated: info.mtimeMs,
          slides: Array.isArray(deck?.slides) ? deck.slides.length : 0,
        });
      } catch (error) {
        console.warn(`slides: skipping unreadable deck ${name}: ${(error as Error).message}`);
      }
    }
  }

  private async loadState(): Promise<RoomState> {
    try {
      const stored = JSON.parse(await readFile(STATE_FILE, "utf8")) as Partial<RoomState>;
      if (!stored || typeof stored !== "object" || !stored.deck || !Array.isArray(stored.deck.slides)) {
        return initialState(seed.id);
      }
      return {
        fileId: typeof stored.fileId === "string" && stored.fileId ? stored.fileId : stored.deck.id || seed.id,
        deck: stored.deck,
        index: Number.isInteger(stored.index) ? (stored.index as number) : 0,
        hold: Boolean(stored.hold),
        autoplay: Boolean(stored.autoplay),
        heldDeck: stored.heldDeck ?? null,
        heldIndex: Number.isInteger(stored.heldIndex) ? (stored.heldIndex as number) : 0,
        rev: typeof stored.rev === "number" ? stored.rev : 1,
      };
    } catch {
      return initialState(seed.id);
    }
  }

  private save(state: RoomState): Promise<void> {
    this.state = state;
    this.telegram.noteDeck(state.deck);
    this.files.set(state.fileId, {
      id: state.fileId,
      title: sanitizeTitle(state.deck.title),
      updated: Date.now(),
      slides: state.deck.slides.length,
    });
    return this.queue(async () => {
      await writeAtomic(join(DECKS_DIR, `${state.fileId}.json`), JSON.stringify(state.deck));
      await writeAtomic(STATE_FILE, JSON.stringify(state));
    });
  }

  private queue(task: () => Promise<void>): Promise<void> {
    const run = this.writes.then(task, task);
    this.writes = run.catch((error: Error) => {
      console.error(`slides: could not save: ${error.message}`);
    });
    return this.writes;
  }

  private broadcast(state: RoomState): void {
    const payload = JSON.stringify({ type: "state", ...state });
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.byteLength,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError("That request is too large.", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const body = await readBody(req, MAX_BODY_BYTES);
  if (body.byteLength === 0) return null;
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError("That request was not valid JSON.", 400);
  }
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  let requested: string;
  try {
    requested = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 400, { error: "Bad path" });
    return;
  }
  const relative = requested.replace(/^\/+/, "");
  let file = resolve(DIST_DIR, relative || "index.html");
  if (file !== DIST_DIR && !file.startsWith(DIST_DIR + sep)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  if (file === DIST_DIR) file = join(DIST_DIR, "index.html");
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, "index.html");
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile()) {
    if (extname(relative)) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    file = join(DIST_DIR, "index.html");
    info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      sendJson(res, 503, { error: "The app is not built yet. Run npm run build." });
      return;
    }
  }
  const cache = requested.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : requested.startsWith("/fonts/") || requested.startsWith("/media/")
      ? "public, max-age=86400"
      : "no-cache";
  res.writeHead(200, {
    "Content-Type": STATIC_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  await new Promise<void>((done, fail) => {
    const stream = createReadStream(file);
    stream.on("error", fail);
    stream.on("close", () => done());
    stream.pipe(res);
  });
}

const room = new Room();
try {
  await room.init();
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM") {
    console.error(
      `slides: cannot write to ${DATA_DIR} or ${SLIDES_ARCHIVE_DIR}. Both folders must be owned or writable by the user running the server.`,
    );
  }
  throw error;
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true, decks: room.listFiles().length });
    return true;
  }

  const sharedMedia = pathname.match(/^\/media\/([\w.-]+)$/);
  if (sharedMedia && (req.method === "GET" || req.method === "HEAD")) {
    const found = await room.readMedia("_shared", safeSegment(sharedMedia[1]));
    if (!found) {
      sendJson(res, 404, { error: "Not found" });
      return true;
    }
    res.writeHead(200, {
      "Content-Type": found.mime,
      "Content-Length": found.bytes.byteLength,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else res.end(found.bytes);
    return true;
  }

  if (pathname === "/api/state" && req.method === "GET") {
    sendJson(res, 200, room.getState());
    return true;
  }

  if (pathname === "/api/files") {
    if (req.method === "GET") {
      sendJson(res, 200, { current: room.getState().fileId, files: room.listFiles() });
      return true;
    }
    if (req.method === "POST") {
      const body = (await readJson(req)) as { title?: string } | null;
      sendJson(res, 200, await room.createFile(sanitizeTitle(body?.title)));
      return true;
    }
  }

  const archive = pathname.match(/^\/api\/files\/([\w-]+)\/archive$/);
  if (archive && req.method === "POST") {
    const body = (await readJson(req)) as { archived?: unknown } | null;
    if (typeof body?.archived !== "boolean") throw new HttpError("Say whether to archive or restore.", 400);
    await room.archiveFile(safeSegment(archive[1]), body.archived);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const removeFile = pathname.match(/^\/api\/files\/([\w-]+)$/);
  if (removeFile && req.method === "DELETE") {
    await room.deleteFile(safeSegment(removeFile[1]));
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/telegram") {
    if (req.method === "GET") {
      sendJson(res, 200, room.telegram.status());
      return true;
    }
    if (req.method === "PUT") {
      const body = (await readJson(req)) as { enabled?: unknown; token?: unknown; chatId?: unknown } | null;
      sendJson(res, 200, await room.telegram.update(body ?? {}));
      return true;
    }
  }

  if (pathname === "/api/telegram/discover" && req.method === "POST") {
    sendJson(res, 200, await room.telegram.discover());
    return true;
  }

  if (pathname === "/api/telegram/channel" && req.method === "POST") {
    const body = (await readJson(req)) as { chat?: unknown } | null;
    sendJson(res, 200, await room.telegram.channel(typeof body?.chat === "string" ? body.chat : ""));
    return true;
  }

  if (pathname === "/api/telegram/sync" && req.method === "POST") {
    sendJson(res, 200, await room.telegram.syncNow());
    return true;
  }

  const media = pathname.match(/^\/api\/(?:files\/([\w-]+)\/media|media\/([\w-]+))\/([\w.-]+)$/);
  if (media) {
    const fileId = safeSegment(media[1] || media[2]);
    const name = safeSegment(media[3]);
    if (req.method === "GET" || req.method === "HEAD") {
      const found = await room.readMedia(fileId, name);
      if (!found) {
        sendJson(res, 404, { error: "Not found" });
        return true;
      }
      res.writeHead(200, {
        "Content-Type": found.mime,
        "Content-Length": found.bytes.byteLength,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") res.end();
      else res.end(found.bytes);
      return true;
    }
    if (req.method === "PUT") {
      const bytes = await readBody(req, MAX_MEDIA_BYTES + 1_000_000);
      const mime = String(req.headers["content-type"] ?? "application/octet-stream");
      await room.saveMedia(fileId, name, mime, new Uint8Array(bytes));
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  const open = pathname.match(/^\/api\/files\/([\w-]+)\/open$/);
  if (open && req.method === "POST") {
    const id = safeSegment(open[1]);
    const body = (await readJson(req).catch(() => null)) as OpenBody | null;
    sendJson(res, 200, { ok: true, ...(await room.openFile(id, body)) });
    return true;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "Not found" });
    return true;
  }

  return false;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  void handleApi(req, res, url.pathname)
    .then(async (handled) => {
      if (!handled) await serveStatic(req, res, url.pathname);
    })
    .catch((error: unknown) => {
      if (error instanceof HttpError || error instanceof TelegramError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      console.error(`slides: ${req.method} ${url.pathname} failed`, error);
      if (!res.headersSent) sendJson(res, 500, { error: "Something went wrong." });
      else res.end();
    });
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/room") {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => room.attach(ws));
});

const heartbeat = setInterval(() => room.keepAlive(), 30_000);
heartbeat.unref();

server.listen(PORT, HOST, () => {
  console.log(`slides: listening on http://${HOST}:${PORT}`);
  console.log(`slides: dist ${DIST_DIR}`);
  console.log(`slides: data ${DATA_DIR}`);
  console.log(`slides: archive ${SLIDES_ARCHIVE_DIR}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`slides: ${signal}, shutting down`);
  clearInterval(heartbeat);
  room.stop();
  for (const socket of sockets.clients) socket.close(1001, "server shutting down");
  server.close();
  await room.flush();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
