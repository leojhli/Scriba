import { describe, expect, it } from "vitest";
import { attachToDiff, azureLocale, parseAssessment } from "./pronunciation";
import { score } from "./score";

// The REST page's layout: scores directly on NBest[0] and on each word.
const FLAT = {
  RecognitionStatus: "Success",
  DisplayText: "Vamos la playa.",
  NBest: [
    {
      Lexical: "vamos la playa",
      Display: "Vamos la playa.",
      AccuracyScore: 82,
      FluencyScore: 90,
      CompletenessScore: 75,
      PronScore: 80.4,
      Words: [
        { Word: "vamos", AccuracyScore: 95, ErrorType: "None", Phonemes: [{ Phoneme: "", AccuracyScore: 98 }, { Phoneme: "", AccuracyScore: 41 }] },
        { Word: "a", AccuracyScore: 0, ErrorType: "Omission" },
        { Word: "la", AccuracyScore: 88, ErrorType: "None" },
        { Word: "playa", AccuracyScore: 52.6, ErrorType: "Mispronunciation" },
      ],
    },
  ],
};

// The SDK JSON layout: scores nested under "PronunciationAssessment", phonemes named.
const NESTED = {
  RecognitionStatus: "Success",
  NBest: [
    {
      Lexical: "ni hao",
      PronunciationAssessment: { AccuracyScore: 70, FluencyScore: 85, CompletenessScore: 100, PronScore: 76 },
      Words: [
        {
          Word: "你好",
          PronunciationAssessment: { AccuracyScore: 70, ErrorType: "None" },
          Phonemes: [
            { Phoneme: "n", PronunciationAssessment: { AccuracyScore: 90 } },
            { Phoneme: "i 3", PronunciationAssessment: { AccuracyScore: 40 } },
          ],
        },
        { Word: "啊", PronunciationAssessment: { AccuracyScore: 99, ErrorType: "Insertion" } },
      ],
    },
  ],
};

describe("azureLocale", () => {
  it("maps Scribe's language codes to a supported locale", () => {
    expect(azureLocale("spa")).toBe("es-ES");
    expect(azureLocale("cmn")).toBe("zh-CN");
    expect(azureLocale("JPN")).toBe("ja-JP");
    expect(azureLocale("en")).toBe("en-US");
  });

  it("returns null for languages Azure can't assess, or none", () => {
    expect(azureLocale("tur")).toBeNull();
    expect(azureLocale(null)).toBeNull();
  });

  it("uses the override for an unknown language or a variant of the same one", () => {
    expect(azureLocale(null, "es-MX")).toBe("es-MX");
    expect(azureLocale("spa", "es-MX")).toBe("es-MX");
    expect(azureLocale("cmn", "es-MX")).toBe("zh-CN"); // a Spanish override doesn't apply to Mandarin
    expect(azureLocale(null, "xx-XX")).toBeNull();
  });
});

describe("parseAssessment", () => {
  it("reads the flat REST layout", () => {
    const a = parseAssessment(FLAT)!;
    expect(a.heard).toBe("vamos la playa");
    expect(a.overall).toBeCloseTo(80.4);
    expect(a.fluency).toBe(90);
    expect(a.completeness).toBe(75);
    expect(a.words.map((w) => [w.word, w.score, w.errorType])).toEqual([
      ["vamos", 95, "None"],
      ["a", 0, "Omission"],
      ["la", 88, "None"],
      ["playa", 52.6, "Mispronunciation"],
    ]);
    expect(a.words[0].phonemes).toEqual([{ p: "", score: 98 }, { p: "", score: 41 }]);
  });

  it("reads the nested SDK layout", () => {
    const a = parseAssessment(NESTED)!;
    expect(a.overall).toBe(76);
    expect(a.words[0]).toEqual({ word: "你好", score: 70, errorType: "None", phonemes: [{ p: "n", score: 90 }, { p: "i 3", score: 40 }] });
    expect(a.words[1].errorType).toBe("Insertion");
  });

  it("returns null when nothing was recognised", () => {
    expect(parseAssessment({ RecognitionStatus: "NoMatch" })).toBeNull();
    expect(parseAssessment({ RecognitionStatus: "Success", NBest: [] })).toBeNull();
    expect(parseAssessment(null)).toBeNull();
  });
});

describe("attachToDiff", () => {
  it("puts each word's score on the matching diff entry, accents and punctuation aside", () => {
    const a = parseAssessment(FLAT)!;
    const r = score("¡Vamos a la playa!", a.heard, 1, 1);
    expect(r.diff.map((d) => d.status)).toEqual(["ok", "missed", "ok", "ok"]);
    const p = attachToDiff(r.diff, a);
    expect(p.overall).toBe(80);
    expect(p.words.map((w) => [w.i, w.word, w.score])).toEqual([
      [0, "vamos", 95],
      [1, "a", 0],
      [2, "la", 88],
      [3, "playa", 53],
    ]);
  });

  it("spreads a Chinese word over its characters and skips inserted words", () => {
    const a = parseAssessment(NESTED)!;
    const r = score("你好", "你好啊", 1, 1);
    const p = attachToDiff(r.diff, a);
    expect(p.words.map((w) => [w.i, w.word, w.score])).toEqual([
      [0, "你", 70],
      [1, "好", 70],
    ]);
    expect(p.words[0].phonemes?.[1]).toEqual({ p: "i 3", score: 40 });
  });

  it("leaves words it can't match unscored instead of guessing", () => {
    const a = parseAssessment(FLAT)!;
    const r = score("hola amigo", "hola amigo", 1, 1);
    expect(attachToDiff(r.diff, a).words).toEqual([]);
  });
});
