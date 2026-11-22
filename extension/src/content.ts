// Content script on youtube.com: wires session, captions, signals and the overlay together.
import { CaptionBuffer } from "./captions";
import { api, mediaUrl } from "./messages";
import { Overlay, type Line } from "./overlay";
import { Recorder } from "./recorder";
import { HEAR_IT_RATE, SESSION_POLL_MS } from "./shared/config";
import type { Explanation, Segment, ShadowResult } from "./shared/types";
import { window as segWindow } from "./shared/window";
import { isAdShowing, watchPlayback } from "./signals";

type Session = { status: "processing" | "ready" | "failed"; segments: Segment[] | null; hasDialogue: boolean };

const log = (...a: unknown[]) => console.log("%c[Pause&Effect]", "color:#ff7a59;font-weight:bold", ...a);

let videoId: string | null = null;
let session: Session | null = null;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let pauseTimer: ReturnType<typeof setTimeout> | undefined;
let explainSeq = 0;
let speech: HTMLAudioElement | null = null;
let clip: HTMLAudioElement | null = null;
let shadowStart: Promise<boolean> | null = null;

const captions = new CaptionBuffer();
const recorder = new Recorder();
const overlay = new Overlay({ onHear, onShadowStart, onShadowStop, onClose });
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
  const id = currentVideoId();
  if (id === videoId) return;
  videoId = id;
  session = null;
  clearTimeout(pollTimer);
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
      log(`ready: ${session.segments?.length ?? 0} segments, dialogue=${session.hasDialogue}`, session.segments);
      overlay.status("Ready · pause anytime", "ok", 4000);
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
  if (!videoId) return;
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
  overlay.thinking(t);
  const captionLines = captions.snapshot(t);
  const res = await api<Explanation>("/ext/explain", {
    videoId,
    t,
    captionLines,
  });
  if (seq !== explainSeq || !video.paused) return;

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
    hear: (line) => !!session?.hasDialogue && !!segment(line.segmentId),
    shadow: (line) => !!line.original,
  }, t);

  if (e.audioUrl) {
    const url = await mediaUrl(e.audioUrl);
    if (!url || seq !== explainSeq) return;
    stopAudio();
    speech = new Audio(url);
    speech.onplay = () => overlay.speaking(true);
    speech.onpause = speech.onended = () => overlay.speaking(false);
    speech.play().catch((err) => log("voice blocked", err));
  }
}

function stopAudio(): void {
  speech?.pause();
  speech = null;
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

/** The × on the panel: dismiss without resuming the video. */
function onClose(): void {
  explainSeq++;
  stopAudio();
  overlay.hideBubble();
}

// ---------- "Hear it clearly" (Task 5) ----------

async function onHear(line: Line, i: number): Promise<void> {
  const seg = segment(line.segmentId);
  if (!videoId || !seg) return;
  stopAudio();
  const url = await mediaUrl(`/media/${videoId}/dialogue.mp3`);
  if (!url) {
    overlay.chip("dialogue track unavailable");
    return;
  }
  const v = player();
  if (v) v.muted = true;
  const a = new Audio(url);
  clip = a;
  clipIndex = i;
  overlay.hearing(i, true);
  a.preservesPitch = true;
  a.addEventListener(
    "loadedmetadata",
    () => {
      a.currentTime = Math.max(0, seg.start - 0.1);
      a.defaultPlaybackRate = a.playbackRate = HEAR_IT_RATE;
      void a.play();
    },
    { once: true },
  );
  a.addEventListener("timeupdate", () => {
    if (a.currentTime >= seg.end + 0.2) {
      a.pause();
      if (clip === a) {
        clip = null;
        clipIndex = -1;
        overlay.hearing(i, false);
      }
      if (v) v.muted = false;
    }
  });
}

// ---------- Shadowing (Task 6b) ----------

function onShadowStart(_line: Line, i: number): void {
  stopAudio();
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
  const { audioBase64, durationSec } = await recorder.stop();
  const seg = segment(line.segmentId);
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

// ---------- Boot ----------

// One instance per page, even if the extension is reloaded or injected twice
// (the DOM is shared between isolated worlds, so the flag is too).
const root = document.documentElement;
if (root.dataset.pauseEffect) throw new Error("[Pause&Effect] already running on this page");
root.dataset.pauseEffect = String(Date.now());

watchPlayback({ onPause, onPlay });
captions.start();
document.addEventListener("yt-navigate-finish", onNavigate);
window.addEventListener("popstate", onNavigate);
onNavigate();
log("listening");
