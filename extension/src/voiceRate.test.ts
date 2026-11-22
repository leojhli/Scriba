import { describe, expect, it } from "vitest";
import { nextVoiceRate, rateLabel, VOICE_RATES } from "./voiceRate";

describe("nextVoiceRate", () => {
  it("steps up from normal speed", () => {
    expect(nextVoiceRate(1)).toBe(1.25);
    expect(nextVoiceRate(1.25)).toBe(1.5);
  });

  it("wraps from the fastest back to the slowest", () => {
    expect(nextVoiceRate(2)).toBe(0.75);
    expect(nextVoiceRate(0.75)).toBe(1);
  });

  it("goes all the way round in one cycle", () => {
    let r = 1;
    for (let i = 0; i < VOICE_RATES.length; i++) r = nextVoiceRate(r);
    expect(r).toBe(1);
  });

  it("restarts at 1× from an unknown stored value", () => {
    expect(nextVoiceRate(0.9)).toBe(1);
  });
});

describe("rateLabel", () => {
  it("prints speeds the way video players do", () => {
    expect(VOICE_RATES.map(rateLabel)).toEqual(["0.75×", "1×", "1.25×", "1.5×", "2×"]);
  });
});
