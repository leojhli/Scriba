import { describe, expect, it } from "vitest";
import { detectStruggles } from "./struggle";

describe("detectStruggles", () => {
  it("a 5 s backward seek is a rewind", () => {
    expect(detectStruggles([{ type: "seek", from: 40, t: 35, at: 0 }])).toEqual([
      { kind: "rewind", t: 35, weight: 2 },
    ]);
  });

  it("a forward seek is not a struggle", () => {
    expect(detectStruggles([{ type: "seek", from: 40, t: 70, at: 0 }])).toEqual([]);
  });

  it("a jump of more than 30 s back is navigation", () => {
    expect(detectStruggles([{ type: "seek", from: 100, t: 50, at: 0 }])).toEqual([]);
  });

  it("a jump of less than 2 s back is jitter", () => {
    expect(detectStruggles([{ type: "seek", from: 40, t: 39, at: 0 }])).toEqual([]);
  });

  it("a second rewind to the same spot within 60 s is a replay", () => {
    const s = detectStruggles([
      { type: "seek", from: 40, t: 35, at: 0 },
      { type: "seek", from: 41, t: 36, at: 20000 },
    ]);
    expect(s.map((x) => x.kind)).toEqual(["rewind", "replay"]);
    expect(s[1]).toEqual({ kind: "replay", t: 36, weight: 3 });
  });

  it("a second rewind after 60 s of wall time is a plain rewind", () => {
    const s = detectStruggles([
      { type: "seek", from: 40, t: 35, at: 0 },
      { type: "seek", from: 41, t: 36, at: 61000 },
    ]);
    expect(s.map((x) => x.kind)).toEqual(["rewind", "rewind"]);
  });

  it("slowing down below 1x is a struggle, speeding up is not", () => {
    expect(detectStruggles([{ type: "rate", t: 10, value: 0.75, at: 0 }])).toEqual([
      { kind: "slowdown", t: 10, weight: 1 },
    ]);
    expect(detectStruggles([{ type: "rate", t: 10, value: 1.5, at: 0 }])).toEqual([]);
  });

  it("pauses and captions-on count, captions-off and play do not", () => {
    const s = detectStruggles([
      { type: "pause", t: 12, at: 0 },
      { type: "play", t: 12, at: 1 },
      { type: "captions", t: 13, on: true, at: 2 },
      { type: "captions", t: 14, on: false, at: 3 },
    ]);
    expect(s).toEqual([
      { kind: "pause", t: 12, weight: 1 },
      { kind: "captions", t: 13, weight: 1 },
    ]);
  });
});
