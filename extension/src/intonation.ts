// Browser side of intonation feedback: decodes the learner's take and the actor's line (from the
// voice-only dialogue track), and runs the pure pitch pipeline in pitch.ts on both.
import { mediaUrl } from "./messages";
import { cleanContour, detectPitch, downsample, intonationHint, intonationScore, PITCH, toSemitones, type Contour, type Intonation } from "./pitch";

export type IntonationView = Intonation & {
  /** Semitone contours, one value per 10 ms frame (null = unvoiced). */
  actor: Contour;
  learner: Contour;
  hint: string;
  /** Dialogue-track time (s) of actor frame k: actorStart + k·hopSec (frame centres). */
  actorStart: number;
  hopSec: number;
};

/** Padding around the line, so its first and last syllables aren't clipped. */
const PAD_S = 0.15;

let ctx: AudioContext | null = null;

/** One AudioContext for decoding. Made on the "Hold to shadow" press, so it doesn't start suspended. */
export function audioContext(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

function mono(buf: AudioBuffer, from = 0, to = buf.length): Float32Array {
  const n = Math.max(0, to - from);
  const out = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += ch[from + i] / buf.numberOfChannels;
  }
  return out;
}

async function decode(bytes: ArrayBuffer): Promise<{ samples: Float32Array; rate: number }> {
  const buf = await audioContext().decodeAudioData(bytes);
  // Keep a 16 kHz mono copy: all pitch needs, and ~12 MB for a 3-minute track instead of ~60.
  return { samples: downsample(mono(buf), buf.sampleRate, PITCH.rate), rate: Math.min(buf.sampleRate, PITCH.rate) };
}

const dialogue = new Map<string, Promise<{ samples: Float32Array; rate: number } | null>>();

/** The video's voice-only track, decoded once per video (later lines are instant). */
export function dialogueAudio(videoId: string): Promise<{ samples: Float32Array; rate: number } | null> {
  let p = dialogue.get(videoId);
  if (!p) {
    p = (async () => {
      const url = await mediaUrl(`/media/${videoId}/dialogue.mp3`);
      if (!url) return null;
      return decode(await (await fetch(url)).arrayBuffer());
    })().catch(() => null);
    dialogue.set(videoId, p);
    void p.then((r) => r || dialogue.delete(videoId)); // a failure is retried next time
  }
  return p;
}

const contour = (samples: Float32Array, rate: number): Contour => toSemitones(cleanContour(detectPitch(samples, rate)));

/**
 * Compares the learner's take with the actor's line [start, end]. Null when there's no dialogue
 * track, decoding fails, or either side has too little voiced audio for a fair score.
 */
export async function analyseIntonation(videoId: string, line: { start: number; end: number }, take: Blob): Promise<IntonationView | null> {
  const [track, mine] = await Promise.all([dialogueAudio(videoId), take.arrayBuffer().then(decode)]);
  if (!track) return null;
  const start = Math.max(0, line.start - PAD_S);
  const end = Math.min(track.samples.length / track.rate, line.end + PAD_S);
  if (end - start < 0.3) return null;
  const actor = contour(track.samples.subarray(Math.floor(start * track.rate), Math.ceil(end * track.rate)), track.rate);
  const learner = contour(mine.samples, mine.rate);
  const r = intonationScore(actor, learner);
  if (!r) return null;
  return { ...r, actor, learner, hint: intonationHint(r, actor, learner), actorStart: start + PITCH.frameSec / 2, hopSec: PITCH.hopSec };
}
