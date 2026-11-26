// Scriba's UI: one shadow-DOM host over #movie_player holding
// - chips: small status stickers in the top-left ("Ready · pause anytime");
// - stage: on pause, a right-hand sidebar drawn as an unrolled paper scroll (like the one Scriba
//   carries): a sketched, translucent sheet between two rolled ends, with Scriba's note, the line
//   you paused on, and a faint three.js paper-scrap field behind the text (fx.ts, loaded on first
//   open). The rest of the video stays visible, and clicking it resumes playback as usual.
// No innerHTML anywhere: YouTube enforces Trusted Types, so the DOM (and SVG) is built by hand.
import { WEB_URL } from "./shared/config";
import type { Explanation, ShadowResult, WordGloss } from "./shared/types";
import { CLIP_RATES, nextVoiceRate, rateLabel, shortRateLabel } from "./voiceRate";
import type { IntonationView } from "./intonation";
import { splitWords } from "./words";
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
  /** A word in the "Just said" line was tapped: `tok` indexes splitWords(line.original). */
  onWord(line: Line, i: number, tok: number): void;
  /** The play button on the word card. */
  onWordPlay(): void;
  /** After a shadowing take: play the original, your take, or both back to back. */
  onCompare(line: Line, i: number, which: Compare): void;
};

export type Compare = "original" | "you" | "both";
export type GlossState = { word: string; loading: true } | { word: string; gloss: WordGloss } | { word: string; error: string };

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
  speaker: "M4 9v6h4l5 4V5L8 9H4Zm12.5-.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  swap: "M4 8h13l-3-3M20 16H7l3 3",
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

/** Pronunciation score colour: green, amber, red (Azure calls a word below 60 mispronounced). */
const prColor = (score: number) => (score >= 80 ? "#3fb55e" : score >= 60 ? "#d99a00" : "#d6533a");

/**
 * Under the word diff: "Clarity 82" (how sure Scribe was of your words) or, with Azure,
 * "Pronunciation 80 · fluency 90 · complete 75". Nothing when no word was scored.
 */
function pronLine(p: NonNullable<ShadowResult["pronunciation"]>): HTMLDivElement | null {
  if (!p.words.length) return null;
  const azure = p.source === "azure";
  const el = h(
    "div",
    "pron",
    azure ? "Pronunciation " : "Clarity ",
    h("b", "", String(p.overall)),
    p.fluency !== undefined && ` · fluency ${p.fluency}`,
    p.completeness !== undefined && ` · complete ${p.completeness}`,
  );
  el.title = azure ? "Azure pronunciation assessment" : "How clearly each word came through: how sure the transcription was of it";
  el.style.setProperty("--prc", prColor(p.overall));
  return el;
}

/** Claude's coaching tip, with «quotes» shown as curly quotes like Scriba's note. */
function tipLine(tip: string): HTMLDivElement {
  return h("div", "coach", h("span", "lbl", "Tip"), tip.replace(/«\s*/g, "“").replace(/\s*»/g, "”"));
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const MASCOT = () => chrome.runtime.getURL("assets/scriba-inu.png");

// Extra poses. The SVGs in assets/ are placeholders: when the artist's PNG with the same name is
// dropped in (assets/scriba-sleeping.png, assets/scriba-listening.png), it's used instead, with no
// code change. See docs/mascot/README.md.
export type Pose = "default" | "sleeping" | "listening";
const POSE_ALT: Record<Pose, string> = {
  default: "Scriba, a shiba inu holding a scroll",
  sleeping: "Scriba asleep beside its scroll",
  listening: "Scriba listening, ears up",
};
const poseFile = new Map<Pose, string>(); // which file worked, so later swaps don't flicker
function setPose(img: HTMLImageElement, pose: Pose): void {
  img.alt = POSE_ALT[pose];
  img.dataset.pose = pose;
  if (pose === "default") {
    img.onerror = null;
    img.src = MASCOT();
    return;
  }
  const known = poseFile.get(pose);
  const png = chrome.runtime.getURL(`assets/scriba-${pose}.png`);
  const svg = chrome.runtime.getURL(`assets/scriba-${pose}.svg`);
  img.onload = () => poseFile.set(pose, img.src);
  img.onerror = () => {
    img.onerror = null;
    if (img.dataset.pose === pose) img.src = svg; // no artist PNG yet
  };
  img.src = known ?? png;
}
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

// The unroll on pause: starts while the rolled-up scroll slides in, then eases to a stop.
const UNROLL_DELAY_MS = 120;
const UNROLL_MS = 650;
const UNROLL_EASE = "cubic-bezier(.3,.7,.2,1)";
// The shade over the video follows the roll down with a soft edge, then reaches the bottom.
const SHADE_FEATHER = 48;
const SHADE_SETTLE_MS = 200;

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.wrap { position: absolute; inset: 0; container: player / size; pointer-events: none;
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
.paper { position: relative; flex: 1; min-height: 0; margin: -4px 2px; display: flex; flex-direction: column; overflow: hidden; container: paper / inline-size;
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
/* Nothing to explain: Scriba sleeps in the middle of the scroll, the message under it, nothing else */
.body.asleep .say { flex-direction: column; align-items: center; text-align: center; gap: .5em; margin-block: auto; }
.body.asleep .dog { width: min(10em, 80%); transform-origin: 50% 100%; animation: breathe 3.4s ease-in-out infinite; }
.body.asleep .summary { -webkit-line-clamp: unset; max-width: 22em; cursor: default; }
.body.asleep .rule, .body.asleep .focus { display: none; }
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
.slot { display: contents; }
.card .skel { gap: .45em; padding-top: .1em; }

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

/* Deck, Practice, Keep watching: one row, the same gap between each. The text is sized by the
   window but the scroll by the player, so outside full screen the scroll can be narrow for its
   text: tighten the buttons, then drop their icons, so the row stays inside the scroll. */
.foot { display: flex; align-items: center; gap: .5em; padding: .55em 1.1em 1em; }
.foot .btn { min-width: 0; }
.foot .label { overflow: hidden; text-overflow: ellipsis; }
@container paper (max-width: 24em) { .foot { gap: .4em; padding-inline: .8em; } .foot .btn { gap: .3em; padding-inline: .55em; } }
@container paper (max-width: 19em) { .foot .ico { display: none; } }

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
/* Pronunciation (Azure): a pencil underline by how well each word was said, tap for its sounds */
.w[data-pr] { position: relative; border-bottom: 2.5px solid var(--prc); border-radius: 6px 6px 2px 2px; }
.w[data-pr] sup { font-size: .62em; font-weight: 700; color: var(--prc); margin-left: .15em; }
.w.tapme { cursor: pointer; }
.w.tapme:hover, .w.tapme:focus-visible { outline: 1.5px dashed var(--prc); outline-offset: 1px; }
.pron { font-family: var(--hand); font-size: .82em; color: var(--muted); }
.pron b { color: var(--prc, var(--ink)); }
.coach { font-family: var(--hand); font-size: .86em; line-height: 1.4; color: #4a3f37; margin-top: .25em; padding: .3em .55em;
  background: rgba(255,163,60,.14); border-left: 2.5px solid var(--shiba-deep); border-radius: 3px 8px 8px 3px; }
.coach .lbl { font-weight: 700; color: var(--shiba-deep); margin-right: .4em; }
.sounds { display: flex; flex-wrap: wrap; gap: .3em; margin-top: .2em; }
.sound { display: inline-flex; gap: .3em; align-items: baseline; padding: .05em .45em; border-radius: 8px; font-size: .86em;
  background: color-mix(in srgb, var(--prc) 22%, transparent); }
.sound b { font-family: var(--round); font-weight: 600; }
.sound i { font-style: normal; font-size: .85em; color: var(--muted); }
.pace, .status { color: var(--muted); font-size: .82em; }
.compare:empty { display: none; }
.compare { display: flex; flex-wrap: wrap; align-items: center; gap: .4em; padding-top: .3em; }
.compare .lbl { font-family: var(--hand); font-size: .8em; color: var(--muted); margin-right: .1em; }

/* Intonation: the actor's pitch curve (solid) and yours (dashed), lined up in time */
.into:empty { display: none; }
.into { display: flex; gap: .7em; align-items: center; padding-top: .45em; animation: rise .3s ease-out both; }
.into svg.pitch { flex: none; width: 15.5em; max-width: 62%; height: auto; overflow: visible; }
.pitch .frame { fill: rgba(255,252,246,.6); stroke: var(--ink); stroke-width: 1.4; filter: url(#sk1); }
.pitch .mid { stroke: var(--pencil); stroke-width: 1; stroke-dasharray: 2 4; }
.pitch .them { fill: none; stroke: var(--ink); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.pitch .you { fill: none; stroke: var(--shiba-deep); stroke-width: 2.2; stroke-dasharray: 5 4; stroke-linecap: round; stroke-linejoin: round; }
.pitch .playhead { stroke: var(--ribbon); stroke-width: 1.6; opacity: 0; transition: opacity .15s; }
.pitch .playhead.on { opacity: 1; }
.into .side { display: flex; flex-direction: column; gap: .15em; min-width: 0; }
.into .score { font-family: var(--hand); font-weight: 700; font-size: .9em; }
.into .score b { font-size: 1.25em; color: var(--c, var(--ink)); }
.into .legend { font-size: .72em; color: var(--muted); display: flex; gap: .7em; }
.into .legend i { display: inline-block; width: 1.3em; height: 0; vertical-align: middle; margin-right: .3em; border-top: 2px solid var(--ink); }
.into .legend i.you { border-top: 2px dashed var(--shiba-deep); }
.into .tip { font-family: var(--hand); font-size: .82em; color: #4a3f37; }
.into .skel { flex: 1; }

/* Words: highlighted as they're heard; the line's words can be tapped */
.tok { border-radius: 4px; transition: background .12s; }
.tok.now { background: linear-gradient(transparent 45%, rgba(255,163,60,.6) 45%); }
.orig .tap { cursor: pointer; border-bottom: 1.5px dotted rgba(43,36,32,.25); }
.orig .tap:hover { border-bottom-color: var(--shiba-deep); background: rgba(255,163,60,.15); }
.orig .tap:focus-visible { outline: 2px dashed var(--shiba-deep); outline-offset: 1px; }
.orig .tap.sel { background: rgba(255,163,60,.4); border-bottom-color: var(--shiba-deep); }
.orig .tok.now { background: linear-gradient(transparent 35%, rgba(255,163,60,.7) 35%); }
.hint { font-family: var(--hand); font-size: .72em; color: var(--muted); margin-left: .5em; font-weight: 400; }

/* The word card under the line */
.gloss { position: relative; display: flex; gap: .6em; align-items: flex-start; margin: .25em 0 .1em; padding: .5em .7em .55em;
  background: rgba(255,252,246,.85); border-radius: 12px 15px 11px 16px / 15px 11px 16px 12px; animation: rise .25s ease-out both; }
.gloss::before { content: ""; position: absolute; inset: 0; border: 1.5px solid var(--ink); border-radius: inherit; filter: url(#sk1); pointer-events: none; }
.gloss .gbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .1em; }
.gloss .gw { font-family: var(--round); font-size: 1.12em; }
.gloss .gl { color: var(--muted); font-size: .8em; margin-left: .4em; font-family: var(--hand); }
.gloss .gr { color: var(--ribbon); font-weight: 600; font-size: .9em; }
.gloss .gm { font-weight: 650; }
.gloss .gn { font-family: var(--hand); font-size: .85em; color: #4a3f37; }
.gloss .btn.icon { flex: none; }
.gloss .x { all: unset; cursor: pointer; color: var(--muted); padding: 0 .2em; line-height: 1; }
.gloss .x:hover { color: var(--ink); }

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

@container player (max-height: 600px) { .prev { display: none; } .head { padding-top: .9em; } .summary { -webkit-line-clamp: 3; } .orig { font-size: 1.22em; } }
@container player (max-width: 640px) {
  .scroll { left: 3cqw; right: 3cqw; width: auto; top: auto; bottom: 12cqh; max-height: 74cqh; }
  .foot .label, .when { display: none; }
}

@keyframes breathe { 50% { transform: scale(1.02, 1.04); } }
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
  private scrollEl!: HTMLDivElement;
  private shade!: HTMLDivElement;
  private rollTop!: HTMLDivElement;
  private rollBottom!: HTMLDivElement;
  /** The unroll running on the paper, the bottom roll and the shade, if any. */
  private unrolling: Animation[] = [];
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
  private bodyEl: HTMLDivElement | null = null;
  private speedBtn: HTMLButtonElement | null = null;
  private offlineTag: HTMLSpanElement | null = null;
  private results: HTMLDivElement[] = [];
  private compares: HTMLDivElement[] = [];
  private intos: HTMLDivElement[] = [];
  /** Per line: the drawn chart's playhead and how to place dialogue-track time on it. */
  private heads: ({ line: SVGLineElement; x(t: number): number | null } | null)[] = [];
  private compareBtns = new Map<Compare, HTMLButtonElement>();
  /** Token spans of Scriba's note and of the "Just said" line, for highlighting and tapping. */
  private summaryToks: HTMLElement[] = [];
  private lineToks: HTMLElement[] = [];
  private litSummary = -1;
  private litLine = -1;
  private glossSlot: HTMLElement | null = null;
  private glossSel = -1;
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
  /** Where a voice-first (`partial`) explanation's translation, notes and previous line go later. */
  private slots: { top: HTMLElement; notes: HTMLElement; prev: HTMLElement } | null = null;
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
    this.rollTop = h("div", "roll top");
    this.rollBottom = h("div", "roll bottom");
    const scroll = h("div", "scroll", this.rollTop, h("div", "ribbon"), this.paper, this.rollBottom);
    this.scrollEl = scroll;
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
    this.shade = h("div", "shade");
    this.stage = h("div", "stage", this.shade, scroll);
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
    const wasOpen = this.open;
    clearTimeout(this.closeTimer);
    clearInterval(this.recTimer);
    for (const el of this.content) el.remove();
    this.resetLine();

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
    setPose(this.dog, "default");
    this.summaryEl = h("div", "summary");
    this.summaryEl.title = "Click to show all";
    const summary = this.summaryEl;
    summary.addEventListener("click", () => summary.classList.toggle("full"));
    this.sayEl = h("div", "say", this.dog, this.summaryEl);
    this.focusEl = h("div", "focus");
    const body = h("div", "body", this.sayEl, squiggle(), this.focusEl);
    this.bodyEl = body;

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
      resume,
    );

    this.content = [head, body, foot];
    this.paper.append(head, body, foot);
    this.open = true;
    this.wrap.classList.add("open");
    if (!wasOpen) this.unroll(); // a new pause; redrawing an open scroll doesn't unroll it again
    requestAnimationFrame(() => this.stage.classList.add("on"));
    this.loadFx();
    if (!this.hidden) this.fx?.start();
    return true;
  }

  /**
   * The scroll arrives rolled up, then unrolls: the bottom roll drops to its place and the paper
   * (with everything on it) is revealed behind it. Both move by the same distance on the same
   * curve, so the paper's edge stays tucked under the roll. The shade over the video comes down
   * with them: a mask whose soft edge ends at the roll's bottom edge, so nothing darkens below the
   * roll before it gets there; once the roll lands, it settles to the bottom of the video.
   * Measured from the finished layout, and the animations only add an offset to it (or a mask
   * that ends fully open), so everything ends exactly where the CSS puts it.
   */
  private unroll(): void {
    for (const a of this.unrolling) a.cancel();
    this.unrolling = [];
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const d = this.rollBottom.offsetTop - (this.rollTop.offsetTop + this.rollTop.offsetHeight);
    if (d <= 0) return; // not laid out (e.g. hidden during an ad): just appear
    const timing: KeyframeAnimationOptions = { duration: UNROLL_MS, delay: UNROLL_DELAY_MS, easing: UNROLL_EASE, fill: "backwards" };
    // The shade covers the player; this is where the roll's bottom edge ends up, in its coordinates.
    const landed = this.scrollEl.offsetTop + this.rollBottom.offsetTop + this.rollBottom.offsetHeight;
    const mask = { maskImage: `linear-gradient(to bottom, #000 calc(100% - ${SHADE_FEATHER}px), transparent)`, maskRepeat: "no-repeat" };
    this.unrolling = [
      this.paper.animate([{ clipPath: `inset(0 0 ${d}px 0)` }, { clipPath: "inset(0 0 0 0)" }], timing),
      // `translate` adds to the roll's own `transform` (its slight tilt) instead of replacing it.
      this.rollBottom.animate([{ translate: `0 ${-d}px` }, { translate: "0 0" }], timing),
      // Same delay and the same curve over the same time as the roll, then a short settle.
      this.shade.animate(
        [
          { ...mask, maskSize: `100% ${landed - d}px`, easing: UNROLL_EASE },
          { ...mask, maskSize: `100% ${landed}px`, offset: UNROLL_MS / (UNROLL_MS + SHADE_SETTLE_MS), easing: "ease-out" },
          { ...mask, maskSize: `100% ${this.stage.clientHeight + SHADE_FEATHER}px` },
        ],
        { duration: UNROLL_MS + SHADE_SETTLE_MS, delay: UNROLL_DELAY_MS, fill: "backwards" },
      ),
    ];
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

  /**
   * `asleep`: nothing has been said to explain. Scriba sleeps, centred and bigger, with the
   * message under it, and the divider and line area go away.
   */
  explanation(e: Explanation, can: { hear(line: Line): boolean; shadow(line: Line): boolean; asleep?: boolean }, t: number | null = null): void {
    if ((!this.open || !this.focusEl) && !this.build(t)) return;
    this.dog?.classList.remove("thinking");
    const asleep = !!can.asleep && !e.lines.length;
    this.bodyEl?.classList.toggle("asleep", asleep);
    if (this.dog) setPose(this.dog, asleep ? "sleeping" : "default");
    this.summaryEl?.classList.toggle("muted", !e.lines.length);
    // One span per word, so each lights up as Scriba says it.
    this.summaryToks = splitWords(e.summary).map((t) => h("span", t.word ? "tok" : "", t.text));
    this.litSummary = -1;
    this.summaryEl?.replaceChildren(...this.summaryToks, h("span", "wave", h("i"), h("i"), h("i"), h("i")));
    this.resetLine();

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
    const compare = h("div", "compare");
    this.compares[i] = compare;
    const into = h("div", "into");
    this.intos[i] = into;
    // The line, one tappable span per word (any language: Chinese and Japanese are split into words too).
    const orig = h("div", "orig");
    this.lineToks = splitWords(line.original).map((t, k) => {
      if (!t.word) return h("span", "", t.text);
      const w = h("span", "tok tap", t.text);
      w.tabIndex = 0;
      w.setAttribute("role", "button");
      w.title = "What does this word mean?";
      const pick = () => this.handlers.onWord(line, i, k);
      w.addEventListener("click", pick);
      w.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        pick();
      });
      return w;
    });
    orig.append(...this.lineToks);
    this.glossSlot = h("div", "slot");
    // Slots (display: contents) so a voice-first explanation can fill these in without
    // re-rendering the buttons, e.g. while you're holding to shadow.
    const slots = { top: h("div", "slot"), notes: h("div", "slot"), prev: h("div", "slot") };
    const card = h(
      "div",
      "card",
      h("div", "tag", "Just said", h("span", "hint", "· tap a word")),
      orig,
      slots.top,
      this.glossSlot,
      actions.childElementCount > 0 && actions,
      result,
      compare,
      into,
      slots.notes,
    );
    this.slots = slots;
    this.fillSlots(e, !!e.partial);
    this.focusEl?.replaceChildren(card, slots.prev);

    this.glyphs = glyphsFor(e.lines);
    this.fx?.setGlyphs(this.glyphs);
  }

  /**
   * The rest of a voice-first explanation arrived: fill in translations and notes in place.
   * `null`: it couldn't be fetched, so just drop the placeholder.
   */
  details(e: Explanation | null): void {
    if (!this.open || !this.slots) return;
    if (e?.lines.length) this.fillSlots(e, false);
    else this.slots.top.querySelector(".skel")?.remove();
  }

  private fillSlots(e: Explanation, pending: boolean): void {
    const s = this.slots;
    const i = e.lines.length - 1;
    if (!s || i < 0) return;
    const line = e.lines[i];
    // Still being written: a sketch where the translation goes (unless an earlier pause saved one).
    const waiting = pending && !line.translation;
    s.top.replaceChildren(
      ...[
        line.romanization && h("div", "rom", line.romanization),
        waiting ? h("div", "skel", h("div", "sk w80"), h("div", "sk w60")) : line.translation && h("div", "en", line.translation),
      ].filter((n): n is HTMLDivElement => !!n),
    );
    s.notes.replaceChildren(...(line.notes.length > 0 ? [h("ul", "notes", ...line.notes.map((n) => h("li", "", n)))] : []));
    const prev = i > 0 ? e.lines[i - 1] : null;
    s.prev.replaceChildren(
      ...(prev
        ? [h("div", "prev", h("div", "o", prev.original), prev.romanization && h("div", "r", prev.romanization), prev.translation && h("div", "t", prev.translation))]
        : []),
    );
  }

  private resetLine(): void {
    this.results = [];
    this.compares = [];
    this.intos = [];
    this.heads = [];
    this.compareBtns.clear();
    this.shadowBtns = [];
    this.hearBtns = [];
    this.ratePills = [];
    this.slots = null;
    this.lineToks = [];
    this.litLine = -1;
    this.glossSlot = null;
    this.glossSel = -1;
  }

  // ---------- Words lit as they're heard ----------

  /** Lights word `k` of Scriba's note (an index into splitWords(summary)); -1 clears it. */
  highlightSummary(k: number): void {
    if (k === this.litSummary) return;
    this.summaryToks[this.litSummary]?.classList.remove("now");
    this.summaryToks[k]?.classList.add("now");
    this.litSummary = k;
  }

  /** Lights word `k` of the "Just said" line (an index into splitWords(line.original)); -1 clears it. */
  highlightLine(k: number): void {
    if (k === this.litLine) return;
    this.lineToks[this.litLine]?.classList.remove("now");
    this.lineToks[k]?.classList.add("now");
    this.litLine = k;
  }

  // ---------- Tap a word ----------

  /** The word card under the line for token `k`; null closes it. */
  gloss(k: number, state: GlossState | null, canPlay = false): void {
    const slot = this.glossSlot;
    if (!slot) return;
    // An answer for a card that was closed, or for a word since replaced by another tap.
    if (state && !("loading" in state) && this.glossSel !== k) return;
    this.lineToks[this.glossSel]?.classList.remove("sel");
    this.glossSel = state ? k : -1;
    if (!state) {
      slot.replaceChildren();
      return;
    }
    this.lineToks[k]?.classList.add("sel");
    const body = h("div", "gbody");
    if ("gloss" in state) {
      const g = state.gloss;
      for (const kid of [
        h("div", "", h("span", "gw", g.word), g.lemma && h("span", "gl", `from ${g.lemma}`)),
        g.romanization && h("div", "gr", g.romanization),
        h("div", "gm", g.meaning),
        g.note && h("div", "gn", g.note),
      ])
        if (kid) body.append(kid);
    } else {
      body.append(
        h("div", "gw", state.word),
        "error" in state ? h("div", "gn", state.error) : h("div", "skel", h("div", "sk w60"), h("div", "sk w40")),
      );
    }
    const kids: Node[] = [];
    if (canPlay) {
      const play = h("button", "btn icon", icon("speaker"));
      play.title = "Hear this word";
      play.setAttribute("aria-label", `Hear “${state.word}”`);
      play.addEventListener("click", () => this.handlers.onWordPlay());
      kids.push(play);
    }
    const x = h("button", "x", "×");
    x.title = "Close";
    x.setAttribute("aria-label", "Close word card");
    x.addEventListener("click", () => this.gloss(k, null));
    slot.replaceChildren(h("div", "gloss", ...kids, body, x));
  }

  // ---------- Compare your take with the original ----------

  /** After a shadowing take: buttons to play the original, your take, or both back to back. */
  takeReady(i: number, line: Line, hasOriginal: boolean, pitchPending = false): void {
    const row = this.compares[i];
    if (!row) return;
    // The intonation chart is worked out in the background; sketch where it'll go.
    this.heads[i] = null;
    this.intos[i]?.replaceChildren(...(pitchPending ? [h("div", "skel", h("div", "sk w80"), h("div", "sk w40"))] : []));
    this.compareBtns.clear();
    const btn = (which: Compare, ico: keyof typeof ICONS, label: string, tip: string) => {
      const b = h("button", "btn", icon(ico), label);
      b.title = tip;
      b.addEventListener("click", () => this.handlers.onCompare(line, i, which));
      this.compareBtns.set(which, b);
      return b;
    };
    row.replaceChildren(
      ...[
        h("span", "lbl", "Compare:"),
        hasOriginal && btn("original", "headphones", "Original", "The line from the video, voice only"),
        btn("you", "user", "You", "Your take"),
        hasOriginal && btn("both", "swap", "Back to back", "The original, then your take"),
      ].filter((n): n is HTMLElement => !!n),
    );
  }

  /**
   * The intonation chart for a take: the actor's pitch curve (solid) and yours (dashed), yours
   * mapped onto their timeline through the DTW path so the shapes line up. Null removes the
   * placeholder (no dialogue track, too little voiced audio…).
   */
  intonation(i: number, v: IntonationView | null): void {
    const slot = this.intos[i];
    if (!slot) return;
    if (!v) {
      slot.replaceChildren();
      return;
    }
    const W = 220;
    const H = 70;
    const P = 6;
    // x: the actor's voiced stretch; y: both curves, clamped to ±12 semitones.
    const voiced = v.actor.flatMap((s, k) => (s === null ? [] : [k]));
    const k0 = voiced[0];
    const k1 = voiced[voiced.length - 1];
    // Yours on their timeline: the average of your frames matched to each of theirs.
    const sums = new Map<number, { s: number; n: number }>();
    for (const [a, b] of v.path) {
      const yv = v.learner[b];
      if (yv === null) continue;
      const e = sums.get(a) ?? { s: 0, n: 0 };
      e.s += yv;
      e.n++;
      sums.set(a, e);
    }
    const yours: (number | null)[] = v.actor.map((_, k) => {
      const e = sums.get(k);
      return e ? e.s / e.n : null;
    });
    const all = [...voiced.map((k) => v.actor[k]!), ...yours.filter((yv): yv is number => yv !== null)];
    const lo = Math.max(-12, Math.min(...all) - 1);
    const hi = Math.min(12, Math.max(...all) + 1);
    const x = (k: number) => P + ((k - k0) / Math.max(1, k1 - k0)) * (W - 2 * P);
    const y = (s: number) => H - P - ((Math.min(hi, Math.max(lo, s)) - lo) / Math.max(1, hi - lo)) * (H - 2 * P);
    // Gaps (unvoiced frames) break the line instead of being bridged.
    const line = (vals: (number | null)[]) => {
      let d = "";
      let open = false;
      for (let k = k0; k <= k1; k++) {
        const s = vals[k];
        if (s === null || s === undefined) {
          open = false;
          continue;
        }
        d += `${open ? "L" : "M"}${x(k).toFixed(1)} ${y(s).toFixed(1)}`;
        open = true;
      }
      return d;
    };
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "pitch");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Pitch curves: theirs solid, yours dashed. Intonation ${Math.round(v.score)} of 100.`);
    const el = (tag: string, attrs: Record<string, string>) => {
      const e = document.createElementNS(SVG_NS, tag);
      for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val);
      svg.append(e);
      return e;
    };
    el("rect", { class: "frame", x: "1", y: "1", width: String(W - 2), height: String(H - 2), rx: "9" });
    if (lo < 0 && hi > 0) el("line", { class: "mid", x1: String(P), x2: String(W - P), y1: y(0).toFixed(1), y2: y(0).toFixed(1) });
    el("path", { class: "them", d: line(v.actor) });
    el("path", { class: "you", d: line(yours) });
    const head = el("line", { class: "playhead", x1: "0", x2: "0", y1: "3", y2: String(H - 3) }) as SVGLineElement;
    this.heads[i] = {
      line: head,
      x: (t) => {
        const k = (t - v.actorStart) / v.hopSec;
        return k < k0 || k > k1 ? null : x(k);
      },
    };

    const score = Math.round(v.score);
    const scoreEl = h("div", "score", "Intonation ", h("b", "", String(score)));
    scoreEl.style.setProperty("--c", score >= 80 ? "#3fb55e" : score >= 55 ? "#d99a00" : "#d6533a");
    slot.replaceChildren(
      svg,
      h("div", "side", scoreEl, h("div", "legend", h("span", "", h("i"), "them"), h("span", "", h("i", "you"), "you")), h("div", "tip", v.hint)),
    );
  }

  /** Moves line i's chart playhead to dialogue-track time t; null (or i = -1) hides playheads. */
  intonationAt(i: number, t: number | null): void {
    this.heads.forEach((hd, k) => {
      if (!hd) return;
      const px = t === null || (i >= 0 && k !== i) ? null : hd.x(t);
      hd.line.classList.toggle("on", px !== null);
      if (px !== null) {
        hd.line.setAttribute("x1", px.toFixed(1));
        hd.line.setAttribute("x2", px.toFixed(1));
      }
    });
  }

  /** Marks which compare button is playing; null when nothing is. */
  comparing(which: Compare | null): void {
    for (const [k, b] of this.compareBtns) b.classList.toggle("playing", k === which);
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
    // Scriba listens while you say the line.
    if (this.dog && !this.bodyEl?.classList.contains("asleep")) setPose(this.dog, state === "recording" ? "listening" : "default");
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
    const p = r.pronunciation;
    const byDiff = new Map((p?.words ?? []).map((w) => [w.i, w]));
    el.replaceChildren(
      ring,
      h(
        "div",
        "",
        h("div", "words", ...r.diff.map((d, k) => {
          const w = h("span", `w ${d.status}`, d.word);
          w.title = d.status;
          const pr = byDiff.get(k);
          if (pr) {
            // How well it was said (Azure): underline colour + score; tap for its sounds.
            w.dataset.pr = String(pr.score);
            w.style.setProperty("--prc", prColor(pr.score));
            w.append(h("sup", "", String(pr.score)));
            w.title = `${d.status} · ${p?.source === "azure" ? "pronunciation" : "clarity"} ${pr.score}`;
            if (pr.phonemes?.length) {
              w.classList.add("tapme");
              w.tabIndex = 0;
              w.setAttribute("role", "button");
              w.title += " · tap for its sounds";
              const show = () => this.sounds(pr.word, pr.score, pr.phonemes!);
              w.addEventListener("click", show);
              w.addEventListener("keydown", (ev) => ev.key === "Enter" && show());
            }
          }
          return w;
        })),
        p && pronLine(p),
        p?.tip && tipLine(p.tip),
        h("div", "pace", `Pace ${r.paceRatio.toFixed(2)}× · ${pace}`),
      ),
    );
  }

  /**
   * A tapped word's sounds (Azure phoneme scores), on the same card as tap-a-word. Azure names the
   * sounds only for English (US) and Mandarin; elsewhere they're numbered.
   */
  private sounds(word: string, score: number, phonemes: { p: string; score: number }[]): void {
    const slot = this.glossSlot;
    if (!slot) return;
    this.lineToks[this.glossSel]?.classList.remove("sel");
    this.glossSel = -1;
    const weak = phonemes.filter((ph) => ph.score < 60);
    const named = phonemes.some((ph) => ph.p);
    const chip = (ph: { p: string; score: number }, n: number) => {
      const c = h("span", "sound", h("b", "", ph.p || `sound ${n + 1}`), h("i", "", String(Math.round(ph.score))));
      c.style.setProperty("--prc", prColor(ph.score));
      return c;
    };
    const tip = !weak.length
      ? "Every sound was clear."
      : named
        ? `Work on ${weak.map((ph) => `“${ph.p}”`).join(", ")}.`
        : `${weak.length} of ${phonemes.length} sounds were unclear: try “Hear it clearly” at .5× and copy it.`;
    const head = h("div", "", h("span", "gw", word), h("span", "gl", `pronunciation ${score}`));
    const x = h("button", "x", "×");
    x.title = "Close";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", () => slot.replaceChildren());
    slot.replaceChildren(h("div", "gloss", h("div", "gbody", head, h("div", "sounds", ...phonemes.map(chip)), h("div", "gn", tip)), x));
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
      for (const a of this.unrolling) a.cancel();
      this.unrolling = [];
      this.fx?.stop();
      for (const el of this.content) el.remove();
      this.content = [];
    }, 320);
    this.dog = null;
    this.sayEl = null;
    this.summaryEl = null;
    this.summaryToks = [];
    this.litSummary = -1;
    this.resetLine();
    this.focusEl = null;
    this.bodyEl = null;
    this.speedBtn = null;
  }
}
