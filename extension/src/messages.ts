// Content script ↔ background worker protocol.
export type BgRequest =
  | { type: "api"; path: string; body?: unknown }
  | { type: "media"; path: string };

export type BgResponse =
  | { ok: true; data: unknown; offline?: boolean }
  | { ok: false; error: string };

export type MediaResponse = { ok: true; base64: string; mime: string } | { ok: false; error: string };

export function api<T>(path: string, body?: unknown): Promise<{ ok: true; data: T; offline?: boolean } | { ok: false; error: string }> {
  return chrome.runtime
    .sendMessage({ type: "api", path, body } satisfies BgRequest)
    .catch((e: unknown) => ({ ok: false as const, error: String(e) }));
}

const blobUrls = new Map<string, string>();

/** Fetches /media/... through the background worker and returns a page-local blob: URL. */
export async function mediaUrl(path: string): Promise<string | null> {
  const hit = blobUrls.get(path);
  if (hit) return hit;
  const res: MediaResponse = await chrome.runtime
    .sendMessage({ type: "media", path } satisfies BgRequest)
    .catch((e: unknown) => ({ ok: false as const, error: String(e) }));
  if (!res?.ok) return null;
  const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: res.mime }));
  blobUrls.set(path, url);
  return url;
}
