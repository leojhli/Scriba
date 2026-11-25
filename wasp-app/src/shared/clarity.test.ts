import { describe, expect, it } from "vitest";
import { clarityFromScribe, clarityOf, needsTip, tipInput } from "./clarity";
import { score } from "./score";

const w = (text: string, logprob?: number) => ({ text, start: 0, end: 0, ...(logprob === undefined ? {} : { logprob }) });

describe("clarityOf", () => {
  it("turns Scribe's logprob into 0–100", () => {
    expect(clarityOf(0)).toBe(100);
    expect(clarityOf(Math.log(0.5))).toBe(50);
    expect(clarityOf(-20)).toBe(0);
    expect(clarityOf(0.2)).toBe(100); // never above 100
  });
});

describe("clarityFromScribe", () => {
  it("gives each word you said its clarity, accents and punctuation aside", () => {
    const heard = [w("Vamos", Math.log(0.95)), w("a", Math.log(0.9)), w("la", -0.01), w("playa.", Math.log(0.4))];
    const r = score("¡Vamos a la playa!", "Vamos a la playa.", 1, 1);
    const p = clarityFromScribe(r.diff, heard)!;
    expect(p.source).toBe("scribe");
    expect(p.words.map((x) => [x.i, x.word, x.score])).toEqual([
      [0, "vamos", 95],
      [1, "a", 90],
      [2, "la", 99],
      [3, "playa", 40],
    ]);
    expect(p.overall).toBe(81);
  });

  it("counts missed and wrong words as 0 and skips words you added", () => {
    // Expected "vamos a la playa"; heard "vamos la plaza hoy": a missed, playa→plaza wrong, hoy extra.
    const heard = [w("vamos", 0), w("la", 0), w("plaza", Math.log(0.8)), w("hoy", Math.log(0.9))];
    const r = score("vamos a la playa", "vamos la plaza hoy", 1, 1);
    expect(r.diff.map((d) => d.status)).toEqual(["ok", "missed", "ok", "wrong", "extra"]);
    const p = clarityFromScribe(r.diff, heard)!;
    expect(p.words.map((x) => [x.i, x.word, x.score])).toEqual([
      [0, "vamos", 100],
      [2, "la", 100],
    ]);
    expect(p.overall).toBe(50); // (100 + 0 + 100 + 0) / 4
  });

  it("gives a Chinese word's clarity to each of its characters", () => {
    const r = score("你好", "你好", 1, 1);
    const p = clarityFromScribe(r.diff, [w("你好", Math.log(0.6))])!;
    expect(p.words.map((x) => [x.word, x.score])).toEqual([
      ["你", 60],
      ["好", 60],
    ]);
  });

  it("returns null without confidences, or when the words don't line up", () => {
    const r = score("hola amigo", "hola amigo", 1, 1);
    expect(clarityFromScribe(r.diff, [w("hola"), w("amigo")])).toBeNull();
    expect(clarityFromScribe(r.diff, [w("hola", 0)])).toBeNull();
  });
});

describe("needsTip", () => {
  const clear = { overall: 95, source: "scribe" as const, words: [{ word: "hola", score: 95, i: 0 }] };
  it("asks for a tip when a word was unclear, missed or wrong", () => {
    expect(needsTip(score("hola", "hola", 1, 1).diff, { ...clear, words: [{ word: "hola", score: 40, i: 0 }] }, "hola")).toBe(true);
    expect(needsTip(score("hola amigo", "hola", 1, 1).diff, clear, "hola")).toBe(true);
  });
  it("skips it for a clean take, and for silence", () => {
    expect(needsTip(score("hola", "hola", 1, 1).diff, clear, "hola")).toBe(false);
    expect(needsTip(score("hola", "", 1, 1).diff, null, "")).toBe(false);
  });
});

describe("tipInput", () => {
  it("lists every word with its status and clarity", () => {
    const r = score("el perro", "el pero", 1, 1);
    const p = clarityFromScribe(r.diff, [w("el", 0), w("pero", Math.log(0.7))]);
    expect(tipInput("El perro", "el pero", r.diff, p, "spa")).toEqual({
      language: "spa",
      line: "El perro",
      heard: "el pero",
      words: [
        { word: "el", status: "ok", clarity: 100 },
        { word: "perro", status: "wrong" }, // came out as "pero"
      ],
    });
  });
});
