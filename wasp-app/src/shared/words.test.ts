import { describe, expect, it } from "vitest";
import { charTimes, splitWords, spreadTimes, squeezed, tokenAt, tokenSpans } from "./words";

const words = (text: string) => splitWords(text).filter((t) => t.word).map((t) => t.text);

describe("splitWords", () => {
  it("keeps every character, words and the bits between", () => {
    const t = splitWords("¿Qué onda, güey?");
    expect(t.map((x) => x.text).join("")).toBe("¿Qué onda, güey?");
    expect(words("¿Qué onda, güey?")).toEqual(["Qué", "onda", "güey"]);
  });

  it("finds words in Chinese, which has no spaces", () => {
    const w = words("我们一起去吃饭吧。");
    expect(w.join("")).toBe("我们一起去吃饭吧");
    expect(w.length).toBeGreaterThan(1);
    expect(w.length).toBeLessThan(8); // grouped into words, not one per character
  });
});

describe("spreadTimes", () => {
  it("covers the whole range in order, pausing longer at punctuation", () => {
    const t = spreadTimes("ab. cd", 0, 10);
    expect(t[0].start).toBe(0);
    expect(t[t.length - 1].end).toBeCloseTo(10);
    for (let i = 1; i < t.length; i++) expect(t[i].start).toBeCloseTo(t[i - 1].end);
    const dot = t[2].end - t[2].start;
    expect(dot).toBeGreaterThan(t[0].end - t[0].start);
  });
});

describe("charTimes", () => {
  it("uses Scribe's word timings when the line has them", () => {
    const seg = { start: 1, end: 3, text: "Hola amigo.", words: [{ text: "Hola", start: 1, end: 1.4 }, { text: "amigo.", start: 2, end: 3 }] };
    const spans = tokenSpans(splitWords(seg.text), charTimes(seg));
    expect(spans[0]).toEqual({ start: 1, end: 1.4 });
    expect(spans[2]!.start).toBeCloseTo(2);
    expect(spans[2]!.end).toBeCloseTo(3);
  });

  it("spreads over the line when there are no word timings", () => {
    const seg = { start: 0, end: 4, text: "uno dos" };
    const spans = tokenSpans(splitWords(seg.text), charTimes(seg));
    expect(spans[0]!.start).toBe(0);
    expect(spans[2]!.end).toBeCloseTo(4);
    expect(spans[1]).toBeNull(); // the space
  });

  it("falls back to spreading when the words don't match the text", () => {
    const seg = { start: 0, end: 2, text: "abc", words: [{ text: "abcdef", start: 0, end: 2 }] };
    expect(charTimes(seg)[2].end).toBeCloseTo(2);
  });
});

describe("tokenAt", () => {
  const spans = [{ start: 0, end: 1 }, null, { start: 1.5, end: 2 }];
  it("lights the word being heard and keeps it lit through a pause", () => {
    expect(tokenAt(spans, -1)).toBe(-1);
    expect(tokenAt(spans, 0.5)).toBe(0);
    expect(tokenAt(spans, 1.2)).toBe(0);
    expect(tokenAt(spans, 1.6)).toBe(2);
  });
});

describe("squeezed", () => {
  it("flags a line whose timing is far too short for its text (Scribe stamped every word at once)", () => {
    // 4XCKamWlCEo line 5: six characters in 0.12 s.
    expect(squeezed({ start: 24.48, end: 24.6, text: "名前はなんだ。" })).toBe(true);
    expect(squeezed({ start: 10, end: 10.1, text: "¿Quieres ser un perro?" })).toBe(true);
  });
  it("leaves normal and fast lines alone", () => {
    expect(squeezed({ start: 23.18, end: 24.48, text: "その姿はなんだ？" })).toBe(false);
    expect(squeezed({ start: 21.82, end: 22.3, text: "バカな。" })).toBe(false);
    expect(squeezed({ start: 99.48, end: 102.52, text: "¿Quieres ser un perro de trineo?" })).toBe(false);
    expect(squeezed({ start: 5, end: 5.2, text: "Oh." })).toBe(false); // one short word
  });
});
