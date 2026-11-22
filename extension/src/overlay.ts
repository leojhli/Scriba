// Shadow-DOM overlay over #movie_player: mascot bubble, chips, line buttons (Task 3).
// No innerHTML anywhere: YouTube enforces Trusted Types, so the DOM is built by hand.
import type { Explanation, ShadowResult } from "./shared/types";

export type Line = Explanation["lines"][number];

export type OverlayHandlers = {
  onHear(line: Line, i: number): void;
  onShadowStart(line: Line, i: number): void;
  onShadowStop(line: Line, i: number): void;
};

type Attrs = Record<string, string> & { class?: string };
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(k);
  return el;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: "YouTube Sans", Roboto, system-ui, sans-serif; }
.chips { position: absolute; top: 14px; left: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
.chip { pointer-events: none; padding: 5px 11px; border-radius: 999px; font-size: 13px; font-weight: 600;
  color: #1a1a1a; background: #ffd34d; box-shadow: 0 2px 8px rgba(0,0,0,.35); animation: pop .2s ease-out; }
.chip.offline { background: #e6e6e6; color: #444; }
.bubble { pointer-events: auto; position: absolute; right: 16px; bottom: 68px; width: min(400px, 46%);
  max-height: calc(100% - 100px); overflow: auto; padding: 14px 16px; border-radius: 18px;
  background: rgba(255,255,255,.97); color: #141414; box-shadow: 0 8px 28px rgba(0,0,0,.45);
  font-size: 15px; line-height: 1.4; animation: pop .18s ease-out; }
.head { display: flex; gap: 12px; align-items: flex-start; }
.summary { flex: 1; padding-top: 4px; }
.summary.muted { color: #666; font-style: italic; }
.mascot { flex: none; width: 44px; height: 44px; border-radius: 50% 50% 46% 46%; background: #ff7a59;
  position: relative; box-shadow: inset 0 -5px 0 rgba(0,0,0,.12); }
.mascot .eye { position: absolute; top: 15px; width: 7px; height: 9px; border-radius: 50%; background: #1a1a1a; }
.mascot .eye.l { left: 12px; } .mascot .eye.r { right: 12px; }
.mascot .mouth { position: absolute; left: 50%; bottom: 10px; width: 12px; height: 5px; margin-left: -6px;
  border-radius: 0 0 8px 8px; background: #1a1a1a; }
.mascot.speaking { animation: bounce .45s ease-in-out infinite alternate; }
.mascot.speaking .mouth { height: 8px; }
.mascot.thinking { animation: wobble 1s ease-in-out infinite; }
.lines { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.line { position: relative; padding: 8px 10px; border-radius: 12px; background: #f4f4f4; }
.orig { font-weight: 600; }
.tr { color: #444; font-size: 14px; }
.notes { display: none; margin: 6px 0 0; padding-left: 18px; font-size: 13px; color: #333; }
.line:hover .notes { display: block; }
.hint { font-size: 11px; color: #888; }
.actions { display: flex; gap: 6px; margin-top: 6px; }
button { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
  background: #141414; color: #fff; user-select: none; }
button:hover { background: #333; }
button.rec { background: #d93025; }
.result { margin-top: 6px; font-size: 14px; }
.w { padding: 0 2px; border-radius: 4px; }
.w.ok { background: #c8f0cf; } .w.missed { background: #ffd0cc; text-decoration: line-through; }
.w.wrong { background: #ffe3a3; } .w.extra { color: #888; font-style: italic; }
.score { font-weight: 700; margin-right: 6px; }
@keyframes pop { from { transform: scale(.92); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes bounce { from { transform: translateY(0); } to { transform: translateY(-6px); } }
@keyframes wobble { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
`;

const HOST_ID = "pause-and-effect-root";

export class Overlay {
  private host: HTMLDivElement | null = null;
  private root: ShadowRoot | null = null;
  private chips!: HTMLDivElement;
  private offlineChip: HTMLDivElement | null = null;
  private bubble: HTMLDivElement | null = null;
  private mascot: HTMLDivElement | null = null;
  private results: HTMLDivElement[] = [];
  private shadowBtns: HTMLButtonElement[] = [];

  constructor(private handlers: OverlayHandlers) {}

  private ensure(): ShadowRoot | null {
    const player = document.querySelector<HTMLElement>("#movie_player");
    if (!player) return null;
    if (this.host?.isConnected && this.host.parentElement === player) return this.root;
    document.getElementById(HOST_ID)?.remove();
    this.host = h("div", { id: HOST_ID });
    this.host.style.cssText = "position:absolute;inset:0;z-index:60;pointer-events:none;";
    this.root = this.host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    this.root.adoptedStyleSheets = [sheet];
    this.chips = h("div", { class: "chips" });
    this.root.append(this.chips);
    if (this.offlineChip) this.chips.append(this.offlineChip);
    player.appendChild(this.host);
    return this.root;
  }

  /** Short-lived chip, e.g. "flagged · rewind". */
  chip(text: string, ms = 2000): void {
    if (!this.ensure()) return;
    const c = h("div", { class: "chip" }, text);
    this.chips.append(c);
    setTimeout(() => c.remove(), ms);
  }

  offline(on: boolean): void {
    if (!this.ensure()) return;
    if (on && !this.offlineChip) {
      this.offlineChip = h("div", { class: "chip offline" }, "offline mode");
      this.chips.append(this.offlineChip);
    } else if (!on && this.offlineChip) {
      this.offlineChip.remove();
      this.offlineChip = null;
    }
  }

  private newBubble(): HTMLDivElement | null {
    const root = this.ensure();
    if (!root) return null;
    this.bubble?.remove();
    const b = h("div", { class: "bubble" });
    // Keep clicks from reaching YouTube's player (which would toggle play/pause).
    for (const ev of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "wheel"])
      b.addEventListener(ev, (e) => e.stopPropagation());
    this.mascot = h("div", { class: "mascot" }, h("div", { class: "eye l" }), h("div", { class: "eye r" }), h("div", { class: "mouth" }));
    root.append(b);
    this.bubble = b;
    return b;
  }

  /** Shown immediately on pause, so the overlay is never blank. */
  thinking(text = "thinking…"): void {
    const b = this.newBubble();
    if (!b) return;
    this.mascot!.classList.add("thinking");
    b.append(h("div", { class: "head" }, this.mascot!, h("div", { class: "summary muted" }, text)));
  }

  explanation(e: Explanation, can: { hear(line: Line): boolean; shadow(line: Line): boolean }): void {
    const b = this.newBubble();
    if (!b) return;
    b.append(h("div", { class: "head" }, this.mascot!, h("div", { class: "summary" }, e.summary)));
    this.results = [];
    this.shadowBtns = [];
    if (!e.lines.length) return;
    const list = h("div", { class: "lines" });
    e.lines.forEach((line, i) => {
      const actions = h("div", { class: "actions" });
      if (can.hear(line)) {
        const hear = h("button", { title: "Dialogue only, music removed, at 0.75×" }, "🔊 Hear it clearly");
        hear.addEventListener("click", () => this.handlers.onHear(line, i));
        actions.append(hear);
      }
      if (can.shadow(line)) {
        const sh = h("button", { title: "Hold, say the line, release" }, "🎙 Hold to shadow");
        sh.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          sh.setPointerCapture(ev.pointerId);
          this.handlers.onShadowStart(line, i);
        });
        const stop = () => this.handlers.onShadowStop(line, i);
        sh.addEventListener("pointerup", stop);
        sh.addEventListener("pointercancel", stop);
        actions.append(sh);
        this.shadowBtns[i] = sh;
      }
      const result = h("div", { class: "result" });
      this.results[i] = result;
      list.append(
        h(
          "div",
          { class: "line" },
          h("div", { class: "orig" }, line.original),
          line.translation ? h("div", { class: "tr" }, line.translation) : null,
          line.notes.length ? h("ul", { class: "notes" }, ...line.notes.map((n) => h("li", {}, n))) : null,
          line.notes.length ? h("div", { class: "hint" }, "hover for notes") : null,
          actions.childElementCount ? actions : null,
          result,
        ),
      );
    });
    b.append(list);
  }

  speaking(on: boolean): void {
    this.mascot?.classList.remove("thinking");
    this.mascot?.classList.toggle("speaking", on);
  }

  shadowState(i: number, state: "recording" | "scoring" | "idle"): void {
    const btn = this.shadowBtns[i];
    if (btn) {
      btn.classList.toggle("rec", state === "recording");
      btn.textContent = state === "recording" ? "● Recording… release to score" : "🎙 Hold to shadow";
    }
    if (state === "scoring") this.results[i]?.replaceChildren("scoring…");
  }

  shadowResult(i: number, r: ShadowResult | { error: string }): void {
    const el = this.results[i];
    if (!el) return;
    if ("error" in r) {
      el.replaceChildren(r.error);
      return;
    }
    const pace = r.paceRatio > 1.25 ? "a bit slow" : r.paceRatio < 0.8 ? "a bit fast" : "good pace";
    el.replaceChildren(
      h("span", { class: "score" }, `${Math.round(r.accuracy * 100)}%`),
      ...r.diff.flatMap((d) => [h("span", { class: `w ${d.status}`, title: d.status }, d.word), " "]),
      h("div", { class: "hint" }, `pace ${r.paceRatio.toFixed(2)}× · ${pace}`),
    );
  }

  hideBubble(): void {
    this.bubble?.remove();
    this.bubble = null;
    this.mascot = null;
  }
}
