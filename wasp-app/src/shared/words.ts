// Words on screen and when they're heard: splits a line into tappable words (any language,
// including Chinese and Japanese, which have no spaces) and works out when each word plays,
// so "tap a word" can play just that word. A copy of extension/src/words.ts (the scroll uses it
// too); keep the two the same apart from the import path.
import type { Segment } from "./types";

export type Token = { text: string; word: boolean };
export type Span = { start: number; end: number };

/** Splits text into words and the bits between them (spaces, punctuation), keeping every character. */
export function splitWords(text: string, locale?: string): Token[] {
  const seg = new Intl.Segmenter(locale, { granularity: "word" });
  return [...seg.segment(text)].map((s) => ({ text: s.segment, word: !!s.isWordLike }));
}

const LETTER = /[\p{L}\p{N}]/u;
const SENTENCE = /[.?!…。！？]/u;
const CLAUSE = /[,;:，、；：—–]/u;

/** How long a character takes to say, relative to a letter: pauses at punctuation, a little at spaces. */
function weight(ch: string): number {
  if (LETTER.test(ch)) return 1;
  if (SENTENCE.test(ch)) return 4;
  if (CLAUSE.test(ch)) return 2.5;
  if (/\s/u.test(ch)) return 0.5;
  return 0;
}

/** When each character of `text` is heard, spread over [start, end] by how long it takes to say. */
export function spreadTimes(text: string, start: number, end: number): Span[] {
  const chars = [...text];
  const total = chars.reduce((n, c) => n + weight(c), 0) || 1;
  const per = Math.max(0, end - start) / total;
  let at = start;
  return chars.map((c) => {
    const s = at;
    at += weight(c) * per;
    return { start: s, end: at };
  });
}

/**
 * When each character of the segment's text is heard. With Scribe's word timings (videos
 * transcribed after word timings were kept), letters are placed inside their own word; otherwise
 * they're spread over the whole line.
 */
export function charTimes(seg: Pick<Segment, "start" | "end" | "text" | "words">): Span[] {
  const chars = [...seg.text];
  const fallback = () => spreadTimes(seg.text, seg.start, seg.end);
  if (!seg.words?.length) return fallback();
  // Letters in order, each with its time inside its word.
  const letters: Span[] = [];
  for (const w of seg.words) {
    const n = [...w.text].filter((c) => LETTER.test(c)).length;
    for (let k = 0; k < n; k++)
      letters.push({ start: w.start + ((w.end - w.start) * k) / n, end: w.start + ((w.end - w.start) * (k + 1)) / n });
  }
  if (letters.length !== chars.filter((c) => LETTER.test(c)).length) return fallback(); // text was edited
  // Non-letters (spaces, punctuation) sit between their neighbours.
  let li = 0;
  let prevEnd = seg.start;
  return chars.map((c) => {
    if (!LETTER.test(c)) return { start: prevEnd, end: letters[li]?.start ?? seg.end };
    const t = letters[li++];
    prevEnd = t.end;
    return t;
  });
}

/** Each token's span from character times; null for tokens that aren't words. */
export function tokenSpans(tokens: Token[], times: Span[]): (Span | null)[] {
  let at = 0;
  return tokens.map((tok) => {
    const n = [...tok.text].length;
    const from = at;
    at += n;
    if (!tok.word || !n || !times.length) return null;
    const first = times[Math.min(from, times.length - 1)];
    const last = times[Math.min(from + n - 1, times.length - 1)];
    return { start: first.start, end: last.end };
  });
}

/** The word being heard at time t: the last word that has started (so pauses keep it lit), or -1. */
export function tokenAt(spans: (Span | null)[], t: number): number {
  let hit = -1;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (!s) continue;
    if (s.start > t) break;
    hit = i;
  }
  return hit;
}
