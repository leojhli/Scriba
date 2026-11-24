// Background service worker: the only place that talks to the Wasp server.
// host_permissions on localhost:3001 means no CORS setup is needed.
// Every call has a timeout; explain/session fall back to chrome.storage caches (Task 8).
import { loadEnabled, onEnabledChange } from "./enabled";
import type { BgRequest, BgResponse, MediaResponse } from "./messages";
import { DEMO_KEY, EXPLAIN_TIMEOUT_MS, MEDIA_TIMEOUT_MS, REQUEST_TIMEOUT_MS, SERVER_URL, SHADOW_TIMEOUT_MS } from "./shared/config";
import type { Explanation } from "./shared/types";

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-key": DEMO_KEY },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(
      path === "/ext/shadow"
        ? SHADOW_TIMEOUT_MS
        : path === "/ext/explain" || path === "/ext/explain-rest"
          ? EXPLAIN_TIMEOUT_MS
          : REQUEST_TIMEOUT_MS,
    ),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

const store = {
  async get<T>(key: string): Promise<T | undefined> {
    return (await chrome.storage.local.get(key))[key] as T | undefined;
  },
  set(key: string, value: unknown) {
    return chrome.storage.local.set({ [key]: value });
  },
};

type ExplainBody = { videoId: string; t: number };
type ExplainCache = Record<string, Explanation>;

async function cacheExplain(body: ExplainBody, e: Explanation) {
  const key = `explain:${body.videoId}`;
  const cache = (await store.get<ExplainCache>(key)) ?? {};
  cache[String(Math.round(body.t))] = e;
  await store.set(key, cache);
  if (e.audioUrl) void fetchMedia(e.audioUrl).catch(() => {}); // warm the audio cache too
}

async function nearestExplain(body: ExplainBody): Promise<Explanation | null> {
  const cache = (await store.get<ExplainCache>(`explain:${body.videoId}`)) ?? {};
  let best: { d: number; e: Explanation } | null = null;
  for (const [k, e] of Object.entries(cache)) {
    const d = Math.abs(Number(k) - body.t);
    // Same moment only: the voice explains the line just said, so a cache from 30 s away would be wrong.
    if (d <= 3 && (!best || d < best.d)) best = { d, e };
  }
  return best?.e ?? null;
}

async function callApi(path: string, body: unknown): Promise<BgResponse> {
  try {
    const data = await post(path, body);
    // A voice-first (`partial`) answer isn't cached; the full one from /ext/explain-rest is.
    if ((path === "/ext/explain" && !(data as Explanation).partial) || path === "/ext/explain-rest")
      await cacheExplain(body as ExplainBody, data as Explanation);
    if (path === "/ext/session" && (data as { status?: string }).status === "ready")
      await store.set(`session:${(body as { videoId: string }).videoId}`, data);
    return { ok: true, data };
  } catch (e) {
    console.warn("[P&E] api error", path, e);
    if (path === "/ext/explain") {
      const cached = await nearestExplain(body as ExplainBody);
      if (cached) return { ok: true, data: { ...cached, offline: true }, offline: true };
    }
    if (path === "/ext/session") {
      const cached = await store.get(`session:${(body as { videoId: string }).videoId}`);
      if (cached) return { ok: true, data: cached, offline: true };
    }
    return { ok: false, error: String(e) };
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Service workers can't make blob: URLs, so media goes to the content script as base64. */
async function fetchMedia(path: string): Promise<MediaResponse> {
  const key = `media:${path}`;
  try {
    const res = await fetch(`${SERVER_URL}${path}`, { signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    const out = { ok: true as const, base64: toBase64(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "audio/mpeg" };
    await store.set(key, out);
    return out;
  } catch (e) {
    const cached = await store.get<MediaResponse>(key);
    return cached ?? { ok: false, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  if (msg?.type === "api") {
    callApi(msg.path, msg.body).then(sendResponse);
    return true; // async response
  }
  if (msg?.type === "media") {
    fetchMedia(msg.path).then(sendResponse);
    return true;
  }
  return false;
});

// The toolbar button opens the popup (popup.html): the on/off switch plus links to the deck.
// While Scriba is off, the icon wears an "off" badge so you can tell at a glance.
function showEnabled(on: boolean): void {
  void chrome.action.setBadgeText({ text: on ? "" : "off" });
  void chrome.action.setBadgeBackgroundColor({ color: "#6f6158" });
  void chrome.action.setTitle({ title: on ? "Scriba · on" : "Scriba · off" });
}
void loadEnabled().then(showEnabled);
onEnabledChange(showEnabled);
