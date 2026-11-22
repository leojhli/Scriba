// Content script on youtube.com. Task 0: on pause, ping the server via the
// background worker and draw a bubble over #movie_player.
import type { BgRequest, BgResponse } from "./background";

function api(path: string, body?: unknown): Promise<BgResponse> {
  return chrome.runtime.sendMessage({ type: "api", path, body } satisfies BgRequest);
}

const HOST_ID = "pause-and-effect-root";

function showBubble(text: string) {
  const player = document.querySelector<HTMLElement>("#movie_player");
  if (!player) return;
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    // Sit above YouTube's controls; pointer events only on the bubble itself.
    host.style.cssText = "position:absolute;inset:0;z-index:60;pointer-events:none;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .bubble {
          position: absolute; right: 16px; bottom: 64px; max-width: 320px;
          padding: 10px 14px; border-radius: 14px; pointer-events: auto;
          background: #fff; color: #111; font: 15px/1.4 system-ui, sans-serif;
          box-shadow: 0 4px 16px rgba(0,0,0,.35);
        }
      </style>
      <div class="bubble"></div>`;
    player.appendChild(host);
  }
  host.shadowRoot!.querySelector(".bubble")!.textContent = text;
}

function hideBubble() {
  document.getElementById(HOST_ID)?.remove();
}

// Media events don't bubble, but they do go through the capture phase, so a
// document-level capture listener survives YouTube swapping <video> elements.
document.addEventListener(
  "pause",
  async (e) => {
    if (!(e.target instanceof HTMLVideoElement)) return;
    showBubble("thinking…");
    const res = await api("/ext/ping");
    showBubble(res?.ok ? "ping ok" : `ping failed: ${res?.error ?? "no response"}`);
  },
  true,
);

document.addEventListener(
  "play",
  (e) => {
    if (e.target instanceof HTMLVideoElement) hideBubble();
  },
  true,
);
