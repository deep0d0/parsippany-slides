import { DurableObject } from "cloudflare:workers";
import seedJson from "../data/deck.json";
import { reduce, sanitizeSeconds, sanitizeSlides, sanitizeTitle } from "../shared/reduce";
import { isClientMessage, type Deck, type RoomState, type SavedFile } from "../shared/types";

const seed = seedJson as Deck;
const MAX_MEDIA_BYTES = 2_500_000;
const MAX_FILES = 20;

type Bindings = {
  DECK_ROOM: DurableObjectNamespace<DeckRoom>;
  ASSETS: Fetcher;
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

export class DeckRoom extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          updated INTEGER NOT NULL,
          deck TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS media (
          id TEXT PRIMARY KEY,
          mime TEXT NOT NULL,
          bytes BLOB NOT NULL
        );
      `);
    });
  }

  async getState(): Promise<RoomState> {
    return this.load();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ role: new URL(request.url).searchParams.get("role") ?? "play" });
      server.send(JSON.stringify({ type: "state", ...this.load() }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return this.http(request);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (!isClientMessage(parsed)) return;
    const next = reduce(this.load(), parsed);
    this.save(next);
    this.broadcast(next);
    void ws;
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
  }

  private async http(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/api/state" && request.method === "GET") {
      return json(this.load(), { "Cache-Control": "no-store" });
    }
    if (path === "/api/files" && request.method === "GET") {
      const state = this.load();
      return json({ current: state.fileId, files: this.listFiles() });
    }
    if (path === "/api/files" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const title = sanitizeTitle((body as { title?: string } | null)?.title);
      const count = Number(
        this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM files").toArray()[0]?.n ?? 0,
      );
      if (count >= MAX_FILES) return error("You already have the maximum number of saved files.", 400);
      const id = `f-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const now = Date.now();
      const empty: Deck = { id, title, seedRevision: seed.seedRevision, slides: [] };
      this.ctx.storage.sql.exec(
        "INSERT INTO files (id, title, updated, deck) VALUES (?, ?, ?, ?)",
        id,
        title,
        now,
        JSON.stringify(empty),
      );
      return json({ id, title });
    }

    const media = path.match(/^\/api\/(?:files\/([\w-]+)\/media|media\/([\w-]+))\/([\w.-]+)$/);
    if (media) {
      const fileId = media[1] || media[2];
      const name = media[3];
      const id = `${fileId}/${name}`;
      if (request.method === "GET") {
        const row = this.ctx.storage.sql.exec<{ mime: string; bytes: ArrayBuffer }>(
          "SELECT mime, bytes FROM media WHERE id = ?",
          id,
        ).toArray()[0];
        if (!row) return error("Not found", 404);
        return new Response(row.bytes, {
          headers: { "Content-Type": row.mime, "Cache-Control": "public, max-age=31536000, immutable" },
        });
      }
      if (request.method === "PUT") {
        if (!this.fileExists(fileId)) return error("Unknown file", 404);
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength < 8 || bytes.byteLength > MAX_MEDIA_BYTES) {
          return error("That image is too large to save.", 413);
        }
        const mime = request.headers.get("Content-Type") || "application/octet-stream";
        if (!mime.startsWith("image/")) return error("Only images can be stored.", 415);
        this.ctx.storage.sql.exec(
          "INSERT INTO media (id, mime, bytes) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes",
          id,
          mime.slice(0, 80),
          bytes,
        );
        return json({ ok: true });
      }
    }

    const open = path.match(/^\/api\/files\/([\w-]+)\/open$/);
    if (open && request.method === "POST") {
      const id = open[1];
      const existing = this.ctx.storage.sql.exec<{ deck: string; title: string }>(
        "SELECT deck, title FROM files WHERE id = ?",
        id,
      ).toArray()[0];
      if (!existing) return error("Unknown file", 404);
      const stored = JSON.parse(existing.deck) as Deck;
      const body = await request.json().catch(() => null) as { title?: string; slides?: unknown; slidePoints?: number; advanceSeconds?: number } | null;
      const slides = body?.slides ? sanitizeSlides(body.slides) : sanitizeSlides(stored.slides);
      if (slides.length === 0) return error("This file has no slides yet.", 400);
      const title = sanitizeTitle(body?.title ?? stored.title ?? existing.title);
      const slidePoints =
        typeof body?.slidePoints === "number" && Number.isFinite(body.slidePoints) ? body.slidePoints : stored.slidePoints;
      const deck: Deck = { id, title, seedRevision: seed.seedRevision, slidePoints, slides };
      const advanceSeconds = sanitizeSeconds(body?.advanceSeconds ?? stored.advanceSeconds);
      if (advanceSeconds !== null) deck.advanceSeconds = advanceSeconds;
      const current = this.load();
      const next: RoomState = {
        fileId: id,
        deck,
        index: 0,
        hold: false,
        autoplay: false,
        heldDeck: null,
        heldIndex: 0,
        rev: current.rev + 1,
      };
      this.save(next);
      this.broadcast(next);
      return json({ ok: true, id, title });
    }

    return error("Not found", 404);
  }

  private listFiles(): SavedFile[] {
    return this.ctx.storage.sql
      .exec<{ id: string; title: string; updated: number; deck: string }>(
        "SELECT id, title, updated, deck FROM files ORDER BY updated DESC",
      )
      .toArray()
      .filter((row) => {
        try {
          const deck = JSON.parse(row.deck) as { slides?: unknown[] };
          return Array.isArray(deck.slides) && deck.slides.length > 0;
        } catch {
          return false;
        }
      })
      .map(({ id, title, updated }) => ({ id, title, updated }));
  }

  private fileExists(id: string): boolean {
    return this.ctx.storage.sql.exec("SELECT 1 AS ok FROM files WHERE id = ?", id).toArray().length > 0;
  }

  private broadcast(state: RoomState) {
    const payload = JSON.stringify({ type: "state", ...state });
    for (const socket of this.ctx.getWebSockets()) socket.send(payload);
  }

  private load(): RoomState {
    const rows = this.ctx.storage.sql.exec<{ data: string }>("SELECT data FROM room WHERE id = 1").toArray();
    if (rows.length === 0) {
      const created = initialState(seed.id);
      this.save(created);
      return created;
    }
    const stored = JSON.parse(rows[0].data) as RoomState;
    if (typeof stored.autoplay !== "boolean") stored.autoplay = false;
    if (!stored.fileId) {
      stored.fileId = stored.deck?.id || seed.id;
      this.remember(stored);
      this.ctx.storage.sql.exec(
        "INSERT INTO room (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        JSON.stringify(stored),
      );
      return stored;
    }
    this.remember(stored);
    return stored;
  }

  private remember(state: RoomState) {
    const exists = this.fileExists(state.fileId);
    if (exists) return;
    this.ctx.storage.sql.exec(
      "INSERT INTO files (id, title, updated, deck) VALUES (?, ?, ?, ?)",
      state.fileId,
      sanitizeTitle(state.deck.title),
      Date.now(),
      JSON.stringify(state.deck),
    );
  }

  private save(state: RoomState) {
    this.ctx.storage.sql.exec(
      "INSERT INTO room (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      JSON.stringify(state),
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO files (id, title, updated, deck) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated = excluded.updated, deck = excluded.deck",
      state.fileId,
      sanitizeTitle(state.deck.title),
      Date.now(),
      JSON.stringify(state.deck),
    );
  }
}

function json(data: unknown, headers?: Record<string, string>): Response {
  return Response.json(data, { headers: { "Cache-Control": "no-store", ...headers } });
}

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    const room = () => env.DECK_ROOM.getByName("diwali-2026");

    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/room") return room().fetch(request);
      return room().fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
