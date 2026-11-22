import { describe, expect, it } from "vitest";
import { normalize, score } from "./score";

describe("normalize", () => {
  it("strips accents, punctuation and case", () => {
    expect(normalize("¿Qué haces aquí?")).toEqual(["que", "haces", "aqui"]);
    expect(normalize("  ¡Vamos,   ya!  ")).toEqual(["vamos", "ya"]);
  });
});

describe("score", () => {
  it("matches across accents and punctuation", () => {
    const r = score("¿Qué haces aquí?", "que haces aqui", 1, 1);
    expect(r.accuracy).toBe(1);
    expect(r.diff.every((d) => d.status === "ok")).toBe(true);
  });

  it("marks a dropped word as missed", () => {
    const r = score("vamos a la playa", "vamos la playa", 1, 1);
    expect(r.accuracy).toBe(0.75);
    expect(r.diff).toEqual([
      { word: "vamos", status: "ok" },
      { word: "a", status: "missed" },
      { word: "la", status: "ok" },
      { word: "playa", status: "ok" },
    ]);
  });

  it("silence scores 0 with every word missed", () => {
    const r = score("vamos a la playa", "", 1, 1);
    expect(r.accuracy).toBe(0);
    expect(r.diff.map((d) => d.status)).toEqual(["missed", "missed", "missed", "missed"]);
  });

  it("reports the pace ratio", () => {
    expect(score("hola", "hola", 1.5, 1).paceRatio).toBe(1.5);
  });

  it("marks substitutions as wrong and leftovers as extra", () => {
    const r = score("vamos a la playa", "vamos a el playa ahora", 1, 1);
    expect(r.diff.map((d) => d.status)).toEqual(["ok", "ok", "wrong", "ok", "extra"]);
    expect(r.accuracy).toBe(0.75);
  });

  it("scores Chinese per character", () => {
    expect(score("这么多年", "这么多年", 1, 1).accuracy).toBe(1);
    const r = score("这么多年", "这么年", 1, 1);
    expect(r.accuracy).toBe(0.75);
    expect(r.diff.find((d) => d.status === "missed")?.word).toBe("多");
  });

  it("ignores Chinese punctuation and spacing", () => {
    expect(score("你现在好不好？", "你 现在 好不好", 1, 1).accuracy).toBe(1);
  });

  it("never divides by zero", () => {
    expect(score("", "", 0, 0)).toEqual({ diff: [], accuracy: 0, paceRatio: 1 });
  });
});
