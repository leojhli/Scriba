// Background service worker: the only place that talks to the Wasp server.
// host_permissions on localhost:3001 means no CORS setup is needed.
import { DEMO_KEY, REQUEST_TIMEOUT_MS, SERVER_URL } from "./shared/config";

export type BgRequest = { type: "api"; path: string; body?: unknown };
export type BgResponse = { ok: true; data: unknown } | { ok: false; error: string };

async function callApi(path: string, body: unknown = {}): Promise<unknown> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-key": DEMO_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  if (msg?.type !== "api") return false;
  callApi(msg.path, msg.body)
    .then((data) => sendResponse({ ok: true, data } satisfies BgResponse))
    .catch((e: unknown) => {
      console.warn("[P&E] api error", msg.path, e);
      sendResponse({ ok: false, error: String(e) } satisfies BgResponse);
    });
  return true; // keep the channel open for the async response
});
