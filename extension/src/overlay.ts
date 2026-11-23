// Scriba's UI: one shadow-DOM host over #movie_player holding
// - chips: small status stickers in the top-left ("Ready · pause anytime");
// - stage: on pause, a right-hand sidebar drawn as an unrolled paper scroll (like the one Scriba
//   carries): a sketched, translucent sheet between two rolled ends, with Scriba's note, the line
//   you paused on, and a faint three.js paper-scrap field behind the text (fx.ts, loaded on first
//   open). The rest of the video stays visible, and clicking it resumes playback as usual.
// No innerHTML anywhere: YouTube enforces Trusted Types, so the DOM (and SVG) is built by hand.
import { WEB_URL } from "./shared/config";
import type { Explanation, ShadowResult } from "./shared/types";
import { CLIP_RATES, nextVoiceRate, rateLabel, shortRateLabel } from "./voiceRate";
import { HEAR_IT_RATE } from "./shared/config";
import type { Fx } from "./fx";

export type Line = Explanation["lines"][number];

export type OverlayHandlers = {
  onHear(line: Line, i: number): void;
  onShadowStart(line: Line, i: number): void;
  onShadowStop(line: Line, i: number): void;
  onClose(): void;
  onResume(): void;
  onVoiceRate(rate: number): void;
  onClipRate(rate: number): void;
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

/** A hand-drawn wavy rule, stretched to the width it gets. */
function squiggle(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 300 10");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "rule");
  for (const [d, o] of [
    ["M2 6 C 40 3, 80 8, 120 5 S 200 3, 240 6 S 288 7, 298 4", ".6"],
    ["M4 7 C 50 5, 90 9, 140 6 S 220 5, 296 6", ".25"],
  ]) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("opacity", o);
    p.setAttribute("vector-effect", "non-scaling-stroke");
    svg.append(p);
  }
  return svg;
}

/** Two "pencil" filters: noise-displaced strokes so outlines wobble like they were drawn by hand. */
function sketchDefs(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("style", "position:absolute");
  svg.setAttribute("aria-hidden", "true");
  for (const [id, freq, seed, scale, xc, yc] of [
    ["sk1", ".035", "3", "3.5", "R", "G"],
    ["sk2", ".025", "11", "5", "G", "R"],
  ]) {
    const f = document.createElementNS(SVG_NS, "filter");
    for (const [k, v] of [["id", id], ["x", "-5%"], ["y", "-5%"], ["width", "110%"], ["height", "110%"]]) f.setAttribute(k, v);
    const t = document.createElementNS(SVG_NS, "feTurbulence");
    for (const [k, v] of [["type", "fractalNoise"], ["baseFrequency", freq], ["numOctaves", "2"], ["seed", seed], ["result", "noise"]]) t.setAttribute(k, v);
    const d = document.createElementNS(SVG_NS, "feDisplacementMap");
    for (const [k, v] of [["in", "SourceGraphic"], ["in2", "noise"], ["scale", scale], ["xChannelSelector", xc], ["yChannelSelector", yc]]) d.setAttribute(k, v);
    f.append(t, d);
    svg.append(f);
  }
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
  --ink: #2b2420; --pencil: rgba(43,36,32,.28); --shiba: #ffa33c; --shiba-deep: #f08a1c; --ribbon: #d6533a; --muted: #6f6158;
  --hand: "Chalkboard SE", "Chalkboard", "Comic Neue", "Hiragino Maru Gothic ProN", "PingFang SC", system-ui, sans-serif;
  --round: "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "PingFang SC", "Apple SD Gothic Neo", system-ui, sans-serif;
  --text: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans", "Apple SD Gothic Neo", sans-serif;
  font-family: var(--text); font-size: clamp(12px, 1.3cqw, 17px); line-height: 1.45; color: var(--ink); }

.stage { position: absolute; inset: 0; visibility: hidden; transition: visibility 0s linear .3s; }
.stage.on { visibility: visible; transition: none; }
.shade { position: absolute; inset: 0; opacity: 0; transition: opacity .3s ease;
  background: linear-gradient(270deg, rgba(30,22,16,.34) 0%, rgba(30,22,16,.12) 38%, rgba(30,22,16,0) 62%); }
.stage.on .shade { opacity: 1; }

/* The scroll: rolled ends top and bottom, a translucent sketched sheet between them */
.scroll { position: absolute; top: 2.6cqh; right: 2.2cqw; bottom: 11.5cqh; width: clamp(300px, 39cqw, 480px);
  display: flex; flex-direction: column; pointer-events: auto;
  transform: translateX(28px) rotate(.6deg); opacity: 0; transition: transform .38s cubic-bezier(.2,.9,.25,1.1), opacity .25s ease; }
.stage.on .scroll { transform: rotate(.4deg); opacity: 1; }
.roll, .ribbon { filter: url(#sk1); }
.roll { position: relative; flex: none; height: 22px; margin: 0 -8px; z-index: 2; border: 1.75px solid var(--ink);
  border-radius: 12px 14px 11px 13px / 11px 12px 13px 12px; background: linear-gradient(180deg, #fffdf9 0%, #f3ede3 50%, #d9d0c3 100%); }
.roll::before, .roll::after { content: ""; position: absolute; top: 50%; width: 15px; height: 15px; margin-top: -7.5px; border-radius: 50%;
  border: 1.75px solid var(--ink); background: radial-gradient(circle, #8f867a 0 22%, #d3cbbf 28% 52%, #f8f4ee 58%); }
.roll::before { left: -3px; } .roll::after { right: -3px; }
.roll.bottom { transform: rotate(-.5deg); }
.ribbon { position: absolute; top: 12px; right: 34px; width: 13px; height: 36px; background: var(--ribbon); border: 1.75px solid var(--ink);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%); z-index: 1; }
.paper { position: relative; flex: 1; min-height: 0; margin: -4px 2px; display: flex; flex-direction: column; overflow: hidden;
  background: linear-gradient(90deg, rgba(240,226,204,.55), rgba(255,251,243,.0) 9%, rgba(255,251,243,0) 91%, rgba(240,226,204,.55)), rgba(255,250,240,.8);
  backdrop-filter: blur(12px) saturate(1.1); -webkit-backdrop-filter: blur(12px) saturate(1.1); }
.paper::before, .paper::after { content: ""; position: absolute; z-index: 2; pointer-events: none; }
.paper::before { inset: 0 2px; border-left: 2px solid var(--ink); border-right: 2px solid var(--ink); filter: url(#sk1); }
.paper::after { inset: 0 6px 0 4px; border-left: 1.1px solid rgba(43,36,32,.4); border-right: 1.1px solid rgba(43,36,32,.4); filter: url(#sk2); }
canvas.fx { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .5; pointer-events: none; }
.head, .body, .foot { position: relative; z-index: 1; }

.head { display: flex; align-items: center; gap: .55em; padding: 1.15em 1.1em .35em; }
.head img { width: 1.7em; height: auto; }
.name { font-family: var(--hand); font-weight: 700; font-size: 1.05em; }
.when { color: var(--muted); font-size: .8em; font-weight: 600; flex: 1; white-space: nowrap; }
.offline-tag { font-family: var(--hand); font-size: .78em; color: var(--ribbon); }

.body { flex: 1; min-height: 0; overflow: auto; padding: .35em 1.1em .8em; scrollbar-width: none;
  display: flex; flex-direction: column; gap: .75em; }
.say { display: flex; gap: .7em; align-items: flex-start; }
.dog { flex: none; width: 3.9em; height: auto; transform-origin: 50% 92%; animation: bob 2.6s ease-in-out infinite alternate; }
.dog.thinking { animation: tilt 1.3s ease-in-out infinite; }
.dog.speaking { animation: talk .32s ease-in-out infinite alternate; }
.summary { font-family: var(--hand); font-size: .93em; line-height: 1.5; padding-top: .1em; cursor: pointer;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; overflow: hidden; }
.summary.full { -webkit-line-clamp: unset; }
.summary.muted { color: var(--muted); }
.wave { display: none; gap: 2px; align-items: center; height: .85em; margin-left: .35em; vertical-align: -1px; }
.wave i { display: block; width: 2.5px; border-radius: 2px; background: var(--shiba-deep); animation: wave .9s ease-in-out infinite; }
.wave i:nth-child(2) { animation-delay: .15s } .wave i:nth-child(3) { animation-delay: .3s } .wave i:nth-child(4) { animation-delay: .45s }
.speaking-on .wave { display: inline-flex; }
.dots { display: inline-flex; gap: 5px; margin-left: .35em; vertical-align: middle; }
.dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--ink); animation: dot 1s ease-in-out infinite; }
.dots i:nth-child(2) { animation-delay: .15s } .dots i:nth-child(3) { animation-delay: .3s }
.rule { display: block; width: 100%; height: 10px; flex: none; fill: none; stroke: var(--ink); stroke-width: 1.5; stroke-linecap: round; }

.card { display: flex; flex-direction: column; gap: .28em; animation: rise .35s cubic-bezier(.2,.9,.3,1) both; }
.tag { align-self: flex-start; font-family: var(--hand); font-weight: 700; font-size: .78em; color: var(--ribbon);
  background: linear-gradient(transparent 55%, rgba(255,163,60,.35) 55%); padding: 0 .15em; }
.orig { font-family: var(--round); font-size: 1.38em; line-height: 1.3; }
.rom { color: var(--ribbon); font-weight: 600; }
.en { color: var(--muted); font-family: var(--hand); }
.notes { list-style: none; display: flex; flex-direction: column; gap: .2em; margin-top: .2em; font-size: .86em; color: #4a3f37; font-family: var(--hand); }
.notes li { position: relative; padding-left: 1em; }
.notes li::before { content: "~"; position: absolute; left: 0; top: -.05em; color: var(--shiba-deep); font-family: var(--hand); font-weight: 700; }
.actions { display: flex; gap: .5em; flex-wrap: wrap; margin: .45em 0 .15em; }
.prev { font-size: .86em; padding-left: .75em; border-left: 1.5px dashed var(--pencil); animation: rise .35s cubic-bezier(.2,.9,.3,1) .08s both; }
.prev .o { font-family: var(--round); }
.prev .r { color: var(--ribbon); font-size: .92em; }
.prev .t { color: var(--muted); font-size: .92em; }
.sk { height: .85em; border-radius: 6px; background: linear-gradient(90deg, rgba(222,206,182,.5), rgba(245,236,222,.7), rgba(222,206,182,.5));
  background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
.sk.w80 { width: 80% } .sk.w60 { width: 60% } .sk.w40 { width: 40% }
.skel { display: flex; flex-direction: column; gap: .6em; padding-top: .2em; }

/* Sketched buttons: uneven pencil outline with a faint second stroke */
.btn { all: unset; position: relative; cursor: pointer; user-select: none; display: inline-flex; align-items: center; gap: .4em; white-space: nowrap;
  font-family: var(--hand); font-weight: 700; font-size: .8em; padding: .38em .8em; color: var(--ink); background: rgba(255,252,246,.55);
  border: 0; border-radius: 16px 20px 15px 22px / 20px 15px 22px 16px; transition: background .15s, transform .1s; }
.btn::before { content: ""; position: absolute; inset: 0; border: 1.7px solid var(--ink); border-radius: inherit; filter: url(#sk1); pointer-events: none; }
.btn::after { content: ""; position: absolute; inset: -3px -2px -2px -3px; border: 1.1px solid rgba(43,36,32,.42);
  border-radius: 20px 14px 22px 15px / 15px 22px 14px 20px; filter: url(#sk2); pointer-events: none; }
.btn:hover { background: rgba(255,255,255,.9); transform: rotate(-1deg); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible { outline: 2px dashed var(--shiba-deep); outline-offset: 3px; }
.btn.primary { background: repeating-linear-gradient(-55deg, rgba(255,163,60,.78) 0 2.5px, rgba(255,163,60,.42) 2.5px 6px); }
.btn.primary:hover { background: repeating-linear-gradient(-55deg, rgba(255,163,60,.95) 0 2.5px, rgba(255,163,60,.6) 2.5px 6px); }
.btn.icon { padding: .38em; }
.btn.playing { background: var(--ink); color: #fff; }
.btn.rec { background: rgba(214,83,58,.85); color: #fff; animation: pulse 1.1s infinite; }
.btn.speed { font-variant-numeric: tabular-nums; }
.btn.speed.custom { background: rgba(255,163,60,.3); }
.btn.changed { animation: pop .3s ease-out; }

/* "Hear it clearly" + its speed: a sketched slider pill whose hatched thumb slides between stops */
.hear { display: inline-flex; align-items: center; gap: .3em; }
.rates { position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; align-items: stretch; padding: 2px;
  font-family: var(--hand); font-weight: 700; font-size: .72em; color: var(--ink); background: rgba(255,252,246,.55);
  border-radius: 14px 18px 13px 19px / 18px 13px 19px 14px; }
.rates::before { content: ""; position: absolute; inset: 0; border: 1.5px solid var(--ink); border-radius: inherit; filter: url(#sk1); pointer-events: none; }
.rates .thumb { position: absolute; top: 2px; bottom: 2px; left: 2px; width: calc((100% - 4px) / 3);
  transform: translateX(calc(var(--i, 1) * 100%)); transition: transform .26s cubic-bezier(.3,1.45,.55,1);
  border-radius: 11px 14px 10px 15px / 14px 10px 15px 11px; pointer-events: none;
  background: repeating-linear-gradient(-55deg, rgba(255,163,60,.85) 0 2.5px, rgba(255,163,60,.45) 2.5px 6px); }
.rates .thumb::before { content: ""; position: absolute; inset: 0; border: 1.3px solid var(--ink); border-radius: inherit; filter: url(#sk2); }
.rates button { all: unset; position: relative; z-index: 1; cursor: pointer; user-select: none; text-align: center;
  padding: .34em .6em; font-variant-numeric: tabular-nums; border-radius: 10px; transition: transform .1s; }
.rates button:hover { transform: rotate(-2deg) scale(1.06); }
.rates button:focus-visible { outline: 2px dashed var(--shiba-deep); outline-offset: 1px; }
a.btn { text-decoration: none; }
.ico { width: 1.1em; height: 1.1em; flex: none; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }

.foot { display: flex; align-items: center; gap: .5em; padding: .55em 1.1em 1em; }
.foot .grow { flex: 1; }

/* Shadowing result */
.result:empty { display: none; }
.result { display: flex; gap: .75em; align-items: center; padding-top: .35em; }
.ring { flex: none; width: 2.9em; height: 2.9em; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid var(--ink);
  background: conic-gradient(var(--c) calc(var(--p) * 1%), rgba(222,206,182,.6) 0); }
.ring span { width: 2.2em; height: 2.2em; border-radius: 50%; display: grid; place-items: center; background: #fffaf1; font-family: var(--hand); font-weight: 700; font-size: .78em; }
.words { display: flex; flex-wrap: wrap; gap: .25em; }
.w { padding: .06em .36em; border-radius: 6px; font-weight: 650; font-size: .92em; }
.w.ok { background: rgba(141,214,150,.45); color: #1f6b33; }
.w.missed { background: rgba(255,170,155,.5); color: #a3321f; text-decoration: line-through; }
.w.wrong { background: rgba(255,214,102,.5); color: #7a5a00; }
.w.extra { color: var(--muted); font-style: italic; }
.pace, .status { color: var(--muted); font-size: .82em; }

/* Status chips (hidden while the scroll is open) */
.chips { position: absolute; top: clamp(10px, 2cqh, 22px); left: clamp(10px, 1.6cqw, 22px); display: flex; gap: 8px; transition: opacity .2s; }
.wrap.open .chips { opacity: 0; }
.chip { display: inline-flex; align-items: center; gap: .45em; padding: .32em .8em .32em .4em; font-family: var(--hand); font-weight: 700; font-size: 13px;
  position: relative; color: var(--ink); background: rgba(255,248,236,.92); border: 0; border-radius: 14px 18px 13px 19px / 18px 13px 19px 14px;
  animation: rise .25s ease-out both; }
.chip::before { content: ""; position: absolute; inset: 0; border: 1.6px solid var(--ink); border-radius: inherit; filter: url(#sk1); pointer-events: none; }
.chip img { width: 20px; height: auto; }
.chip.ok { background: rgba(230,247,225,.95); } .chip.warn { background: rgba(255,231,199,.95); } .chip.offline { background: rgba(255,220,210,.95); }
.spin { width: .85em; height: .85em; border-radius: 50%; border: 2px solid #f3d9b4; border-top-color: var(--shiba-deep); animation: spin .8s linear infinite; }

@container (max-height: 600px) { .prev { display: none; } .head { padding-top: .9em; } .summary { -webkit-line-clamp: 3; } .orig { font-size: 1.22em; } }
@container (max-width: 640px) {
  .scroll { left: 3cqw; right: 3cqw; width: auto; top: auto; bottom: 12cqh; max-height: 74cqh; }
  .foot .label, .when { display: none; }
}

@keyframes bob { from { transform: translateY(0) rotate(-2deg); } to { transform: translateY(-6%) rotate(2deg); } }
@keyframes talk { from { transform: translateY(0) scale(1, 1); } to { transform: translateY(-6%) scale(1.04, .96); } }
@keyframes tilt { 0%, 100% { transform: rotate(-8deg); } 50% { transform: rotate(8deg); } }
@keyframes pop { 0% { transform: scale(.85); } 100% { transform: none; } }
@keyframes rise { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
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
  private paper!: HTMLDivElement;
  private canvas: HTMLCanvasElement | null = null;
  private chips!: HTMLDivElement;
  private offlineChip: HTMLDivElement | null = null;
  private statusChip: HTMLDivElement | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private content: HTMLElement[] = [];
  private sayEl: HTMLDivElement | null = null;
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
  private clipRate = HEAR_IT_RATE;
  private ratePills: HTMLDivElement[] = [];
  // three.js paper field
  private fx: Fx | null = null;
  private fxLoading = false;
  private glyphs: string[] = [];

  constructor(private handlers: OverlayHandlers) {
    // Esc closes the scroll even when focus is on the page (YouTube doesn't use Esc itself).
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
    this.paper = h("div", "paper", this.canvas);
    const scroll = h("div", "scroll", h("div", "roll top"), h("div", "ribbon"), this.paper, h("div", "roll bottom"));
    // Keep clicks and keys on the scroll from reaching YouTube's player (which would toggle play/pause).
    // Everything outside it lets clicks through: clicking the video resumes it, as usual.
    for (const ev of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "contextmenu", "wheel"])
      scroll.addEventListener(ev, (e) => e.stopPropagation());
    scroll.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.handlers.onClose();
      else if (e.key === " " || e.key === "k") {
        e.preventDefault();
        this.handlers.onResume();
      }
    });
    this.stage = h("div", "stage", h("div", "shade"), scroll);
    this.chips = h("div", "chips");
    this.wrap = h("div", "wrap", this.stage, this.chips);
    root.append(sketchDefs(), this.wrap);
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
      this.summaryEl.replaceChildren(text); // the chips are hidden while the scroll is open
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

  // ---------- The scroll ----------

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
      .catch((err) => console.warn("[Scriba] paper field unavailable", err)); // the scroll works without it
  }

  /** Writes the header, Scriba's note and the footer onto the scroll, then unrolls it. */
  private build(t: number | null): boolean {
    if (!this.ensure()) return false;
    clearTimeout(this.closeTimer);
    clearInterval(this.recTimer);
    for (const el of this.content) el.remove();
    this.results = [];
    this.shadowBtns = [];
    this.hearBtns = [];
    this.ratePills = [];

    const face = h("img");
    face.src = MASCOT();
    face.alt = "";
    this.offlineTag = h("span", "offline-tag", "offline");
    this.offlineTag.style.display = this.isOffline ? "" : "none";
    const speed = h("button", "btn speed");
    speed.title = "Voice speed · click to change";
    speed.addEventListener("click", () => this.handlers.onVoiceRate(nextVoiceRate(this.voiceRate)));
    this.speedBtn = speed;
    this.fillSpeed(speed);
    const close = h("button", "btn icon", icon("close"));
    close.title = "Close (Esc)";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => this.handlers.onClose());
    const head = h("div", "head", face, h("span", "name", "Scriba"), h("span", "when", t === null ? "" : `paused at ${fmt(t)}`), this.offlineTag, speed, close);

    this.dog = h("img", "dog");
    this.dog.src = MASCOT();
    this.dog.alt = "Scriba, a shiba inu holding a scroll";
    this.summaryEl = h("div", "summary");
    this.summaryEl.title = "Click to show all";
    const summary = this.summaryEl;
    summary.addEventListener("click", () => summary.classList.toggle("full"));
    this.sayEl = h("div", "say", this.dog, this.summaryEl);
    this.focusEl = h("div", "focus");
    const body = h("div", "body", this.sayEl, squiggle(), this.focusEl);

    const link = (path: string, ico: keyof typeof ICONS, label: string, tip: string) => {
      const a = h("a", "btn", icon(ico), h("span", "label", label));
      a.href = `${WEB_URL}${path}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.title = tip;
      return a;
    };
    const resume = h("button", "btn primary", icon("play"), h("span", "label", "Keep watching"));
    resume.title = "Keep watching (Space)";
    resume.setAttribute("aria-label", "Keep watching");
    resume.addEventListener("click", () => this.handlers.onResume());
    const foot = h(
      "div",
      "foot",
      link("/deck", "deck", "Deck", "Your deck: every line you paused on"),
      link("/practice", "star", "Practice", "Practise your top lines"),
      h("span", "grow"),
      resume,
    );

    this.content = [head, body, foot];
    this.paper.append(head, body, foot);
    this.open = true;
    this.wrap.classList.add("open");
    requestAnimationFrame(() => this.stage.classList.add("on"));
    this.loadFx();
    if (!this.hidden) this.fx?.start();
    return true;
  }

  /** Shown immediately on pause, so the scroll is never blank. */
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
    this.summaryEl?.replaceChildren(e.summary, h("span", "wave", h("i"), h("i"), h("i"), h("i")));
    this.results = [];
    this.shadowBtns = [];
    this.hearBtns = [];
    this.ratePills = [];

    const i = e.lines.length - 1;
    if (i < 0) {
      this.focusEl?.replaceChildren();
      return;
    }
    // The line you paused for gets the buttons; the one before it is a quiet row below.
    const line = e.lines[i];
    const actions = h("div", "actions");
    if (can.hear(line)) {
      const hear = h("button", "btn", icon("headphones"), "Hear it clearly");
      hear.title = "Just the voice, music removed";
      hear.addEventListener("click", () => this.handlers.onHear(line, i));
      actions.append(h("div", "hear", hear, this.ratePill()));
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
      actions.childElementCount > 0 && actions,
      result,
      line.notes.length > 0 && h("ul", "notes", ...line.notes.map((n) => h("li", "", n))),
    );
    const prev = i > 0 ? e.lines[i - 1] : null;
    const kids: Node[] = [card];
    if (prev)
      kids.push(h("div", "prev", h("div", "o", prev.original), prev.romanization && h("div", "r", prev.romanization), prev.translation && h("div", "t", prev.translation)));
    this.focusEl?.replaceChildren(...kids);

    this.glyphs = glyphsFor(e.lines);
    this.fx?.setGlyphs(this.glyphs);
  }

  speaking(on: boolean): void {
    this.isSpeaking = on;
    this.dog?.classList.remove("thinking");
    this.dog?.classList.toggle("speaking", on);
    this.sayEl?.classList.toggle("speaking-on", on);
    this.fx?.setSpeaking(on);
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

  hearing(i: number, on: boolean): void {
    const b = this.hearBtns[i];
    if (!b) return;
    b.classList.toggle("playing", on);
    b.replaceChildren(icon("headphones"), on ? `Playing… ${shortRateLabel(this.clipRate)}` : "Hear it clearly");
  }

  /** The speed picked on the slider pill next to "Hear it clearly". */
  setClipRate(rate: number): void {
    this.clipRate = rate;
    for (const p of this.ratePills) this.fillRatePill(p);
    this.hearBtns.forEach((b, i) => b?.classList.contains("playing") && this.hearing(i, true));
  }

  /** A three-stop pill (1× · .75× · .5×) whose thumb slides to the chosen speed. */
  private ratePill(): HTMLDivElement {
    const pill = h("div", "rates", h("span", "thumb"));
    pill.setAttribute("role", "radiogroup");
    pill.setAttribute("aria-label", "Hear it clearly speed");
    pill.title = "How fast Hear it clearly plays the line";
    for (const rate of CLIP_RATES) {
      const b = h("button", "", shortRateLabel(rate));
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", rateLabel(rate));
      b.dataset.rate = String(rate);
      b.addEventListener("click", () => this.handlers.onClipRate(rate));
      pill.append(b);
    }
    // Arrow keys move along the pill, like any radio group.
    pill.addEventListener("keydown", (ev) => {
      const step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      ev.preventDefault();
      const j = CLIP_RATES.indexOf(this.clipRate) + step;
      if (j < 0 || j >= CLIP_RATES.length) return;
      this.handlers.onClipRate(CLIP_RATES[j]);
      pill.querySelector<HTMLButtonElement>(`[data-rate="${CLIP_RATES[j]}"]`)?.focus();
    });
    this.ratePills.push(pill);
    this.fillRatePill(pill);
    return pill;
  }

  private fillRatePill(pill: HTMLDivElement): void {
    const at = Math.max(0, CLIP_RATES.indexOf(this.clipRate));
    pill.style.setProperty("--i", String(at));
    pill.querySelectorAll<HTMLButtonElement>("button").forEach((b, j) => {
      b.setAttribute("aria-checked", String(j === at));
      b.tabIndex = j === at ? 0 : -1;
    });
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
    }, 320);
    this.dog = null;
    this.sayEl = null;
    this.summaryEl = null;
    this.focusEl = null;
    this.speedBtn = null;
  }
}
