import { describe, expect, it } from "vitest";
import { cleanContour, detectPitch, dtwAlign, intonationHint, intonationScore, toSemitones } from "./pitch";

const SR = 16000;

/** A tone whose frequency follows `hz(t)`, phase-continuous. */
function tone(seconds: number, hz: (t: number) => number, sr = SR, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    phase += (2 * Math.PI * hz(i / sr)) / sr;
    // A couple of harmonics, like a voice, so it isn't a textbook-perfect sine.
    out[i] = amp * (Math.sin(phase) + 0.4 * Math.sin(2 * phase) + 0.2 * Math.sin(3 * phase)) / 1.6;
  }
  return out;
}

const voiced = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe("detectPitch", () => {
  it("finds a steady 220 Hz tone", () => {
    const f0 = voiced(detectPitch(tone(0.6, () => 220), SR));
    expect(f0.length).toBeGreaterThan(40);
    expect(Math.abs(median(f0) - 220)).toBeLessThan(2);
  });

  it("works at the browser's usual 44.1 kHz too", () => {
    const f0 = voiced(detectPitch(tone(0.5, () => 220, 44100), 44100));
    expect(Math.abs(median(f0) - 220)).toBeLessThan(2);
  });

  it("returns only nulls for silence", () => {
    const f0 = detectPitch(new Float32Array(SR / 2), SR);
    expect(f0.length).toBeGreaterThan(0);
    expect(f0.every((x) => x === null)).toBe(true);
  });
});

describe("cleanContour", () => {
  it("keeps a rising chirp rising", () => {
    const f0 = cleanContour(detectPitch(tone(1, (t) => 150 + 150 * t), SR));
    const v = voiced(f0);
    expect(v.length).toBeGreaterThan(60);
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1] - 0.5);
    expect(v[v.length - 1] - v[0]).toBeGreaterThan(100);
  });

  it("fixes an octave jump", () => {
    const f0: (number | null)[] = Array.from({ length: 21 }, () => 200);
    f0[10] = 400;
    f0[11] = 400; // a two-frame jump the median filter alone might keep
    const out = cleanContour(f0);
    expect(out[10]).toBeCloseTo(200, 0);
    expect(out[11]).toBeCloseTo(200, 0);
  });

  it("fills short gaps but leaves long ones", () => {
    const f0: (number | null)[] = [100, 100, 100, null, null, 130, 130, 130, ...Array(8).fill(null), 130, 130, 130];
    const out = cleanContour(f0);
    expect(out[3]).toBeCloseTo(110, 0);
    expect(out[4]).toBeCloseTo(120, 0);
    expect(out[10]).toBeNull();
  });
});

describe("toSemitones", () => {
  it("makes the same melody in a low and a high voice look the same", () => {
    const melody = [1, 1.1, 1.25, 1.2, 1, 0.9];
    const low = toSemitones(melody.map((m) => 110 * m));
    const high = toSemitones(melody.map((m) => 220 * m));
    low.forEach((s, i) => expect(Math.abs(s! - high[i]!)).toBeLessThan(0.1));
  });

  it("keeps unvoiced frames as gaps", () => {
    expect(toSemitones([100, null, 200])[1]).toBeNull();
  });
});

const rise = (n: number) => Array.from({ length: n }, (_, i) => (8 * i) / (n - 1) - 4);

describe("dtwAlign", () => {
  it("lines up a curve with a slower copy of itself at ~no cost", () => {
    const a = rise(40);
    const b = rise(60);
    expect(dtwAlign(a, b, 12).cost).toBeLessThan(0.2);
  });

  it("costs clearly more for a fall against a rise", () => {
    const a = rise(40);
    const b = rise(40).reverse();
    expect(dtwAlign(a, b, 8).cost).toBeGreaterThan(1.5);
  });

  it("walks from start to end", () => {
    const { path } = dtwAlign(rise(10), rise(14), 4);
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([9, 13]);
  });
});

describe("intonationScore", () => {
  const withGaps = (xs: number[]) => xs.map((x, i) => (i % 17 === 5 ? null : x));

  it("scores the same melody ~100, even at a different speed", () => {
    const r = intonationScore(withGaps(rise(40)), withGaps(rise(55)))!;
    expect(r.score).toBeGreaterThan(95);
  });

  it("scores a rise answered with a fall low", () => {
    const r = intonationScore(rise(40), rise(40).reverse())!;
    expect(r.score).toBeLessThan(55);
  });

  it("gives up on too little voiced audio", () => {
    expect(intonationScore(rise(10), rise(40))).toBeNull();
    expect(intonationScore(rise(40), [1, 2, null, null, 3])).toBeNull();
  });

  it("maps the path back to the original frame indices", () => {
    const actor = [null, null, ...rise(20)];
    const r = intonationScore(actor, rise(20))!;
    expect(r.path[0][0]).toBe(2);
  });
});

describe("intonationHint", () => {
  it("says when the learner stays flat where the actor rises", () => {
    const actor = [...Array(20).fill(0), ...rise(20).map((x) => x + 4)];
    const learner = Array(40).fill(0);
    const r = intonationScore(actor, learner)!;
    expect(intonationHint(r, actor, learner)).toMatch(/flat where theirs rises/);
  });

  it("praises a close match", () => {
    const r = intonationScore(rise(30), rise(30))!;
    expect(intonationHint(r, rise(30), rise(30))).toMatch(/match/i);
  });
});
