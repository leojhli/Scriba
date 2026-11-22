// Scriba's UI: one shadow-DOM host over #movie_player holding
// - chips: small status stickers in the top-left ("Ready · pause anytime");
// - stage: the translucent overlay that opens on pause, just over the video. Scriba Inu with a
//   speech bubble, the line you paused on, and a faint three.js paper-scrap field
//   (fx.ts, loaded on first open). It sits under YouTube's control bar, and clicking the frosted
//   background reaches the video like any click on the player, so it resumes playback.
// No innerHTML anywhere: YouTube enforces Trusted Types, so the DOM (and SVG) is built by hand.
import { WEB_URL } from "./shared/config";
import type { Explanation, ShadowResult } from "./shared/types";
import { nextVoiceRate, rateLabel } from "./voiceRate";
import type { Fx } from "./fx";

export type Line = Explanation["lines"][number];

export type OverlayHandlers = {
  onHear(line: Line, i: number): void;
  onShadowStart(line: Line, i: number): void;
  onShadowStop(line: Line, i: number): void;
  onClose(): void;
  onResume(): void;
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
const ICONS = {
  headphones: "M3 14v-2a9 9 0 0 1 18 0v2M3 14a2 2 0 0 1 2-2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2v-4Zm18 0a2 2 0 0 0-2-2h-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2v-4Z",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm7 9a7 7 0 0 1-14 0m7 7v3",
  close: "M6 6l12 12M18 6L6 18",
  wifiOff: "M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.2-1.6M12 20h.01",
  gauge: "m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0",
  play: "M7 4.5v15l12.5-7.5z",
  deck: "M5 4h11a2 2 0 0 1 2 2v14l-7.5-4L3 20V6a2 2 0 0 1 2-2Z",
  star: "m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 16.9 6.6 19.8l1-6.1-4.4-4.3 6.1-.8Z",
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
const MASCOT = () => chrome.runtime.getURL("assets/scriba-inu.png");
const NON_LATIN = /(?!\p{Script=Latin})\p{L}/u;

/** What floats on the paper scraps: the line's characters (CJK etc.) or its words (Latin). */
function glyphsFor(lines: Line[]): string[] {
  const out = new Set<string>();
  for (const l of [...lines].reverse()) {
    const parts = NON_LATIN.test(l.original) ? l.original.match(/\p{L}/gu) : l.original.toLowerCase().match(/\p{L}{3,}/gu);
    for (const p of parts ?? []) out.add(p);
    if (out.size >= 12) break;
  }
  return [...out].slice(0, 12);
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.wrap { position: absolute; inset: 0; container-type: size; pointer-events: none;
  --ink: #2b2420; --card: rgba(255,253,248,.9); --shiba: #ffa33c; --shiba-deep: #f08a1c; --ribbon: #d6533a; --muted: #6f6158;
  --round: "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "PingFang SC", "Apple SD Gothic Neo", system-ui, sans-serif;
  --text: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans", "Apple SD Gothic Neo", sans-serif;
  font-family: var(--text); font-size: clamp(12px, 1.45cqw, 19px); line-height: 1.45; color: var(--ink); }

/* Stage: frosted, translucent, only over the video */
.stage { position: absolute; inset: 0; opacity: 0; visibility: hidden; transition: opacity .25s ease, visibility 0s linear .25s; }
.stage.on { opacity: 1; visibility: visible; transition: opacity .25s ease; }
.veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(255,246,234,.66), rgba(255,240,224,.52));
  backdrop-filter: blur(7px) saturate(1.1); -webkit-backdrop-filter: blur(7px) saturate(1.1); }
canvas.fx { position: absolute; inset: 0; width: 100%; height: 100%; }

.top { position: absolute; top: 3.4cqh; left: 3cqw; right: 3cqw; display: flex; align-items: center; justify-content: space-between; gap: 1em; }
.brand { display: flex; align-items: center; gap: .5em; min-width: 0; font-family: var(--round); }
.brand img { width: 1.9em; height: auto; flex: none; }
.when { font-family: var(--text); color: var(--muted); font-size: .82em; font-weight: 600; white-space: nowrap; }
.tools { display: flex; align-items: center; gap: .4em; flex: none; pointer-events: auto; }
.offline-tag { font-family: var(--round); font-size: .74em; color: var(--ribbon); }

.btn { all: unset; cursor: pointer; user-select: none; display: inline-flex; align-items: center; gap: .4em; white-space: nowrap;
  font-family: var(--round); font-size: .8em; padding: .42em .8em; border-radius: 999px; color: var(--ink);
  background: rgba(255,253,248,.78); border: 1.5px solid var(--ink); transition: background .15s, transform .1s; }
.btn:hover { background: #fff; transform: translateY(-1px); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible { outline: 2px solid var(--shiba-deep); outline-offset: 2px; }
.btn.primary { background: var(--shiba); }
.btn.primary:hover { background: #ffb256; }
.btn.icon { padding: .42em; }
.btn.playing { background: var(--ink); color: #fff; }
.btn.rec { background: var(--ribbon); border-color: var(--ribbon); color: #fff; animation: pulse 1.1s infinite; }
.btn.speed { font-variant-numeric: tabular-nums; }
.btn.speed.custom { background: #ffe7c7; }
.btn.changed { animation: pop .3s ease-out; }
a.btn { text-decoration: none; }
.ico { width: 1.1em; height: 1.1em; flex: none; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }

/* Scene: Scriba + bubble, then the line */
.scene { position: absolute; top: 14cqh; bottom: 15cqh; left: 4cqw; right: 4cqw; display: grid;
  grid-template-columns: 40% minmax(0, 1fr); gap: 4cqw; align-items: center; }
.hero { display: flex; flex-direction: column; align-items: center; justify-content: safe center; gap: .85em; min-height: 0; max-height: 100%; }
.bubble { pointer-events: auto; position: relative; max-width: 26em; background: var(--card); border: 1.5px solid var(--ink);
  border-radius: 18px; box-shadow: 2px 3px 0 var(--ink); padding: .75em 1em .85em; font-size: .94em; animation: pop .4s cubic-bezier(.2,1.4,.4,1) .06s both; }
.bubble::after { content: ""; position: absolute; left: 50%; bottom: -8.5px; width: 14px; height: 14px; background: #fffdf8;
  border-right: 1.5px solid var(--ink); border-bottom: 1.5px solid var(--ink); transform: translateX(-50%) rotate(45deg); }
.says { display: flex; align-items: center; gap: .5em; font-family: var(--round); font-size: .66em; letter-spacing: .12em;
  text-transform: uppercase; color: var(--ribbon); margin-bottom: .2em; }
.summary.muted { color: var(--muted); font-style: italic; }
.wave { display: none; gap: 2px; align-items: center; height: .9em; }
.wave i { display: block; width: 2.5px; border-radius: 2px; background: var(--shiba-deep); animation: wave .9s ease-in-out infinite; }
.wave i:nth-child(2) { animation-delay: .15s } .wave i:nth-child(3) { animation-delay: .3s } .wave i:nth-child(4) { animation-delay: .45s }
.speaking-on .wave { display: inline-flex; }
.dots { display: inline-flex; gap: 5px; margin-left: .35em; vertical-align: middle; }
.dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--ink); animation: dot 1s ease-in-out infinite; }
.dots i:nth-child(2) { animation-delay: .15s } .dots i:nth-child(3) { animation-delay: .3s }
.dogwrap { position: relative; width: min(26cqh, 17cqw); animation: enter .5s cubic-bezier(.2,1.5,.4,1) both; }
.dog { display: block; width: 100%; height: auto; transform-origin: 50% 92%; animation: bob 2.6s ease-in-out infinite alternate; }
.dog.thinking { animation: tilt 1.3s ease-in-out infinite; }
.dog.speaking { animation: talk .32s ease-in-out infinite alternate; }
.floor { position: absolute; left: 22%; right: 22%; bottom: -3px; height: 10px; border-radius: 50%; background: rgba(43,36,32,.12); z-index: -1; }

.focus { pointer-events: auto; display: flex; flex-direction: column; gap: .9em; max-height: 100%; min-height: 0; overflow: auto; scrollbar-width: none; }
.card { flex: none; background: var(--card); border: 1.5px solid var(--ink); border-radius: 18px; box-shadow: 2px 3px 0 var(--ink);
  padding: .85em 1.05em .95em; display: flex; flex-direction: column; gap: .3em; animation: rise .35s cubic-bezier(.2,.9,.3,1) both; }
.tag { font-family: var(--round); font-size: .64em; letter-spacing: .14em; text-transform: uppercase; color: var(--ribbon); }
.orig { font-family: var(--round); font-size: 1.42em; line-height: 1.3; }
.rom { color: var(--ribbon); font-weight: 600; }
.en { color: var(--muted); }
.notes { list-style: none; display: flex; flex-direction: column; gap: .2em; margin-top: .25em; font-size: .86em; color: #4a3f37; }
.notes li { position: relative; padding-left: 1em; }
.notes li::before { content: ""; position: absolute; left: .1em; top: .62em; width: .36em; height: .36em; border-radius: 50%; background: var(--shiba); }
.actions { display: flex; gap: .45em; flex-wrap: wrap; margin-top: .45em; }
.earlier { display: flex; flex-direction: column; gap: .55em; padding: 0 .4em; animation: rise .35s cubic-bezier(.2,.9,.3,1) .08s both; }
.prev { font-size: .88em; padding-left: .8em; border-left: 2px solid rgba(43,36,32,.25); }
.prev .o { font-family: var(--round); }
.prev .r { color: var(--ribbon); font-size: .92em; }
.prev .t { color: var(--muted); font-size: .92em; }
.skel { flex: none; background: var(--card); border: 1.5px solid var(--ink); border-radius: 18px; padding: 1em; display: flex; flex-direction: column; gap: .6em; }
.sk { height: .9em; border-radius: 7px; background: linear-gradient(90deg, #f2e4cf, #fbf2e4, #f2e4cf); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
.sk.w80 { width: 80% } .sk.w60 { width: 60% } .sk.w40 { width: 40% }

/* Shadowing result */
.result:empty { display: none; }
.result { display: flex; gap: .75em; align-items: center; padding-top: .35em; }
.ring { flex: none; width: 3em; height: 3em; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid var(--ink);
  background: conic-gradient(var(--c) calc(var(--p) * 1%), #efe2cd 0); }
.ring span { width: 2.3em; height: 2.3em; border-radius: 50%; display: grid; place-items: center; background: #fffdf8; font-family: var(--round); font-size: .78em; }
.words { display: flex; flex-wrap: wrap; gap: .25em; }
.w { padding: .08em .38em; border-radius: 6px; font-weight: 650; font-size: .92em; }
.w.ok { background: #d9f4dc; color: #1f6b33; }
.w.missed { background: #ffd9d2; color: #a3321f; text-decoration: line-through; }
.w.wrong { background: #ffefb8; color: #7a5a00; }
.w.extra { color: var(--muted); font-style: italic; }
.pace, .status { color: var(--muted); font-size: .82em; }

/* Status chips (hidden while the stage is open) */
.chips { position: absolute; top: clamp(10px, 2cqh, 22px); left: clamp(10px, 1.6cqw, 22px); display: flex; gap: 8px; transition: opacity .2s; }
.wrap.open .chips { opacity: 0; }
.chip { display: inline-flex; align-items: center; gap: .45em; padding: .35em .8em .35em .4em; border-radius: 999px; font-family: var(--round);
  font-size: 13px; color: var(--ink); background: rgba(255,247,236,.94); border: 1.5px solid var(--ink); animation: rise .25s ease-out both; }
.chip img { width: 20px; height: auto; }
.chip.ok { background: rgba(230,247,225,.95); } .chip.warn { background: rgba(255,231,199,.95); } .chip.offline { background: rgba(255,220,210,.95); }
.spin { width: .85em; height: .85em; border-radius: 50%; border: 2px solid #f3d9b4; border-top-color: var(--shiba-deep); animation: spin .8s linear infinite; }

@container (max-width: 640px) {
  .scene { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); top: 12cqh; gap: 2.5cqh; }
  .hero { flex-direction: row-reverse; align-items: flex-end; }
  .dogwrap { width: 16cqw; }
  .bubble::after { left: auto; right: -8.5px; bottom: 14px; transform: rotate(-45deg); }
  .tools .label, .when { display: none; }
}

@keyframes bob { from { transform: translateY(0) rotate(-1.5deg); } to { transform: translateY(-6%) rotate(1.5deg); } }
@keyframes talk { from { transform: translateY(0) scale(1, 1); } to { transform: translateY(-5%) scale(1.03, .97); } }
@keyframes tilt { 0%, 100% { transform: rotate(-7deg); } 50% { transform: rotate(7deg); } }
@keyframes enter { from { transform: translateY(30px) scale(.6); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes pop { 0% { transform: scale(.88); opacity: 0; } 100% { transform: none; opacity: 1; } }
@keyframes rise { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes wave { 0%, 100% { height: 25%; } 50% { height: 100%; } }
@keyframes dot { 0%, 100% { transform: translateY(0); opacity: .45; } 50% { transform: translateY(-4px); opacity: 1; } }
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(214,83,58,.5); } 100% { box-shadow: 0 0 0 10px rgba(214,83,58,0); } }
@keyframes spin { to { transform: rotate(360deg); } }
`;

const HOST_ID = "scriba-root";

export class Overlay {
  private host: HTMLDivElement | null = null;
  private wrap!: HTMLDivElement;
  private stage!: HTMLDivElement;
  private canvas: HTMLCanvasElement | null = null;
  private chips!: HTMLDivElement;
  private offlineChip: HTMLDivElement | null = null;
  private statusChip: HTMLDivElement | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private content: HTMLElement[] = [];
  private bubble: HTMLDivElement | null = null;
  private summaryEl: HTMLDivElement | null = null;
  private focusEl: HTMLDivElement | null = null;
  private dog: HTMLImageElement | null = null;
  private speedBtn: HTMLButtonElement | null = null;
  private offlineTag: HTMLSpanElement | null = null;
  private results: HTMLDivElement[] = [];
  private shadowBtns: HTMLButtonElement[] = [];
  private hearBtns: HTMLButtonElement[] = [];
  private recTimer: ReturnType<typeof setInterval> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private open = false;
  private hidden = false;
  private isOffline = false;
  private isSpeaking = false;
  private voiceRate = 1;
  // three.js paper field
  private fx: Fx | null = null;
  private fxLoading = false;
  private glyphs: string[] = [];

  constructor(private handlers: OverlayHandlers) {
    // Esc closes the overlay even when focus is on the page (YouTube doesn't use Esc itself).
    document.addEventListener("keydown", (e) => {
      if (this.open && e.key === "Escape") this.handlers.onClose();
    });
  }

  private ensure(): boolean {
    const player = document.querySelector<HTMLElement>("#movie_player");
    if (!player) return false;
    if (this.host?.isConnected && this.host.parentElement === player) return true;
    document.getElementById(HOST_ID)?.remove();
    this.fx?.dispose(); // its canvas goes away with the old host
    this.fx = null;
    this.fxLoading = false;
    this.host = h("div");
    this.host.id = HOST_ID;
    // z-index 59 keeps us under YouTube's own control bar and menus (60+).
    this.host.style.cssText = "position:absolute;inset:0;z-index:59;pointer-events:none;";
    this.host.style.display = this.hidden ? "none" : "";
    const root = this.host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    this.canvas = h("canvas", "fx");
    this.stage = h("div", "stage", h("div", "veil"), this.canvas);
    // Keep clicks and keys on our controls from reaching YouTube's player (which would toggle play/pause).
    // The veil itself lets clicks through: clicking the video resumes it, as usual.
    for (const ev of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "contextmenu"])
      this.stage.addEventListener(ev, (e) => {
        if (e.target !== this.stage) e.stopPropagation();
      });
    this.stage.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.handlers.onClose();
      else if (e.key === " " || e.key === "k") {
        e.preventDefault();
        this.handlers.onResume();
      }
    });
    this.chips = h("div", "chips");
    this.wrap = h("div", "wrap", this.stage, this.chips);
    root.append(this.wrap);
    if (this.statusChip) this.chips.append(this.statusChip);
    if (this.offlineChip) this.chips.append(this.offlineChip);
    player.appendChild(this.host);
    this.open = false;
    this.content = [];
    return true;
  }

  // ---------- Chips ----------

  chip(text: string, ms = 2200): void {
    if (this.open && this.summaryEl) {
      this.summaryEl.replaceChildren(text); // the chips are hidden under the open stage
      return;
    }
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
    const face = h("img");
    face.src = MASCOT();
    face.alt = "";
    const c = h("div", `chip ${kind}`, face, kind === "busy" && h("span", "spin"), text);
    this.statusChip = c;
    this.chips.prepend(c);
    if (ms) this.statusTimer = setTimeout(() => this.status(null), ms);
  }

  offline(on: boolean): void {
    this.isOffline = on;
    if (this.offlineTag) this.offlineTag.style.display = on ? "" : "none";
    if (!this.ensure()) return;
    if (on && !this.offlineChip) {
      this.offlineChip = h("div", "chip offline", icon("wifiOff"), "offline mode");
      this.chips.append(this.offlineChip);
    } else if (!on && this.offlineChip) {
      this.offlineChip.remove();
      this.offlineChip = null;
    }
  }

  /** Hides everything, e.g. while an ad plays. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (this.host) this.host.style.display = hidden ? "none" : "";
    if (hidden) this.fx?.stop();
    else if (this.open) this.fx?.start();
  }

  // ---------- Stage ----------

  private loadFx(): void {
    if (this.fx || this.fxLoading || !this.canvas) return;
    this.fxLoading = true;
    const canvas = this.canvas;
    (import(chrome.runtime.getURL("dist/fx.js")) as Promise<typeof import("./fx")>)
      .then((mod) => {
        if (canvas !== this.canvas) return;
        this.fx = mod.createFx(canvas);
        this.fx.setGlyphs(this.glyphs);
        this.fx.setSpeaking(this.isSpeaking);
        if (this.open && !this.hidden) this.fx.start();
      })
      .catch((err) => console.warn("[Scriba] paper field unavailable", err)); // the overlay works without it
  }

  /** Builds the top row and Scriba with the bubble, then fades the stage in. */
  private build(t: number | null): boolean {
    if (!this.ensure()) return false;
    clearTimeout(this.closeTimer);
    clearInterval(this.recTimer);
    for (const el of this.content) el.remove();
    this.results = [];
    this.shadowBtns = [];
    this.hearBtns = [];

    const logo = h("img");
    logo.src = MASCOT();
    logo.alt = "";
    this.offlineTag = h("span", "offline-tag", "offline");
    this.offlineTag.style.display = this.isOffline ? "" : "none";

    const speed = h("button", "btn speed");
    speed.title = "Voice speed · click to change";
    speed.addEventListener("click", () => this.handlers.onVoiceRate(nextVoiceRate(this.voiceRate)));
    this.speedBtn = speed;
    this.fillSpeed(speed);

    const link = (path: string, ico: keyof typeof ICONS, label: string, tip: string) => {
      const a = h("a", "btn", icon(ico), h("span", "label", label));
      a.href = `${WEB_URL}${path}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.title = tip;
      return a;
    };
    const resume = h("button", "btn icon primary", icon("play"));
    resume.title = "Keep watching (Space)";
    resume.setAttribute("aria-label", "Keep watching");
    resume.addEventListener("click", () => this.handlers.onResume());
    const close = h("button", "btn icon", icon("close"));
    close.title = "Close (Esc)";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => this.handlers.onClose());

    const top = h(
      "div",
      "top",
      h("div", "brand", logo, h("span", "", "Scriba"), t !== null && h("span", "when", `paused at ${fmt(t)}`), this.offlineTag),
      h(
        "div",
        "tools",
        speed,
        link("/deck", "deck", "Deck", "Your deck: every line you paused on"),
        link("/practice", "star", "Practice", "Practise your top lines"),
        resume,
        close,
      ),
    );

    this.summaryEl = h("div", "summary");
    const wave = h("span", "wave", h("i"), h("i"), h("i"), h("i"));
    this.bubble = h("div", "bubble", h("div", "says", "Scriba", wave), this.summaryEl);
    this.dog = h("img", "dog");
    this.dog.src = MASCOT();
    this.dog.alt = "Scriba, a shiba inu holding a scroll";
    this.focusEl = h("div", "focus");
    const scene = h("div", "scene", h("div", "hero", this.bubble, h("div", "dogwrap", h("div", "floor"), this.dog)), this.focusEl);

    this.content = [top, scene];
    this.stage.append(top, scene);
    this.open = true;
    this.wrap.classList.add("open");
    requestAnimationFrame(() => this.stage.classList.add("on"));
    this.loadFx();
    if (!this.hidden) this.fx?.start();
    return true;
  }

  /** Shown immediately on pause, so the overlay is never blank. */
  thinking(t: number | null = null): void {
    if (!this.build(t)) return;
    this.isSpeaking = false;
    this.dog?.classList.add("thinking");
    this.summaryEl?.classList.add("muted");
    this.summaryEl?.replaceChildren("Reading the scroll", h("span", "dots", h("i"), h("i"), h("i")));
    this.focusEl?.replaceChildren(h("div", "skel", h("div", "sk w60"), h("div", "sk w80"), h("div", "sk w40")));
  }

  explanation(e: Explanation, can: { hear(line: Line): boolean; shadow(line: Line): boolean }, t: number | null = null): void {
    if ((!this.open || !this.focusEl) && !this.build(t)) return;
    this.dog?.classList.remove("thinking");
    this.summaryEl?.classList.toggle("muted", !e.lines.length);
    this.summaryEl?.replaceChildren(e.summary);
    this.results = [];
    this.shadowBtns = [];
    this.hearBtns = [];

    const i = e.lines.length - 1;
    if (i < 0) {
      this.focusEl?.replaceChildren();
      return;
    }
    // The line you paused for gets the card and the buttons; earlier ones are quiet rows below.
    const line = e.lines[i];
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
    const card = h(
      "div",
      "card",
      h("div", "tag", "Just said"),
      h("div", "orig", line.original),
      line.romanization && h("div", "rom", line.romanization),
      line.translation && h("div", "en", line.translation),
      line.notes.length > 0 && h("ul", "notes", ...line.notes.map((n) => h("li", "", n))),
      actions.childElementCount > 0 && actions,
      result,
    );
    // Minimal: only the line right before it, for context.
    const earlier = e.lines
      .slice(Math.max(0, i - 1), i)
      .map((l) => h("div", "prev", h("div", "o", l.original), l.romanization && h("div", "r", l.romanization), l.translation && h("div", "t", l.translation)));
    this.focusEl?.replaceChildren(card, ...(earlier.length ? [h("div", "earlier", ...earlier)] : []));

    this.glyphs = glyphsFor(e.lines);
    this.fx?.setGlyphs(this.glyphs);
  }

  speaking(on: boolean): void {
    this.isSpeaking = on;
    this.dog?.classList.remove("thinking");
    this.dog?.classList.toggle("speaking", on);
    this.bubble?.classList.toggle("speaking-on", on);
    this.fx?.setSpeaking(on);
  }

  /** The speed shown in the top-right pill. Pops when it changes. */
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
    const color = pct >= 80 ? "#3fb55e" : pct >= 50 ? "#ffb21c" : "#d6533a";
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
    if (!this.open) return;
    this.open = false;
    this.isSpeaking = false;
    this.stage.classList.remove("on");
    this.wrap.classList.remove("open");
    this.closeTimer = setTimeout(() => {
      if (this.open) return;
      this.fx?.stop();
      for (const el of this.content) el.remove();
      this.content = [];
    }, 300);
    this.dog = null;
    this.bubble = null;
    this.summaryEl = null;
    this.focusEl = null;
    this.speedBtn = null;
  }
}
