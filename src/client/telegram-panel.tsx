import { useCallback, useEffect, useState } from "react";
import { digestTimestamp } from "../shared/digest";
import type { TelegramStatus } from "../shared/types";

async function request(url: string, init?: RequestInit): Promise<TelegramStatus> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => null)) as (TelegramStatus & { error?: string }) | null;
  if (!response.ok) throw new Error(data?.error || "The digest service did not answer.");
  if (!data) throw new Error("The digest service did not answer.");
  return data;
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function TelegramPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const apply = useCallback((next: TelegramStatus) => {
    setStatus(next);
    setChatId(next.chatId);
    setEnabled(next.enabled);
    setToken("");
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      apply(await request("/api/telegram"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the digest settings.");
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = useCallback(async () => {
    const body: Record<string, unknown> = { enabled, chatId };
    if (token.trim()) body.token = token.trim();
    return request("/api/telegram", json("PUT", body));
  }, [chatId, enabled, token]);

  const run = async (label: string, task: () => Promise<TelegramStatus>, done: string) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      apply(await task());
      setNotice(done);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy("");
    }
  };

  const saveToken = async () => {
    if (!token.trim()) return;
    await request("/api/telegram", json("PUT", { token: token.trim() }));
  };

  const save = () =>
    run(
      "Saving",
      saveSettings,
      enabled ? "Saved. The post updates after five minutes of quiet, or after 45 minutes of continuous editing." : "Saved.",
    );

  const discover = () =>
    run(
      "Finding the channel",
      async () => {
        await saveToken();
        const found = await request("/api/telegram/discover", { method: "POST" });
        return enabled ? request("/api/telegram", json("PUT", { enabled: true })) : found;
      },
      "Channel found. It will be updated in place.",
    );

  const checkChannel = () =>
    run(
      "Checking the channel",
      async () => {
        await saveToken();
        const found = await request("/api/telegram/channel", json("POST", { chat: chatId }));
        return enabled ? request("/api/telegram", json("PUT", { enabled: true })) : found;
      },
      "Channel confirmed.",
    );

  const syncNow = () =>
    run(
      "Updating the post",
      async () => {
        await saveSettings();
        return request("/api/telegram/sync", { method: "POST" });
      },
      "The channel post is up to date.",
    );

  return (
    <div className="sheet-back" role="presentation" onClick={onClose}>
      <div
        className="sheet telegram-sheet"
        role="dialog"
        aria-labelledby="telegram-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <h2 id="telegram-title">Sponsorship digest</h2>
            <p className="hint">A text-only post of the live deck&apos;s tagged sponsor slides.</p>
          </div>
          <button type="button" className="tool" onClick={onClose}>
            Close
          </button>
        </div>

        {error ? <p className="sheet-error">{error}</p> : null}
        {notice ? <p className="sheet-note">{notice}</p> : null}
        {busy ? <p className="sheet-note">{busy}…</p> : null}

        <button
          type="button"
          className={enabled ? "switch is-on" : "switch"}
          aria-pressed={enabled}
          onClick={() => setEnabled((current) => !current)}
        >
          <span className="switch-track">
            <span className="switch-knob" />
          </span>
          <span>Automatic updates</span>
        </button>

        <label className="field">
          <span>Bot token</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            placeholder={status?.tokenSet ? "Saved — leave blank to keep it" : "123456:ABC…"}
            onChange={(event) => setToken(event.currentTarget.value)}
          />
        </label>
        <label className="field">
          <span>Channel</span>
          <input
            value={chatId}
            spellCheck={false}
            placeholder="-100… or @channel"
            onChange={(event) => setChatId(event.currentTarget.value)}
          />
        </label>

        <div className="telegram-pick">
          <button type="button" className="tool" disabled={Boolean(busy)} onClick={() => void discover()}>
            Find from recent post
          </button>
          <button type="button" className="tool" disabled={Boolean(busy) || !chatId.trim()} onClick={() => void checkChannel()}>
            Check channel
          </button>
        </div>
        <p className="hint">
          Add the bot as a channel administrator with Post Messages, then post once in the channel. Telegram only
          lets a bot edit its own message.
        </p>

        <div className="telegram-state">
          <p>
            <span>Channel</span>
            <strong>{status?.chatTitle || status?.chatId || "Not chosen"}</strong>
          </p>
          <p>
            <span>Token</span>
            <strong>{status?.tokenSet ? "Saved on the server" : "Not set"}</strong>
          </p>
          <p>
            <span>Tagged slides</span>
            <strong>
              {status ? `${status.tagged} of ${status.visible} visible` : "—"}
            </strong>
          </p>
          <p>
            <span>Post</span>
            <strong>
              {status?.messageCount
                ? `${status.messageCount} message${status.messageCount === 1 ? "" : "s"}`
                : "Not posted yet"}
            </strong>
          </p>
          <p>
            <span>Last sent</span>
            <strong>{status?.lastSyncedAt ? digestTimestamp(status.lastSyncedAt) : "Never"}</strong>
          </p>
          <p>
            <span>Next update</span>
            <strong>
              {status?.nextRunAt
                ? digestTimestamp(status.nextRunAt)
                : status?.enabled
                  ? "Waiting for edits"
                  : "Off"}
            </strong>
          </p>
        </div>
        <p className="hint">
          After a tagged slide changes, the post updates once the text has been quiet for five minutes. If
          editing continues, it refreshes after 45 minutes without an update. Only changed text is sent;
          there is no fixed weekday schedule.
        </p>
        {status?.lastError ? <p className="sheet-error">Last error: {status.lastError}</p> : null}

        <div className="digest-head">
          <h3>Preview</h3>
          <button type="button" className="tool" onClick={() => void load()} disabled={Boolean(busy)}>
            Refresh
          </button>
        </div>
        <pre className="digest-preview">
          {status?.digest || "No visible slides are tagged. Tag one in the Slide panel."}
        </pre>

        <div className="telegram-actions">
          <button type="button" className="tool" disabled={Boolean(busy)} onClick={() => void save()}>
            Save
          </button>
          <button
            type="button"
            className="fill-button"
            disabled={Boolean(busy) || !status?.tokenSet || !chatId.trim()}
            onClick={() => void syncNow()}
          >
            Sync now
          </button>
        </div>
      </div>
    </div>
  );
}
