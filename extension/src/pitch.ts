// Intonation feedback for shadowing: how closely the learner's pitch *shape* follows the actor's.
//
// 1. detectPitch: YIN pitch detection, one value per 10 ms (null = unvoiced or silent).
// 2. cleanContour: fix octave jumps, median-filter spikes, bridge short gaps.
// 3. toSemitones: each speaker relative to their own median, so a deep and a high voice singing
//    the same melody give the same curve: s(t) = 12·log2(f0(t) / median(f0)).
// 4. intonationScore: dynamic time warping on the voiced frames, so speaking faster or slower
//    isn't counted as a pitch error (pace is reported separately), then a 0–100 score.
//
// Everything here is pure (arrays in, numbers out), so it's unit-tested without a browser.

export const PITCH = {
  /** Analysis rate: audio is averaged down to this first (plenty for voice pitch, and fast). */
  rate: 16000,
  frameSec: 0.04,
  hopSec: 0.01,
  /** 60, not 70: deep voices dip under 70 Hz at the end of a phrase (one test voice sat at ~85 Hz). */
  minHz: 60,
  maxHz: 500,
  /**
   * YIN: the first lag whose normalised difference dips under this is the period. The textbook
   * 0.1–0.15 suits clean recordings; on the voice-isolated, mp3-compressed dialogue track it found
   * pitch in only ~30–40 % of a normal line's frames. 0.35 finds ~35–55 % with ≤7 % octave-ish
   * jumps between frames (0.45 jumped up to 11 %). Measured on iDulhoQ2pro, 2026-11-24.
   */
  threshold: 0.35,
  /** Frames quieter than this share of the loud frames' level count as silence. */
  quietShare: 0.12,
  quietFloor: 0.003,
};

/**
 * Scoring scale (tune here). The error is measured against how much the actor's own melody moves:
 * reading the line on one flat note scores ~0, matching it scores 100, so a calm speaker and an
 * animated one are judged on the same scale. (A fixed "6 semitones off = 0" let a flat reading of
 * a calm line score 85 on real audio.)
 * - noiseSt: error that's just measurement noise (a resampled copy of the actor scored 0.25 st off).
 * - minRangeSt: the scale never goes below this, so an almost monotone actor doesn't make every
 *   small wobble count as a big miss.
 */
export const SCORE = { noiseSt: 0.25, minRangeSt: 1 };
/** Fewer voiced frames than this on either side (150 ms) → no score: it would mislead. */
export const MIN_VOICED_FRAMES = 15;

export type Contour = (number | null)[];
export type Intonation = {
  /** 0–100. */
  score: number;
  meanErrorSemitones: number;
  /** DTW path as [actor frame, learner frame] pairs, in the contours' original indices. */
  path: [number, number][];
};

/** Box-averages `x` from `from` Hz down to `to` Hz (no-op if it's already at or below). */
export function downsample(x: Float32Array, from: number, to: number): Float32Array {
  if (from <= to) return x;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(x.length / ratio));
  for (let k = 0; k < out.length; k++) {
    const a = Math.floor(k * ratio);
    const b = Math.max(a + 1, Math.floor((k + 1) * ratio));
    let s = 0;
    for (let i = a; i < b; i++) s += x[i];
    out[k] = s / (b - a);
  }
  return out;
}

function rms(x: Float32Array, start: number, n: number): number {
  let s = 0;
  for (let i = start; i < start + n; i++) s += x[i] * x[i];
  return Math.sqrt(s / n);
}

/** YIN pitch per 10 ms hop (null where unvoiced or silent). */
export function detectPitch(samples: Float32Array, sampleRate: number): Contour {
  const sr = Math.min(sampleRate, PITCH.rate);
  const x = downsample(samples, sampleRate, sr);
  const N = Math.round(PITCH.frameSec * sr);
  const hop = Math.max(1, Math.round(PITCH.hopSec * sr));
  const tauMin = Math.max(2, Math.floor(sr / PITCH.maxHz));
  const tauMax = Math.min(Math.ceil(sr / PITCH.minHz), N - 2);
  const W = N - tauMax; // integration window
  if (x.length < N || W < 8) return [];

  const starts: number[] = [];
  for (let s = 0; s + N <= x.length; s += hop) starts.push(s);
  // Silence: relative to how loud this recording's voiced parts are (mics vary a lot).
  const levels = starts.map((s) => rms(x, s, N));
  const loud = [...levels].sort((a, b) => a - b)[Math.floor(levels.length * 0.9)] ?? 0;
  const quiet = Math.max(PITCH.quietFloor, loud * PITCH.quietShare);

  const d = new Float64Array(tauMax + 1);
  return starts.map((s, f) => {
    if (levels[f] < quiet) return null;
    // Difference function and its cumulative-mean-normalised form (YIN steps 2–3).
    let running = 0;
    d[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const diff = x[s + j] - x[s + j + tau];
        sum += diff * diff;
      }
      running += sum;
      d[tau] = running > 0 ? (sum * tau) / running : 1;
    }
    // Step 4: the first dip under the threshold, then down to its local minimum.
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < PITCH.threshold) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return null;
    // Step 5: parabolic interpolation for a sub-sample period.
    let better = tau;
    if (tau > 1 && tau < tauMax) {
      const [a, b, c] = [d[tau - 1], d[tau], d[tau + 1]];
      const den = a - 2 * b + c;
      if (den > 0) better = tau + (a - c) / (2 * den);
    }
    const hz = sr / better;
    return hz >= PITCH.minHz * 0.9 && hz <= PITCH.maxHz * 1.1 ? hz : null;
  });
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function voicedAround(x: Contour, i: number, r: number, self: boolean): number[] {
  const out: number[] = [];
  for (let k = Math.max(0, i - r); k <= Math.min(x.length - 1, i + r); k++) {
    const v = x[k];
    if (v !== null && (self || k !== i)) out.push(v);
  }
  return out;
}

/** Octave-jump fix, 5-frame median filter, and linear bridging of gaps up to 5 frames. */
export function cleanContour(f0: Contour): Contour {
  // Octave jumps: a frame at ~2× or ~½× its neighbours is YIN locking onto a harmonic.
  const fixed = f0.map((v, i) => {
    if (v === null) return null;
    const m = median(voicedAround(f0, i, 5, false));
    if (!Number.isFinite(m)) return v;
    const r = v / m;
    if (r > 1.75 && r < 2.3) return v / 2;
    if (r > 0.43 && r < 0.57) return v * 2;
    return v;
  });
  // Spikes: median of the voiced frames in a 5-frame window.
  const smooth = fixed.map((v, i) => (v === null ? null : median(voicedAround(fixed, i, 2, true))));
  // Short gaps (a consonant, a breath): bridge them in a straight line. Longer ones stay gaps.
  const out = smooth.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j] === null) j++;
    const before = out[i - 1];
    const after = out[j];
    if (i > 0 && j < out.length && j - i <= 5 && before != null && after != null)
      for (let k = i; k < j; k++) out[k] = before + ((after - before) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  return out;
}

/** Pitch in semitones relative to this speaker's own median (voiced frames only). */
export function toSemitones(f0: Contour): Contour {
  const m = median(f0.filter((v): v is number => v !== null && v > 0));
  return f0.map((v) => (v === null || v <= 0 || !Number.isFinite(m) ? null : 12 * Math.log2(v / m)));
}

/**
 * Dynamic time warping between two curves, limited to a Sakoe–Chiba band around the (length-
 * adjusted) diagonal. `cost` is the mean absolute difference along the best path.
 */
export function dtwAlign(a: number[], b: number[], band: number): { cost: number; path: [number, number][] } {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return { cost: Infinity, path: [] };
  const w = Math.max(band, 1);
  const D = new Float64Array(n * m).fill(Infinity);
  const L = new Uint32Array(n * m); // path length, to average the cost
  const inBand = (i: number, j: number) => Math.abs(j - (n > 1 ? (i * (m - 1)) / (n - 1) : 0)) <= w;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (!inBand(i, j)) continue;
      const c = Math.abs(a[i] - b[j]);
      if (i === 0 && j === 0) {
        D[0] = c;
        L[0] = 1;
        continue;
      }
      let best = Infinity;
      let len = 0;
      for (const [pi, pj] of [[i - 1, j - 1], [i - 1, j], [i, j - 1]]) {
        if (pi < 0 || pj < 0) continue;
        const v = D[pi * m + pj];
        if (v < best) {
          best = v;
          len = L[pi * m + pj];
        }
      }
      if (best === Infinity) continue;
      D[i * m + j] = best + c;
      L[i * m + j] = len + 1;
    }
  }
  // Walk back from the end along the cheapest predecessors.
  const path: [number, number][] = [];
  let i = n - 1;
  let j = m - 1;
  if (D[i * m + j] === Infinity) return { cost: Infinity, path: [] };
  path.push([i, j]);
  while (i > 0 || j > 0) {
    const options: [number, number][] = [[i - 1, j - 1], [i - 1, j], [i, j - 1]];
    let next: [number, number] | null = null;
    let best = Infinity;
    for (const [pi, pj] of options) {
      if (pi < 0 || pj < 0) continue;
      const v = D[pi * m + pj];
      if (v < best) {
        best = v;
        next = [pi, pj];
      }
    }
    if (!next) break;
    [i, j] = next;
    path.push([i, j]);
  }
  path.reverse();
  return { cost: D[(n - 1) * m + (m - 1)] / L[(n - 1) * m + (m - 1)], path };
}

/**
 * How closely the learner's semitone contour follows the actor's, ignoring speed.
 * Null when either side has too little voiced audio to say anything useful.
 */
export function intonationScore(actor: Contour, learner: Contour): Intonation | null {
  const ai = actor.flatMap((v, i) => (v === null ? [] : [i]));
  const li = learner.flatMap((v, i) => (v === null ? [] : [i]));
  if (ai.length < MIN_VOICED_FRAMES || li.length < MIN_VOICED_FRAMES) return null;
  const a = ai.map((i) => actor[i]!);
  const b = li.map((i) => learner[i]!);
  const band = Math.max(2, Math.ceil(0.2 * Math.max(a.length, b.length)));
  const { cost, path } = dtwAlign(a, b, band);
  if (!Number.isFinite(cost)) return null;
  // Error once per actor frame (against the average of the learner frames matched to it), not
  // per path step: averaging along the path let a flat reading "linger" where the actor happened
  // to sit near the middle and look better than it is. This is also what the chart draws.
  const matched = new Float64Array(a.length);
  const count = new Uint32Array(a.length);
  for (const [p, q] of path) {
    matched[p] += b[q];
    count[p]++;
  }
  let err = 0;
  for (let p = 0; p < a.length; p++) err += Math.abs(a[p] - matched[p] / count[p]);
  err /= a.length;
  // What a flat reading would be off by: how far the actor's curve strays from its own middle.
  const mid = median(a);
  const flatErr = a.reduce((s, v) => s + Math.abs(v - mid), 0) / a.length;
  const scale = Math.max(flatErr, SCORE.minRangeSt);
  return {
    score: 100 * Math.max(0, 1 - Math.max(0, err - SCORE.noiseSt) / scale),
    meanErrorSemitones: err,
    path: path.map(([p, q]) => [ai[p], li[q]]),
  };
}

/**
 * One friendly line about the biggest difference: looks at the stretch of the line where the
 * curves differ most and compares which way each one moves there.
 */
export function intonationHint(r: Intonation, actor: Contour, learner: Contour): string {
  if (r.score >= 85) return "Nice: your melody matches theirs.";
  const p = r.path;
  const at = (k: number) => [actor[p[k][0]]!, learner[p[k][1]]!] as const;
  const W = Math.max(5, Math.round(p.length * 0.25));
  if (p.length <= W) return "Close! Follow their rises and falls a little more.";
  // The window along the path with the largest total error.
  let sum = 0;
  for (let k = 0; k < W; k++) sum += Math.abs(at(k)[0] - at(k)[1]);
  let worst = sum;
  let from = 0;
  for (let k = W; k < p.length; k++) {
    sum += Math.abs(at(k)[0] - at(k)[1]) - Math.abs(at(k - W)[0] - at(k - W)[1]);
    if (sum > worst) {
      worst = sum;
      from = k - W + 1;
    }
  }
  const to = from + W - 1;
  const aSlope = at(to)[0] - at(from)[0];
  const lSlope = at(to)[1] - at(from)[1];
  const mid = (from + to) / 2 / p.length;
  const where = mid < 0.34 ? "at the start" : mid < 0.67 ? "in the middle" : "at the end";
  if (aSlope > 1.5 && lSlope <= -1.5) return `You go down where they go up (${where}).`;
  if (aSlope < -1.5 && lSlope >= 1.5) return `You go up where they go down (${where}).`;
  if (aSlope > 1.5 && lSlope < aSlope * 0.4) return `Your pitch stays flat where theirs rises (${where}).`;
  if (aSlope < -1.5 && lSlope > aSlope * 0.4) return `Your pitch stays flat where theirs falls (${where}).`;
  let level = 0;
  for (let k = from; k <= to; k++) level += at(k)[0] - at(k)[1];
  level /= W;
  if (level > 2) return `Go a little higher ${where}.`;
  if (level < -2) return `Go a little lower ${where}.`;
  return "Close! Follow their rises and falls a little more.";
}
