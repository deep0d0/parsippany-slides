import { createHash } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { buildDigest, digestBody, digestSlides } from "../src/shared/digest";
import { visibleSlides, type Deck, type TelegramStatus } from "../src/shared/types";

const API = "https://api.telegram.org";
const PERIOD_MS = 30 * 60 * 1000;
const EDIT_DELAY_MS = 90 * 1000;
const MIN_GAP_MS = 60 * 1000;
const MESSAGE_LIMIT = 3900;
const TIME_ZONE = "America/New_York";
const SYNC_DAYS = new Set(["Fri", "Sat", "Sun"]);

export class TelegramError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type Stored = {
  token: string;
  chatId: string;
  chatTitle: string;
  enabled: boolean;
  messageIds: number[];
  lastBodyHash: string;
  lastContentAt: number;
  lastSyncedAt: number;
  lastError: string;
};

type Input = {
  enabled?: unknown;
  token?: unknown;
  chatId?: unknown;
};

type Chat = { id: number; title?: string; type: string; username?: string };
type Sent = { message_id: number };
type Update = {
  channel_post?: { chat?: Chat };
  my_chat_member?: { chat?: Chat };
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bodyHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function splitMessage(value: string): string[] {
  if (value.length <= MESSAGE_LIMIT) return [value];
  const parts: string[] = [];
  let current = "";
  for (const line of value.split("\n")) {
    if (line.length > MESSAGE_LIMIT) {
      if (current) {
        parts.push(current);
        current = "";
      }
      for (let at = 0; at < line.length; at += MESSAGE_LIMIT) parts.push(line.slice(at, at + MESSAGE_LIMIT));
      continue;
    }
    if (current && current.length + line.length + 1 > MESSAGE_LIMIT) {
      parts.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function canReplace(description: string): boolean {
  return /message to edit not found|message can't be edited|message_id_invalid|message to delete not found/i.test(
    description,
  );
}

export class TelegramService {
  private config: Stored = {
    token: "",
    chatId: "",
    chatTitle: "",
    enabled: false,
    messageIds: [],
    lastBodyHash: "",
    lastContentAt: 0,
    lastSyncedAt: 0,
    lastError: "",
  };
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private queued = false;

  constructor(
    private readonly file: string,
    private readonly getDeck: () => Deck | null,
  ) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<Stored>;
      if (raw && typeof raw === "object") {
        this.config = {
          token: text(raw.token),
          chatId: text(raw.chatId),
          chatTitle: text(raw.chatTitle),
          enabled: raw.enabled === true,
          messageIds: Array.isArray(raw.messageIds)
            ? raw.messageIds.filter((id): id is number => Number.isInteger(id) && id > 0)
            : [],
          lastBodyHash: text(raw.lastBodyHash),
          lastContentAt: typeof raw.lastContentAt === "number" ? raw.lastContentAt : 0,
          lastSyncedAt: typeof raw.lastSyncedAt === "number" ? raw.lastSyncedAt : 0,
          lastError: text(raw.lastError),
        };
      }
    } catch {
      // No saved settings yet, or the file is unreadable. Start empty.
    }
    this.loaded = true;
    this.startTimer();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = null;
    this.debounce = null;
  }

  status(): TelegramStatus {
    const deck = this.getDeck();
    const tagged = deck ? digestSlides(deck).length : 0;
    return {
      enabled: this.config.enabled,
      tokenSet: Boolean(this.config.token),
      chatId: this.config.chatId,
      chatTitle: this.config.chatTitle,
      messageCount: this.config.messageIds.length,
      lastSyncedAt: this.config.lastSyncedAt,
      lastContentAt: this.config.lastContentAt,
      lastError: this.config.lastError,
      nextRunAt: this.config.enabled && this.configured() ? this.nextAllowedRun() : 0,
      digest: deck ? buildDigest(deck, this.config.lastContentAt || Date.now()) : "",
      tagged,
      visible: deck ? visibleSlides(deck).length : 0,
    };
  }

  /** Called after any room change; only sponsor-visible content counts as a change. */
  noteDeck(deck: Deck): void {
    if (!this.loaded) return;
    const body = digestBody(deck);
    const hash = bodyHash(body);
    if (hash === this.config.lastBodyHash) return;
    this.config.lastBodyHash = hash;
    this.config.lastContentAt = body ? Date.now() : 0;
    void this.save();
    if (body && this.config.enabled && this.configured()) this.scheduleEditSync();
  }

  async update(input: Input): Promise<TelegramStatus> {
    const nextToken = text(input.token);
    const nextChat = text(input.chatId);
    if (typeof input.enabled === "boolean") this.config.enabled = input.enabled;

    if (typeof input.token === "string" && nextToken !== this.config.token) {
      const previousBot = this.config.token.split(":")[0];
      const nextBot = nextToken.split(":")[0];
      const sameBot = Boolean(previousBot && nextBot && previousBot === nextBot);
      this.config.token = nextToken;
      if (!sameBot) {
        this.config.messageIds = [];
        this.config.lastSyncedAt = 0;
      }
      this.config.lastError = "";
    }

    if (typeof input.chatId === "string" && nextChat !== this.config.chatId) {
      this.config.chatId = nextChat;
      this.config.chatTitle = "";
      this.config.messageIds = [];
      this.config.lastBodyHash = "";
      this.config.lastContentAt = 0;
      this.config.lastSyncedAt = 0;
      this.config.lastError = "";
    }

    if (!this.config.token) {
      this.config.enabled = false;
      this.config.messageIds = [];
    }
    if (!this.config.chatId) {
      this.config.enabled = false;
      this.config.messageIds = [];
      this.config.chatTitle = "";
    }

    await this.save();
    if (this.config.enabled && this.configured()) this.scheduleEditSync(1200);
    else this.clearDebounce();
    return this.status();
  }

  async discover(): Promise<TelegramStatus> {
    this.requireToken();
    const updates = await this.call<Update[]>("getUpdates", {
      limit: 100,
      allowed_updates: ["channel_post", "my_chat_member"],
    });
    let found: Chat | null = null;
    for (const update of updates ?? []) {
      const chat = update.channel_post?.chat ?? update.my_chat_member?.chat;
      if (chat?.type === "channel") found = chat;
    }
    if (!found) {
      throw new TelegramError(
        "No channel post found. Add the bot as a channel administrator with Post Messages, post once in the channel, then try again.",
        400,
      );
    }
    await this.setChannel(found);
    return this.status();
  }

  async channel(value: string): Promise<TelegramStatus> {
    this.requireToken();
    const chat = text(value);
    if (!chat) throw new TelegramError("Enter a channel @username or numeric ID.");
    const found = await this.call<Chat>("getChat", { chat_id: chat });
    if (found.type !== "channel") throw new TelegramError("That chat is not a channel.");
    await this.setChannel(found);
    return this.status();
  }

  async syncNow(): Promise<TelegramStatus> {
    await this.sync(true);
    return this.status();
  }

  private async setChannel(chat: Chat): Promise<void> {
    const id = String(chat.id);
    this.config.chatId = id;
    this.config.chatTitle = text(chat.title) || (chat.username ? `@${chat.username}` : id);
    this.config.messageIds = [];
    this.config.lastBodyHash = "";
    this.config.lastContentAt = 0;
    this.config.lastSyncedAt = 0;
    this.config.lastError = "";
    await this.save();
  }

  private configured(): boolean {
    return Boolean(this.config.token && this.config.chatId);
  }

  private requireToken(): void {
    if (!this.config.token) throw new TelegramError("Add a bot token first.");
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.config.enabled || !this.configured()) return;
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        weekday: "short",
      }).format(new Date());
      if (!SYNC_DAYS.has(weekday)) return;
      void this.sync(false).catch(() => undefined);
    }, PERIOD_MS);
    this.timer.unref();
  }

  private nextAllowedRun(): number {
    let at = Date.now() + PERIOD_MS;
    for (let step = 0; step < 7 * 48; step += 1) {
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        weekday: "short",
      }).format(new Date(at));
      if (SYNC_DAYS.has(weekday)) return at;
      at += PERIOD_MS;
    }
    return 0;
  }

  private scheduleEditSync(delay = EDIT_DELAY_MS): void {
    if (!this.config.enabled || !this.configured()) return;
    this.clearDebounce();
    const since = this.config.lastSyncedAt ? Date.now() - this.config.lastSyncedAt : MIN_GAP_MS;
    const wait = Math.max(delay, MIN_GAP_MS - since);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.sync(false).catch(() => undefined);
    }, wait);
    this.debounce.unref();
  }

  private clearDebounce(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
  }

  private async sync(manual: boolean): Promise<void> {
    if (!this.configured()) {
      if (manual) throw new TelegramError("Add a bot token and choose the channel first.");
      return;
    }
    if (!manual && !this.config.enabled) return;
    if (this.syncing) {
      this.queued = true;
      return;
    }
    this.syncing = true;
    try {
      const deck = this.getDeck();
      if (!deck) return;
      const body = digestBody(deck);
      if (!body) {
        this.config.lastError = "No visible slides are tagged for the sponsorship digest.";
        await this.save();
        if (manual) throw new TelegramError(this.config.lastError);
        return;
      }
      const hash = bodyHash(body);
      if (hash !== this.config.lastBodyHash) {
        this.config.lastBodyHash = hash;
        this.config.lastContentAt = Date.now();
      }
      const at = this.config.lastContentAt || Date.now();
      const parts = splitMessage(buildDigest(deck, at));
      const oldIds = [...this.config.messageIds];
      const newIds: number[] = [];

      for (let index = 0; index < parts.length; index += 1) {
        const oldId = oldIds[index];
        if (oldId) {
          try {
            await this.call("editMessageText", {
              chat_id: this.config.chatId,
              message_id: oldId,
              text: parts[index],
              disable_web_page_preview: true,
            });
            newIds.push(oldId);
            continue;
          } catch (error) {
            if (!(error instanceof TelegramError) || !canReplace(error.message)) throw error;
            await this.call("deleteMessage", {
              chat_id: this.config.chatId,
              message_id: oldId,
            }).catch(() => undefined);
          }
        }
        const sent = await this.call<Sent>("sendMessage", {
          chat_id: this.config.chatId,
          text: parts[index],
          disable_notification: true,
          disable_web_page_preview: true,
        });
        if (!sent?.message_id) throw new TelegramError("Telegram did not return a message ID.", 502);
        newIds.push(sent.message_id);
      }

      for (const extra of oldIds.slice(parts.length)) {
        await this.call("deleteMessage", {
          chat_id: this.config.chatId,
          message_id: extra,
        }).catch(() => undefined);
      }

      this.config.messageIds = newIds;
      this.config.lastSyncedAt = Date.now();
      this.config.lastError = "";
      await this.save();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update the Telegram post.";
      this.config.lastError = message;
      await this.save();
      throw error;
    } finally {
      this.syncing = false;
      if (this.queued) {
        this.queued = false;
        if (this.config.enabled) this.scheduleEditSync(500);
      }
    }
  }

  private async call<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
    this.requireToken();
    const response = await fetch(`${API}/bot${this.config.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    }).catch((error: Error) => {
      throw new TelegramError(`Could not reach Telegram: ${error.message}`, 502);
    });
    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; result?: T; description?: string }
      | null;
    if (data?.ok === true) return data.result as T;
    const description = text(data?.description) || `Telegram returned HTTP ${response.status}.`;
    if (/message is not modified/i.test(description)) return undefined as T;
    const status = response.status === 401 ? 400 : response.status === 403 ? 403 : 502;
    throw new TelegramError(description, status);
  }

  private async save(): Promise<void> {
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    await rename(temp, this.file);
    await chmod(this.file, 0o600).catch(() => undefined);
  }
}
