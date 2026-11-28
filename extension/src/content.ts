// Content script on youtube.com: wires session, captions, signals and the overlay together.
import { CaptionBuffer } from "./captions";
import { analyseIntonation, audioContext, dialogueAudio } from "./intonation";
import { loadEnabled, onEnabledChange } from "./enabled";
import { api, mediaUrl } from "./messages";
import { Overlay, type Compare, type Line } from "./overlay";
import { Recorder } from "./recorder";
import { DIALOGUE_POLL_MS, HEAR_IT_RATE, SESSION_POLL_MS } from "./shared/config";
import type { Explanation, Segment, ShadowResult, WordGloss } from "./shared/types";
import { charTimes, splitWords, spreadTimes, squeezed, tokenAt, tokenSpans, type Span } from "./words";
import { window as segWindow } from "./shared/window";
import { isAdShowing, watchAds, watchPlayback } from "./signals";
import {
  loadClipRate,
  loadVoiceRate,
  onClipRateChange,
  onVoiceRateChange,
  rateLabel,
  saveClipRate,
  saveVoiceRate,
} from "./voiceRate";

type Session = { status: "processing" | "ready" | "failed"; segments: Segment[] | null; hasDialogue: boolean };

const log = (...a: unknown[]) => console.log("%c[Scriba]", "color:#f08a1c;font-weight:bold", ...a);

let videoId: string | null = null;
let session: Session | null = null;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let announcedReady = false;
let dialoguePolls = 0;
let pauseTimer: ReturnType<typeof setTimeout> | undefined;
let explainSeq = 0;
let speech: HTMLAudioElement | null = null;
let clip: HTMLAudioElement | null = null;
let extra: HTMLAudioElement | null = null; // your shadowing take, or a tapped word's own audio
let shadowStart: Promise<boolean> | null = null;
let voiceRate = 1;
let clipRate = HEAR_IT_RATE;
let enabled = false; // set from storage at boot (on unless switched off in the toolbar popup)

const captions = new CaptionBuffer();
const recorder = new Recorder();
const overlay = new Overlay({
  onHear,
  onShadowStart,
  onShadowStop,
  onClose,
  onResume,
  onVoiceRate,
  onClipRate,
  onWord: (line, i, tok) => void onWord(line, i, tok),
  onWordPlay: () => void onWordPlay(),
  onCompare: (line, i, which) => void onCompare(line, i, which),
});
let clipIndex = -1;

function player(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>("#movie_player video");
}

function currentVideoId(): string | null {
  return location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") : null;
}

function segment(id: number): Segment | undefined {
  return session?.segments?.find((s) => s.id === id);
}

// ---------- Session (Task 1) ----------

function onNavigate(): void {
  // Off (toolbar popup): no session, so nothing is downloaded or transcribed for this video.
  const id = enabled ? currentVideoId() : null;
  if (id === videoId) return;
  videoId = id;
  session = null;
  clearTimeout(pollTimer);
  announcedReady = false;
  dialoguePolls = 0;
  captions.reset();
  overlay.status(null);
  overlay.hideBubble();
  stopAudio();
  if (id) pollSession(id);
}

async function pollSession(id: string): Promise<void> {
  if (id !== videoId) return;
  const title =
    document.querySelector("#title h1, h1.ytd-watch-metadata")?.textContent?.trim() || document.title.replace(/ - YouTube$/, "");
  const res = await api<Session>("/ext/session", { videoId: id, title });
  if (id !== videoId) return;
  if (res.ok) {
    session = res.data;
    overlay.offline(!!res.offline);
    if (session.status === "ready") {
      if (!announcedReady) {
        announcedReady = true;
        log(`ready: ${session.segments?.length ?? 0} segments, dialogue=${session.hasDialogue}`, session.segments);
        overlay.status("Ready · pause anytime", "ok", 4000);
      }
      // The voice-isolated track ("Hear it clearly") lands a few seconds after the transcript.
      if (!session.hasDialogue && dialoguePolls++ < 20) pollTimer = setTimeout(() => pollSession(id), DIALOGUE_POLL_MS);
      else if (session.hasDialogue && dialoguePolls > 0) log("dialogue track ready");
      return;
    }
    if (session.status === "failed") {
      log("ingest failed on the server; using live captions only (reload to retry)");
      overlay.status("Couldn't process this video · turn on CC and I'll read the captions", "warn", 8000);
      return;
    }
    log("processing… (Scribe + Voice Isolator)");
    overlay.status("Listening to the first 3 minutes…", "busy");
  } else {
    log("server unreachable, retrying", res.error);
    overlay.status("Can't reach the server · retrying", "warn");
  }
  pollTimer = setTimeout(() => pollSession(id), SESSION_POLL_MS);
}

// ---------- Pause → explain, play → hide ----------

function onPause(video: HTMLVideoElement): void {
  if (!videoId || !enabled) return;
  // YouTube pauses briefly while scrubbing; only explain a pause that sticks.
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(() => video.paused && !isAdShowing() && explain(video), 250);
}

function onPlay(): void {
  clearTimeout(pauseTimer);
  explainSeq++;
  overlay.hideBubble();
  stopAudio();
}

// ---------- Explain on pause (Tasks 3 + 4) ----------

async function explain(video: HTMLVideoElement): Promise<void> {
  if (!videoId) return;
  const seq = ++explainSeq;
  const t = video.currentTime;
  glossFor = null;
  overlay.thinking(t);
  const captionLines = captions.snapshot(t);
  const res = await api<Explanation>("/ext/explain", {
    videoId,
    t,
    captionLines,
  });
  // An ad may have started while we waited: never draw over an ad.
  if (seq !== explainSeq || !video.paused || isAdShowing()) return;

  let e: Explanation;
  if (res.ok) {
    e = res.data;
    overlay.offline(!!(res.offline || e.offline));
  } else {
    // Server down and nothing cached: still never blank, show what was said.
    overlay.offline(true);
    const lines = segWindow(captionLines, t);
    e = {
      summary: lines.length ? "I can't reach my brain right now, but here's what was said." : "Nothing's been said yet. Play a bit more!",
      audioUrl: null,
      lines: lines.map((l) => ({ segmentId: -1, original: l.text, translation: "", notes: [] })),
    };
  }

  overlay.explanation(e, {
    // From the voice-only track, or read aloud by TTS when the line's timing is squeezed.
    hear: (line) => {
      const seg = segment(line.segmentId);
      return !!seg && (!!session?.hasDialogue || squeezed(seg));
    },
    shadow: (line) => !!line.original,
    // No lines and not "Still listening…" (the server says that while processing with no captions).
    asleep: !((!session || session.status === "processing") && !captionLines.length),
  }, t);
  // Voice first: the translations and notes are still being written; fetch them while it talks.
  if (e.partial) void fillDetails(video, seq, t);

  if (e.audioUrl) {
    const url = await mediaUrl(e.audioUrl);
    if (!url || seq !== explainSeq || isAdShowing()) return;
    stopAudio();
    const s = new Audio(url);
    speech = s;
    s.preservesPitch = true;
    s.defaultPlaybackRate = s.playbackRate = voiceRate;
    s.onplay = () => overlay.speaking(true);
    s.onpause = s.onended = () => overlay.speaking(false);
    s.addEventListener("playing", () => log(`voice: ${s.duration.toFixed(1)}s of audio at ${rateLabel(s.playbackRate)}`), { once: true });
    followVoice(s, e.summary);
    s.play().catch((err) => log("voice blocked", err));
  }
}

/**
 * Lights each word of Scriba's note as it's spoken. TTS doesn't say when each word starts, so
 * it's paced by length (longer words and punctuation take longer) across the clip.
 */
function followVoice(s: HTMLAudioElement, summary: string): void {
  const toks = splitWords(summary);
  let looping = false;
  s.addEventListener("playing", () => {
    if (looping || !Number.isFinite(s.duration)) return;
    looping = true;
    // A little silence at either end of each TTS clip.
    const spans = tokenSpans(toks, spreadTimes(summary, 0.15, Math.max(0.3, s.duration - 0.25)));
    const loop = () => {
      if (speech !== s || s.paused) {
        looping = false;
        if (speech === s || !speech) overlay.highlightSummary(-1);
        return;
      }
      overlay.highlightSummary(tokenAt(spans, s.currentTime));
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

async function fillDetails(video: HTMLVideoElement, seq: number, t: number): Promise<void> {
  const t0 = performance.now();
  const res = await api<Explanation>("/ext/explain-rest", { videoId, t });
  if (seq !== explainSeq || !video.paused || isAdShowing()) return;
  if (!res.ok) {
    log("details failed", res.error);
    return overlay.details(null);
  }
  log(`details: +${Math.round(performance.now() - t0)}ms after the voice`);
  overlay.details(res.data);
  if (res.offline || res.data.offline) overlay.offline(true);
}

// ---------- Voice speed (the pill in the panel header) ----------

/** Applies at once, even mid-sentence, and is saved for every video and tab. */
function onVoiceRate(rate: number): void {
  applyVoiceRate(rate);
  saveVoiceRate(rate);
}

function applyVoiceRate(rate: number): void {
  if (rate === voiceRate) return;
  voiceRate = rate;
  overlay.setVoiceRate(rate);
  if (speech) speech.defaultPlaybackRate = speech.playbackRate = rate;
  log(`voice speed ${rateLabel(rate)}`);
}

// ---------- "Hear it clearly" speed (the slider pill next to it) ----------

/** Applies at once, even mid-clip, and is saved for every video and tab. */
function onClipRate(rate: number): void {
  applyClipRate(rate);
  saveClipRate(rate);
}

function applyClipRate(rate: number): void {
  if (rate === clipRate) return;
  clipRate = rate;
  overlay.setClipRate(rate);
  if (clip) clip.defaultPlaybackRate = clip.playbackRate = rate;
  log(`hear-it-clearly speed ${rateLabel(rate)}`);
}

function stopAudio(): void {
  speech?.pause();
  speech = null;
  extra?.pause();
  extra = null;
  overlay.comparing(null);
  overlay.highlightSummary(-1);
  overlay.highlightLine(-1);
  overlay.intonationAt(-1, null);
  if (clip) {
    clip.pause();
    clip = null;
    const v = player();
    if (v) v.muted = false;
  }
  if (clipIndex >= 0) overlay.hearing(clipIndex, false);
  clipIndex = -1;
  overlay.speaking(false);
}

/** "Keep watching" (or Space) on the overlay: resume the video, which also closes the overlay. */
function onResume(): void {
  player()
    ?.play()
    .catch(() => {});
}

/** The × on the overlay (or Esc): dismiss without resuming the video. */
function onClose(): void {
  explainSeq++;
  stopAudio();
  overlay.hideBubble();
}

// ---------- "Hear it clearly" (Task 5) ----------

/** When each word of a line is heard: Scribe's word timings if the video has them, else spread over the line. */
function lineSpans(line: Line): (Span | null)[] | null {
  const seg = segment(line.segmentId);
  return seg ? tokenSpans(splitWords(line.original), charTimes(seg)) : null;
}

/**
 * Plays [start, end] of the voice-only dialogue track at the "Hear it clearly" speed, with the
 * video muted. `onTick` gets the playhead every frame (for highlighting). Resolves true if it
 * played to the end, false if it was stopped or couldn't play.
 */
async function playDialogue(start: number, end: number, opts: ClipOpts = {}): Promise<boolean> {
  if (!videoId || isAdShowing()) return false;
  const url = await mediaUrl(`/media/${videoId}/dialogue.mp3`);
  if (!url) {
    overlay.chip("dialogue track unavailable");
    return false;
  }
  return playClip(url, start, end, opts);
}

type ClipOpts = { onStart?(): void; onTick?(t: number, duration: number): void };

/** Plays [start, end] of `url` (a blob: URL) like playDialogue; end = Infinity plays to the end. */
function playClip(url: string, start: number, end: number, opts: ClipOpts = {}): Promise<boolean> {
  stopAudio();
  const v = player();
  if (v) v.muted = true;
  const a = new Audio(url);
  clip = a;
  a.preservesPitch = true;
  opts.onStart?.();
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (full: boolean) => {
      if (done) return;
      done = true;
      if (clip === a) {
        clip = null;
        if (v) v.muted = false;
      }
      a.pause();
      resolve(full);
    };
    a.addEventListener(
      "loadedmetadata",
      () => {
        a.currentTime = Math.max(0, start);
        a.defaultPlaybackRate = a.playbackRate = clipRate;
        a.play().catch(() => finish(false));
      },
      { once: true },
    );
    a.addEventListener("error", () => finish(false), { once: true });
    a.addEventListener("pause", () => finish(a.ended || a.currentTime >= end - 0.05)); // stopAudio() or the end
    let looping = false;
    const loop = () => {
      if (done || clip !== a) return finish(false);
      if (a.currentTime >= end) return finish(true);
      opts.onTick?.(a.currentTime, a.duration);
      requestAnimationFrame(loop);
    };
    a.addEventListener("playing", () => {
      if (looping) return;
      looping = true;
      requestAnimationFrame(loop);
    });
  });
}

/** The line from the video, voice only, each word lit as it's heard. */
async function playLine(line: Line, i: number, onStart?: () => void): Promise<boolean> {
  const seg = segment(line.segmentId);
  const spans = lineSpans(line);
  if (!seg || !spans) return false;
  const begin = () => {
    clipIndex = i;
    overlay.hearing(i, true);
    onStart?.();
  };
  let full: boolean;
  if (squeezed(seg)) {
    // Its timing is too short to cut from the video (it would play a sliver): read it aloud instead,
    // each word lit by length across the clip.
    const url = await lineVoiceUrl(seg.id);
    if (!url) {
      overlay.chip("couldn't read that line aloud");
      return false;
    }
    let voiced: (Span | null)[] | null = null;
    full = await playClip(url, 0, Infinity, {
      onStart: begin,
      onTick: (t, duration) => {
        if (!Number.isFinite(duration) || duration <= 0) return;
        voiced ??= tokenSpans(splitWords(line.original), spreadTimes(line.original, 0, duration));
        overlay.highlightLine(tokenAt(voiced, t));
      },
    });
  } else {
    full = await playDialogue(seg.start - 0.1, seg.end + 0.2, {
      onStart: begin,
      onTick: (t) => {
        overlay.highlightLine(tokenAt(spans, t));
        overlay.intonationAt(i, t); // the playhead on the pitch chart, if there is one
      },
    });
  }
  if (!clip) {
    // Not replaced by another clip: tidy up (stopAudio already did if it was stopped).
    if (clipIndex === i) clipIndex = -1;
    overlay.hearing(i, false);
    overlay.highlightLine(-1);
    overlay.intonationAt(i, null);
  }
  return full;
}

const lineVoices = new Map<string, Promise<string | null>>();

/** A squeezed line read aloud by the server's TTS, as a blob: URL (fetched once per line). */
function lineVoiceUrl(segmentId: number): Promise<string | null> {
  const id = videoId;
  if (!id) return Promise.resolve(null);
  const key = `${id}#${segmentId}`;
  let p = lineVoices.get(key);
  if (!p) {
    p = api<{ audioUrl: string }>("/ext/line-voice", { videoId: id, segmentId }).then((res) =>
      res.ok ? mediaUrl(res.data.audioUrl) : null,
    );
    p.then((url) => url || lineVoices.delete(key)); // retry a failure next time
    lineVoices.set(key, p);
  }
  return p;
}

/** True if the line has a real moment in the video to cut from (not squeezed, not captions-only). */
function timed(line: Line): boolean {
  const seg = segment(line.segmentId);
  return !!seg && !squeezed(seg);
}

function onHear(line: Line, i: number): void {
  void playLine(line, i);
}

/** Plays a recorded take or a spoken word (a blob: URL) once. Resolves true if it played to the end. */
function playExtra(url: string, onStart?: () => void): Promise<boolean> {
  stopAudio();
  const a = new Audio(url);
  extra = a;
  onStart?.();
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (full: boolean) => {
      if (done) return;
      done = true;
      if (extra === a) extra = null;
      resolve(full);
    };
    a.onended = () => finish(true);
    a.onpause = () => finish(a.ended);
    a.onerror = () => finish(false);
    a.play().catch(() => finish(false));
  });
}

// ---------- Tap a word ----------

let glossFor: { line: Line; tok: number; gloss: WordGloss | null } | null = null;

async function onWord(line: Line, _i: number, tok: number): Promise<void> {
  const tokens = splitWords(line.original);
  const word = tokens[tok]?.text;
  if (!videoId || !word) return;
  // The video's own voice can say it when there's a clean dialogue track for this line.
  const fromVideo = !!session?.hasDialogue && timed(line);
  const me = { line, tok, gloss: null as WordGloss | null };
  glossFor = me;
  overlay.gloss(tok, { word, loading: true }, fromVideo);
  const index = tokens.slice(0, tok).filter((t) => t.word).length;
  const res = await api<WordGloss>("/ext/word", { videoId, segmentId: line.segmentId, line: line.original, word, index });
  if (glossFor !== me) return;
  if (!res.ok) {
    overlay.gloss(tok, { word, error: "Couldn't look that up right now." }, fromVideo);
    return;
  }
  me.gloss = res.data;
  overlay.gloss(tok, { word, gloss: res.data }, fromVideo || !!res.data.audioUrl);
}

/** The word card's play button: the word spoken on its own if the server made one, else cut from the video. */
async function onWordPlay(): Promise<void> {
  const g = glossFor;
  if (!g) return;
  if (g.gloss?.audioUrl) {
    const url = await mediaUrl(g.gloss.audioUrl);
    if (url && glossFor === g) void playExtra(url);
    return;
  }
  const span = timed(g.line) ? lineSpans(g.line)?.[g.tok] : null;
  if (!span) return;
  await playDialogue(span.start - 0.08, span.end + 0.12, { onStart: () => overlay.highlightLine(g.tok) });
  if (!clip) overlay.highlightLine(-1);
}

// ---------- Compare your take with the original ----------

let take: string | null = null; // blob: URL of the last shadowing take
let compareSeq = 0;

async function onCompare(line: Line, i: number, which: Compare): Promise<void> {
  const seq = ++compareSeq;
  // (Each play stops whatever was playing, which clears the marks, so they're set once it starts.)
  const you = (mark: Compare) => (take ? playExtra(take, () => overlay.comparing(mark)) : Promise.resolve(false));
  if (which === "you") await you("you");
  else if (which === "original") await playLine(line, i, () => overlay.comparing("original"));
  else {
    const full = await playLine(line, i, () => overlay.comparing("both"));
    if (full && seq === compareSeq) {
      overlay.comparing("both");
      await new Promise((r) => setTimeout(r, 350)); // a beat between the two
      if (seq === compareSeq) await you("both");
    }
  }
  if (seq === compareSeq) overlay.comparing(null);
}

// ---------- Shadowing (Task 6b) ----------

function onShadowStart(line: Line, i: number): void {
  stopAudio();
  // Intonation: make the AudioContext inside this press (so it isn't suspended), and start
  // decoding the actor's voice track while you speak.
  if (videoId && session?.hasDialogue && timed(line)) {
    audioContext();
    void dialogueAudio(videoId);
  }
  shadowStart = recorder
    .start()
    .then(() => {
      overlay.shadowState(i, "recording");
      return true;
    })
    .catch((err) => {
      log("mic error", err);
      overlay.shadowResult(i, { error: "Microphone blocked — allow it for youtube.com and try again." });
      return false;
    });
}

async function onShadowStop(line: Line, i: number): Promise<void> {
  const started = await shadowStart;
  shadowStart = null;
  if (!started || !recorder.recording || !videoId) return;
  overlay.shadowState(i, "scoring");
  const { audioBase64, durationSec, blob } = await recorder.stop();
  const seg = segment(line.segmentId);
  // Your take can be played next to the original right away, while it's being scored.
  if (blob && durationSec > 0.3) {
    if (take) URL.revokeObjectURL(take);
    take = URL.createObjectURL(blob);
    // Intonation needs the actor's voice-only line with real timing (not captions-only or squeezed lines).
    const pitch = !!session?.hasDialogue && timed(line);
    // "Original" plays the clip, or the TTS reading of a squeezed line.
    overlay.takeReady(i, line, !!seg && (!!session?.hasDialogue || squeezed(seg)), pitch);
    // In parallel with the word scoring below; whichever finishes first shows first.
    if (pitch && seg) void showIntonation(i, seg, blob);
  }
  const res = await api<ShadowResult>("/ext/shadow", {
    videoId,
    segmentId: line.segmentId,
    audioBase64,
    durationSec,
    text: line.original,
    origDur: seg ? seg.end - seg.start : undefined,
  });
  overlay.shadowState(i, "idle");
  overlay.shadowResult(i, res.ok ? res.data : { error: "Couldn't score that one. Try again?" });
}

let takeSeq = 0;

/** Pitch curves + intonation score for a take. Skipped silently (placeholder removed) if it can't be scored. */
async function showIntonation(i: number, seg: Segment, blob: Blob): Promise<void> {
  const mine = ++takeSeq;
  const seq = explainSeq;
  const id = videoId;
  if (!id) return;
  const t0 = performance.now();
  const r = await analyseIntonation(id, seg, blob).catch((err) => {
    log("intonation failed", err);
    return null;
  });
  if (mine !== takeSeq || seq !== explainSeq || id !== videoId) return; // a newer take, pause or video
  log(r ? `intonation ${Math.round(r.score)} (${r.meanErrorSemitones.toFixed(1)} st off) in ${Math.round(performance.now() - t0)}ms` : "intonation: not enough voiced audio");
  overlay.intonation(i, r);
}

// ---------- Boot ----------

// One instance per page, even if the extension is reloaded or injected twice
// (the DOM is shared between isolated worlds, so the flag is too).
const root = document.documentElement;
if (root.dataset.pauseEffect) throw new Error("[Scriba] already running on this page");
root.dataset.pauseEffect = String(Date.now());

watchPlayback({ onPause, onPlay });
// Ads: drop whatever is on screen, stop the voice, and hide the overlay until the ad ends.
watchAds((ad) => {
  if (ad) {
    clearTimeout(pauseTimer);
    explainSeq++;
    stopAudio();
    overlay.hideBubble();
    log("ad playing: paused until it ends");
  } else {
    log("ad finished");
  }
  overlay.setHidden(ad);
});
captions.start();
void loadVoiceRate().then(applyVoiceRate);
onVoiceRateChange(applyVoiceRate);
void loadClipRate().then(applyClipRate);
onClipRateChange(applyClipRate);
document.addEventListener("yt-navigate-finish", onNavigate);
window.addEventListener("popstate", onNavigate);
// Read the switch before touching the server, so a video opened while off is never ingested.
void loadEnabled().then((on) => {
  enabled = on;
  onNavigate();
  log(on ? "listening" : "off (turn on from the toolbar icon)");
});
onEnabledChange((on) => {
  if (on === enabled) return;
  enabled = on;
  log(on ? "turned on" : "turned off");
  if (!on) {
    clearTimeout(pauseTimer);
    explainSeq++;
  }
  // Off: onNavigate sees no video and clears everything. On: it starts this video's session,
  // and if the video is already paused, explain right away.
  onNavigate();
  const v = player();
  if (on && v?.paused && v.currentTime > 0 && !isAdShowing()) onPause(v);
});
