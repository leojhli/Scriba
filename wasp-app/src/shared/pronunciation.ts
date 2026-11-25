// Azure Speech Pronunciation Assessment: the pure parts (locale mapping, reading the response,
// lining its words up with our word diff). The HTTP call is in src/server/azure.ts.
import { normalize } from "./score";
import type { ShadowResult } from "./types";

export type Pronunciation = NonNullable<ShadowResult["pronunciation"]>;

/** Locales Azure supports for pronunciation assessment (docs, 2026-11). */
const SUPPORTED = new Set([
  "ar-EG", "ar-SA", "ca-ES", "zh-HK", "zh-CN", "zh-TW", "da-DK", "nl-NL", "en-AU", "en-CA", "en-IN", "en-GB", "en-US",
  "fi-FI", "fr-CA", "fr-FR", "de-DE", "hi-IN", "it-IT", "ja-JP", "ko-KR", "ms-MY", "nb-NO", "pl-PL", "pt-BR", "pt-PT",
  "ru-RU", "es-MX", "es-ES", "sv-SE", "ta-IN", "th-TH", "vi-VN",
]);

// Scribe reports ISO 639-3 ("spa", "cmn"); accept ISO 639-1 too. One default locale per language.
const LOCALE: Record<string, string> = {
  spa: "es-ES", es: "es-ES", cmn: "zh-CN", zho: "zh-CN", zh: "zh-CN", yue: "zh-HK", jpn: "ja-JP", ja: "ja-JP",
  kor: "ko-KR", ko: "ko-KR", fra: "fr-FR", fr: "fr-FR", deu: "de-DE", de: "de-DE", ita: "it-IT", it: "it-IT",
  por: "pt-BR", pt: "pt-BR", eng: "en-US", en: "en-US", rus: "ru-RU", ru: "ru-RU", ara: "ar-SA", ar: "ar-SA",
  hin: "hi-IN", hi: "hi-IN", vie: "vi-VN", vi: "vi-VN", tha: "th-TH", th: "th-TH", nld: "nl-NL", nl: "nl-NL",
  pol: "pl-PL", pl: "pl-PL", dan: "da-DK", da: "da-DK", fin: "fi-FI", fi: "fi-FI", swe: "sv-SE", sv: "sv-SE",
  nob: "nb-NO", nor: "nb-NO", nb: "nb-NO", no: "nb-NO", cat: "ca-ES", ca: "ca-ES", msa: "ms-MY", zsm: "ms-MY",
  ms: "ms-MY", tam: "ta-IN", ta: "ta-IN",
};

/**
 * The Azure locale for a video's language (Scribe's code), or null if pronunciation assessment
 * doesn't support it. `override` (AZURE_SPEECH_LOCALE) is used when the language is unknown, or
 * to pick a variant (e.g. es-MX) when it's the same language.
 */
export function azureLocale(language: string | null | undefined, override?: string | null): string | null {
  const fromVideo = language ? LOCALE[language.toLowerCase()] : undefined;
  const ov = override?.trim();
  if (ov && SUPPORTED.has(ov) && (!fromVideo || fromVideo.slice(0, 2) === ov.slice(0, 2))) return ov;
  return fromVideo && SUPPORTED.has(fromVideo) ? fromVideo : null;
}

export type AzureWord = {
  word: string;
  score: number;
  /** None, Omission, Insertion, Mispronunciation (and prosody types for en-US). */
  errorType: string;
  phonemes?: { p: string; score: number }[];
};
export type Assessment = {
  /** What Azure recognised (scored against the line with our usual word diff). */
  heard: string;
  overall: number;
  accuracy?: number;
  fluency?: number;
  completeness?: number;
  words: AzureWord[];
};

type Obj = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
// The docs show both layouts: scores directly on the object (REST page) or nested under
// "PronunciationAssessment" (SDK JSON). Read whichever is there.
const field = (o: Obj, k: string): unknown => o[k] ?? obj(o.PronunciationAssessment)[k];

/** Reads Azure's detailed JSON. Null when nothing was recognised (silence, NoMatch…). */
export function parseAssessment(json: unknown): Assessment | null {
  const root = obj(json);
  if (root.RecognitionStatus !== undefined && root.RecognitionStatus !== "Success") return null;
  const best = obj((root.NBest as unknown[] | undefined)?.[0]);
  const overall = num(field(best, "PronScore")) ?? num(field(best, "AccuracyScore"));
  if (overall === undefined) return null;
  const words: AzureWord[] = ((best.Words as unknown[] | undefined) ?? []).map((w) => {
    const o = obj(w);
    const phonemes = ((o.Phonemes as unknown[] | undefined) ?? []).flatMap((p) => {
      const po = obj(p);
      const s = num(field(po, "AccuracyScore"));
      return s === undefined ? [] : [{ p: typeof po.Phoneme === "string" ? po.Phoneme : "", score: s }];
    });
    return {
      word: String(o.Word ?? ""),
      score: num(field(o, "AccuracyScore")) ?? 0,
      errorType: String(field(o, "ErrorType") ?? "None"),
      ...(phonemes.length ? { phonemes } : {}),
    };
  });
  const heard = String(best.Lexical ?? best.Display ?? root.DisplayText ?? "");
  return {
    heard,
    overall,
    accuracy: num(field(best, "AccuracyScore")),
    fluency: num(field(best, "FluencyScore")),
    completeness: num(field(best, "CompletenessScore")),
    words,
  };
}

/**
 * Lines Azure's per-word scores up with our word diff (same normalisation, so "¿Qué?" = "que";
 * a Chinese word like 你好 covers the diff's 你 and 好). Each scored word carries `i`, its index
 * in `diff`. Words the learner left out score 0; inserted words (not in the line) are skipped.
 */
export function attachToDiff(diff: ShadowResult["diff"], a: Assessment): Pronunciation {
  // One entry per normalised token of the line, in order.
  const tokens: { t: string; w: AzureWord }[] = [];
  for (const w of a.words) {
    if (w.errorType === "Insertion") continue;
    for (const t of normalize(w.word)) tokens.push({ t, w });
  }
  const words: Pronunciation["words"] = [];
  let k = 0;
  diff.forEach((d, i) => {
    if (d.status === "extra") return; // a word you added: not part of the line
    // Find this expected word among the next few tokens (they should line up one to one).
    for (let look = k; look < Math.min(tokens.length, k + 4); look++) {
      if (tokens[look].t !== d.word) continue;
      const w = tokens[look].w;
      const score = w.errorType === "Omission" ? 0 : Math.round(w.score);
      words.push({ word: d.word, score, i, ...(w.phonemes ? { phonemes: w.phonemes } : {}) });
      k = look + 1;
      return;
    }
  });
  return {
    overall: Math.round(a.overall),
    ...(a.fluency !== undefined ? { fluency: Math.round(a.fluency) } : {}),
    ...(a.completeness !== undefined ? { completeness: Math.round(a.completeness) } : {}),
    words,
  };
}
