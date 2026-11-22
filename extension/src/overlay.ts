// Shadow-DOM overlay over #movie_player: cinematic scrim + glass side panel with the mascot,
// lines, "Hear it clearly" and hold-to-shadow (Task 3).
// No innerHTML anywhere: YouTube enforces Trusted Types, so the DOM (and SVG) is built by hand.
import type { Explanation, ShadowResult } from "./shared/types";
import { nextVoiceRate, rateLabel } from "./voiceRate";

export type Line = Explanation["lines"][number];

export type OverlayHandlers = {
  onHear(line: Line, i: number): void;
  onShadowStart(line: Line, i: number): void;
  onShadowStop(line: Line, i: number): void;
  onClose(): void;
  onVoiceRate(rate: number): void;
};

type Kid = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k) el.append(k);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS: Record<string, string> = {
  headphones: "M3 14v-2a9 9 0 0 1 18 0v2M3 14a2 2 0 0 1 2-2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2v-4Zm18 0a2 2 0 0 0-2-2h-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2v-4Z",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm7 9a7 7 0 0 1-14 0m7 7v3",
  close: "M6 6l12 12M18 6L6 18",
  gauge: "m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0",
  wifiOff: "M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.2-1.6M12 20h.01",
};
function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "ico");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", ICONS[name]);
  svg.append(p);
  return svg;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; }
.wrap { position: absolute; inset: 0; container-type: size; pointer-events: none;
  font-family: "YouTube Sans", Roboto, "Segoe UI", system-ui, sans-serif; color: #fff;
  --accent: #ff8a5c; --accent-2: #ffb36b; --glass: rgba(18, 18, 24, .72); --line: rgba(255,255,255,.1);
  --muted: rgba(255,255,255,.66); --fs: clamp(13px, 1.45cqw, 19px); }

/* Cinematic scrim behind the panel */
.scrim { position: absolute; inset: 0; opacity: 0; transition: opacity .35s ease;
  background: linear-gradient(270deg, rgba(0,0,0,.72) 0%, rgba(0,0,0,.35) 42%, rgba(0,0,0,0) 70%),
              linear-gradient(0deg, rgba(0,0,0,.35), rgba(0,0,0,0) 30%); }
.scrim.on { opacity: 1; }

/* Glass side panel */
.panel { pointer-events: auto; position: absolute; top: clamp(10px, 2cqh, 22px); right: clamp(10px, 1.6cqw, 22px);
  bottom: clamp(56px, 9cqh, 76px); width: clamp(300px, 36cqw, 500px); display: flex; flex-direction: column;
  background: var(--glass); backdrop-filter: blur(22px) saturate(1.4); -webkit-backdrop-filter: blur(22px) saturate(1.4);
  border: 1px solid rgba(255,255,255,.14); border-radius: 22px; box-shadow: 0 24px 60px rgba(0,0,0,.5);
  font-size: var(--fs); line-height: 1.4; overflow: hidden;
  transform: translateX(24px); opacity: 0; transition: transform .35s cubic-bezier(.2,.8,.2,1), opacity .25s ease; }
.panel.on { transform: none; opacity: 1; }
@container (max-width: 640px) {
  .panel { left: 10px; right: 10px; width: auto; top: auto; max-height: 64cqh; transform: translateY(24px); }
  .scrim { background: linear-gradient(0deg, rgba(0,0,0,.75), rgba(0,0,0,0) 75%); }
}

.top { display: flex; gap: .85em; align-items: center; padding: 1em 1.1em .85em; border-bottom: 1px solid var(--line); }
.who { flex: 1; min-width: 0; }
.name { font-weight: 700; font-size: .95em; letter-spacing: .01em; display: flex; align-items: center; gap: .5em; }
.when { color: var(--muted); font-size: .8em; font-weight: 500; }
.x { all: unset; cursor: pointer; width: 2em; height: 2em; display: grid; place-items: center; border-radius: 50%;
  color: var(--muted); transition: background .15s, color .15s; }
.x:hover { background: rgba(255,255,255,.12); color: #fff; }
/* Voice speed pill (header) */
.speed { all: unset; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: .3em; padding: .35em .7em;
  border-radius: 999px; font-size: .78em; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap;
  background: rgba(255,255,255,.1); color: rgba(255,255,255,.88); transition: background .15s, color .15s, transform .1s; }
.speed:hover { background: rgba(255,255,255,.2); color: #fff; }
.speed:active { transform: scale(.95); }
.speed:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.speed.custom { color: var(--accent-2); }
.speed.changed { animation: pop .3s ease-out; }

/* Mascot */
.mascot { position: relative; flex: none; width: 3em; height: 3em; border-radius: 46% 46% 42% 42%;
  background: radial-gradient(circle at 32% 28%, #ffd2a8 0 18%, transparent 19%), linear-gradient(160deg, var(--accent-2), var(--accent) 55%, #f0604a);
  box-shadow: 0 6px 18px rgba(255,120,80,.45), inset 0 -4px 0 rgba(0,0,0,.12); }
.mascot .eye { position: absolute; top: 38%; width: 13%; height: 19%; border-radius: 50%; background: #1d1220;
  animation: blink 4.2s infinite; transform-origin: center; }
.mascot .eye.l { left: 28%; } .mascot .eye.r { right: 28%; }
.mascot .mouth { position: absolute; left: 50%; bottom: 20%; width: 22%; height: 9%; transform: translateX(-50%);
  border-radius: 0 0 1em 1em; background: #1d1220; transition: height .1s; }
.mascot.speaking { animation: bob .5s ease-in-out infinite alternate; }
.mascot.speaking .mouth { animation: talk .22s ease-in-out infinite alternate; }
.mascot.thinking { animation: tilt 1.1s ease-in-out infinite; }
.wave { display: none; gap: 2px; align-items: center; height: 1em; }
.wave i { display: block; width: 3px; border-radius: 2px; background: var(--accent); animation: wave .9s ease-in-out infinite; }
.wave i:nth-child(2) { animation-delay: .15s } .wave i:nth-child(3) { animation-delay: .3s } .wave i:nth-child(4) { animation-delay: .45s }
.speaking-on .wave { display: inline-flex; }

.body { overflow: auto; padding: .9em 1.1em 1.1em; display: flex; flex-direction: column; gap: .8em;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.25) transparent; }
.summary { font-size: 1.02em; color: #fff; }
.summary.muted { color: var(--muted); font-style: italic; }

/* Skeleton while thinking */
.sk { height: .9em; border-radius: 6px; background: linear-gradient(90deg, rgba(255,255,255,.07), rgba(255,255,255,.18), rgba(255,255,255,.07));
  background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
.sk.w80 { width: 80% } .sk.w60 { width: 60% } .sk.w90 { width: 90% }
.skcard { padding: .9em; border-radius: 14px; background: rgba(255,255,255,.05); display: flex; flex-direction: column; gap: .55em; }

/* Line cards */
.card { padding: .85em .95em; border-radius: 16px; background: rgba(255,255,255,.06); border: 1px solid var(--line);
  display: flex; flex-direction: column; gap: .45em; animation: rise .35s cubic-bezier(.2,.8,.2,1) both; }
.card.latest { background: rgba(255,138,92,.12); border-color: rgba(255,138,92,.35); }
.es { font-size: 1.22em; font-weight: 700; line-height: 1.3; letter-spacing: -.005em; }
.rom { color: #ffc9a8; font-size: .98em; font-weight: 500; letter-spacing: .01em; margin-top: -.15em; }
.en { color: var(--muted); }
.notes { display: flex; flex-wrap: wrap; gap: .35em; }
.notes.folded { display: none; }
.tag { align-self: flex-start; font-size: .68em; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  color: var(--accent-2); }
.more { all: unset; cursor: pointer; padding: .5em .4em; font-size: .78em; font-weight: 600; color: var(--muted); }
.more:hover { color: #fff; }
.note { font-size: .78em; padding: .3em .65em; border-radius: 999px; background: rgba(255,255,255,.09); color: rgba(255,255,255,.86); }
.actions { display: flex; gap: .45em; flex-wrap: wrap; margin-top: .15em; }
.btn { all: unset; cursor: pointer; user-select: none; display: inline-flex; align-items: center; gap: .45em;
  padding: .5em .9em; border-radius: 999px; font-size: .84em; font-weight: 650;
  background: rgba(255,255,255,.12); color: #fff; transition: background .15s, transform .1s; }
.btn:hover { background: rgba(255,255,255,.2); }
.btn:active { transform: scale(.97); }
.btn.primary { background: linear-gradient(135deg, var(--accent-2), var(--accent)); color: #1b0f0a; }
.btn.primary:hover { filter: brightness(1.06); }
.btn.playing { background: rgba(255,255,255,.92); color: #111; }
.btn.rec { background: #ff3b30; color: #fff; box-shadow: 0 0 0 0 rgba(255,59,48,.6); animation: pulse 1.2s infinite; }
.ico { width: 1.15em; height: 1.15em; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

/* Shadowing result */
.result:empty { display: none; }
.result { display: flex; gap: .8em; align-items: center; padding-top: .35em; }
.ring { flex: none; width: 3.1em; height: 3.1em; border-radius: 50%; display: grid; place-items: center;
  background: conic-gradient(var(--c) calc(var(--p) * 1%), rgba(255,255,255,.12) 0); }
.ring span { width: 2.45em; height: 2.45em; border-radius: 50%; display: grid; place-items: center; background: #1b1b22;
  font-weight: 800; font-size: .82em; }
.words { display: flex; flex-wrap: wrap; gap: .25em; }
.w { padding: .1em .4em; border-radius: 6px; font-weight: 600; font-size: .92em; }
.w.ok { background: rgba(52,199,89,.22); color: #b5f5c4; }
.w.missed { background: rgba(255,69,58,.2); color: #ffb3ad; text-decoration: line-through; }
.w.wrong { background: rgba(255,204,0,.2); color: #ffe48a; }
.w.extra { color: var(--muted); font-style: italic; }
.pace { color: var(--muted); font-size: .78em; margin-top: .2em; }
.status { color: var(--muted); font-size: .85em; }

/* Chips (top-left) */
.chips { position: absolute; top: clamp(10px, 2cqh, 22px); left: clamp(10px, 1.6cqw, 22px); display: flex; gap: 8px; }
.chip { display: inline-flex; align-items: center; gap: .4em; padding: .4em .8em; border-radius: 999px; font-size: 13px; font-weight: 650;
  background: rgba(18,18,24,.75); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,.14); animation: rise .25s ease-out both; }
.chip.offline, .chip.warn { color: #ffd27a; }
.chip.ok { color: #b5f5c4; }
.spin { width: .85em; height: .85em; border-radius: 50%; border: 2px solid rgba(255,255,255,.25);
  border-top-color: var(--accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@keyframes blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
@keyframes bob { from { transform: translateY(0) rotate(-2deg); } to { transform: translateY(-4px) rotate(2deg); } }
@keyframes talk { from { height: 6%; } to { height: 16%; } }
@keyframes tilt { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
@keyframes wave { 0%, 100% { height: 25%; } 50% { height: 100%; } }
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@keyframes rise { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes pop { 50% { transform: scale(1.12); background: rgba(255,138,92,.35); } }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255,59,48,.55); } 100% { box-shadow: 0 0 0 12px rgba(255,59,48,0); } }
`;

const HOST_ID = "pause-and-effect-root";

export class Overlay {
  private host: HTMLDivElement | null = null;
  private wrap!: HTMLDivElement;
  private scrim!: HTMLDivElement;
  private chips!: HTMLDivElement;
  private offlineChip: HTMLDivElement | null = null;
  private statusChip: HTMLDivElement | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private panel: HTMLDivElement | null = null;
  private mascot: HTMLDivElement | null = null;
  private top: HTMLDivElement | null = null;
  private speedBtn: HTMLButtonElement | null = null;
  private voiceRate = 1;
  private results: HTMLDivElement[] = [];
  private shadowBtns: HTMLButtonElement[] = [];
  private hearBtns: HTMLButtonElement[] = [];
  private recTimer: ReturnType<typeof setInterval> | undefined;
  private hidden = false;

  constructor(private handlers: OverlayHandlers) {}

  private ensure(): boolean {
    const player = document.querySelector<HTMLElement>("#movie_player");
    if (!player) return false;
    if (this.host?.isConnected && this.host.parentElement === player) return true;
    document.getElementById(HOST_ID)?.remove();
    this.host = h("div");
    this.host.id = HOST_ID;
    // z-index 59 keeps us under YouTube's own control bar and settings menus (60+).
    this.host.style.cssText = "position:absolute;inset:0;z-index:59;pointer-events:none;";
    this.host.style.display = this.hidden ? "none" : "";
    const root = this.host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    this.wrap = h("div", "wrap");
    this.scrim = h("div", "scrim");
    this.chips = h("div", "chips");
    this.wrap.append(this.scrim, this.chips);
    if (this.statusChip) this.chips.append(this.statusChip);
    if (this.offlineChip) this.chips.append(this.offlineChip);
    root.append(this.wrap);
    player.appendChild(this.host);
    this.panel = null;
    return true;
  }

  /** Hides everything (panel and chips), e.g. while an ad plays. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (this.host) this.host.style.display = hidden ? "none" : "";
  }

  chip(text: string, ms = 2200): void {
    if (!this.ensure()) return;
    const c = h("div", "chip", text);
    this.chips.append(c);
    setTimeout(() => c.remove(), ms);
  }

  /** Processing / ready chip. `ms` auto-hides it; null clears it. */
  status(text: string | null, kind: "busy" | "ok" | "warn" = "busy", ms = 0): void {
    clearTimeout(this.statusTimer);
    this.statusChip?.remove();
    this.statusChip = null;
    if (!text || !this.ensure()) return;
    const c = h("div", `chip ${kind}`, kind === "busy" && h("span", "spin"), text);
    this.statusChip = c;
    this.chips.prepend(c);
    if (ms) this.statusTimer = setTimeout(() => this.status(null), ms);
  }

  offline(on: boolean): void {
    if (!this.ensure()) return;
    if (on && !this.offlineChip) {
      this.offlineChip = h("div", "chip offline", icon("wifiOff"), "offline mode");
      this.chips.append(this.offlineChip);
    } else if (!on && this.offlineChip) {
      this.offlineChip.remove();
      this.offlineChip = null;
    }
  }

  private newPanel(t: number | null): HTMLDivElement | null {
    if (!this.ensure()) return null;
    this.panel?.remove();
    clearInterval(this.recTimer);
    const p = h("div", "panel");
    // Keep clicks and keys from reaching YouTube's player (which would toggle play/pause).
    for (const ev of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "wheel", "contextmenu"])
      p.addEventListener(ev, (e) => e.stopPropagation());

    this.mascot = h("div", "mascot", h("div", "eye l"), h("div", "eye r"), h("div", "mouth"));
    const wave = h("span", "wave", h("i"), h("i"), h("i"), h("i"));
    const close = h("button", "x", icon("close"));
    close.title = "Close (or press play)";
    close.addEventListener("click", () => this.handlers.onClose());
    const speed = h("button", "speed");
    speed.title = "Voice speed · click to change";
    speed.addEventListener("click", () => this.handlers.onVoiceRate(nextVoiceRate(this.voiceRate)));
    this.fillSpeed(speed);
    this.speedBtn = speed;
    this.top = h(
      "div",
      "top",
      this.mascot,
      h("div", "who", h("div", "name", "Pausa", wave), h("div", "when", t === null ? "" : `Paused at ${fmt(t)}`)),
      speed,
      close,
    );
    p.append(this.top);
    this.wrap.append(p);
    this.panel = p;
    this.results = [];
    this.shadowBtns = [];
    this.hearBtns = [];
    requestAnimationFrame(() => {
      p.classList.add("on");
      this.scrim.classList.add("on");
    });
    return p;
  }

  /** Shown immediately on pause, so the overlay is never blank. */
  thinking(t: number | null = null): void {
    const p = this.newPanel(t);
    if (!p) return;
    this.mascot!.classList.add("thinking");
    const skel = () => h("div", "skcard", h("div", "sk w80"), h("div", "sk w60"));
    p.append(h("div", "body", h("div", "summary muted", "Thinking about what was just said…"), skel(), skel()));
  }

  explanation(e: Explanation, can: { hear(line: Line): boolean; shadow(line: Line): boolean }, t: number | null = null): void {
    const p = this.newPanel(t);
    if (!p) return;
    const body = h("div", "body", h("div", e.lines.length ? "summary" : "summary muted", e.summary));
    const cards: HTMLDivElement[] = [];
    e.lines.forEach((line, i) => {
      const actions = h("div", "actions");
      if (can.hear(line)) {
        const hear = h("button", "btn", icon("headphones"), "Hear it clearly");
        hear.title = "Just the voice, music removed, at 0.75×";
        hear.addEventListener("click", () => this.handlers.onHear(line, i));
        actions.append(hear);
        this.hearBtns[i] = hear;
      }
      if (can.shadow(line)) {
        const sh = h("button", "btn primary", icon("mic"), "Hold to shadow");
        sh.title = "Hold, say the line, release to get scored";
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
      const result = h("div", "result");
      this.results[i] = result;
      const latest = i === e.lines.length - 1;
      // Notes are open on the line you most likely paused for; folded on the earlier ones.
      const notes = line.notes.length > 0 ? h("div", latest ? "notes" : "notes folded", ...line.notes.map((n) => h("span", "note", n))) : null;
      if (notes && !latest) {
        const more = h("button", "more", `Notes (${line.notes.length})`);
        more.addEventListener("click", () => {
          notes.classList.toggle("folded");
          more.textContent = notes.classList.contains("folded") ? `Notes (${line.notes.length})` : "Hide notes";
        });
        actions.append(more);
      }
      const card = h(
        "div",
        latest ? "card latest" : "card",
        latest && h("div", "tag", "Just said"),
        h("div", "es", line.original),
        line.romanization && h("div", "rom", line.romanization),
        line.translation && h("div", "en", line.translation),
        notes,
        actions.childElementCount > 0 && actions,
        result,
      );
      cards.push(card);
    });
    // Newest first: the line you paused for sits right under the summary.
    cards.reverse().forEach((c, k) => {
      c.style.animationDelay = `${k * 60}ms`;
      body.append(c);
    });
    p.append(body);
  }

  /** The speed shown in the header pill. Pops when it changes. */
  setVoiceRate(rate: number): void {
    const changed = rate !== this.voiceRate;
    this.voiceRate = rate;
    if (this.speedBtn) this.fillSpeed(this.speedBtn, changed);
  }

  private fillSpeed(b: HTMLButtonElement, pop = false): void {
    b.replaceChildren(icon("gauge"), rateLabel(this.voiceRate));
    b.classList.toggle("custom", this.voiceRate !== 1);
    b.setAttribute("aria-label", `Voice speed ${rateLabel(this.voiceRate)}`);
    if (pop) {
      b.classList.remove("changed");
      void b.offsetWidth; // restart the animation
      b.classList.add("changed");
    }
  }

  speaking(on: boolean): void {
    this.mascot?.classList.remove("thinking");
    this.mascot?.classList.toggle("speaking", on);
    this.top?.classList.toggle("speaking-on", on);
  }

  hearing(i: number, on: boolean): void {
    const b = this.hearBtns[i];
    if (!b) return;
    b.classList.toggle("playing", on);
    b.replaceChildren(icon("headphones"), on ? "Playing… 0.75×" : "Hear it clearly");
  }

  shadowState(i: number, state: "recording" | "scoring" | "idle"): void {
    const btn = this.shadowBtns[i];
    clearInterval(this.recTimer);
    if (btn) {
      btn.classList.toggle("rec", state === "recording");
      btn.classList.toggle("primary", state !== "recording");
      if (state === "recording") {
        const t0 = performance.now();
        const label = () => btn.replaceChildren(icon("mic"), `Recording ${((performance.now() - t0) / 1000).toFixed(1)}s · release`);
        label();
        this.recTimer = setInterval(label, 100);
      } else {
        btn.replaceChildren(icon("mic"), "Hold to shadow");
      }
    }
    if (state === "scoring") this.results[i]?.replaceChildren(h("div", "status", "Listening to you…"));
  }

  shadowResult(i: number, r: ShadowResult | { error: string }): void {
    const el = this.results[i];
    if (!el) return;
    if ("error" in r) {
      el.replaceChildren(h("div", "status", r.error));
      return;
    }
    const pct = Math.round(r.accuracy * 100);
    const color = pct >= 80 ? "#34c759" : pct >= 50 ? "#ffcc00" : "#ff453a";
    const ring = h("div", "ring", h("span", "", `${pct}%`));
    ring.style.setProperty("--p", String(pct));
    ring.style.setProperty("--c", color);
    const pace = r.paceRatio > 1.25 ? "a little slow" : r.paceRatio < 0.8 ? "a little fast" : "great pace";
    el.replaceChildren(
      ring,
      h(
        "div",
        "",
        h("div", "words", ...r.diff.map((d) => {
          const w = h("span", `w ${d.status}`, d.word);
          w.title = d.status;
          return w;
        })),
        h("div", "pace", `Pace ${r.paceRatio.toFixed(2)}× · ${pace}`),
      ),
    );
  }

  hideBubble(): void {
    clearInterval(this.recTimer);
    const p = this.panel;
    this.panel = null;
    this.mascot = null;
    this.top = null;
    this.speedBtn = null;
    this.scrim?.classList.remove("on");
    if (p) {
      p.classList.remove("on");
      setTimeout(() => p.remove(), 300);
    }
  }
}
