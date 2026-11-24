import { joinWords, SENTENCE_END } from "./text";
import type { Segment } from "./types";

export type Word = { text: string; start: number; end: number };

const SOFT_BREAK = /[,，、;；:：]$/u;
const SOFT_BREAK_AFTER_S = 6;

/**
 * Groups transcript words into lines. A line ends after a sentence end (. ? ! 。 ！ ？),
 * at any pause longer than `maxGap` seconds, or at a comma once it is already 6 s long
 * (song lyrics and run-on speech). Ids from 0.
 */
export function groupWords(words: Word[], maxGap = 0.8): Segment[] {
  const segs: Segment[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    segs.push({
      id: segs.length,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: joinWords(cur.map((w) => w.text)),
      // Kept so the extension can highlight each word as it plays and play a single tapped word.
      words: cur.map((w) => ({ text: w.text, start: w.start, end: w.end })),
    });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > maxGap) flush();
    cur.push(w);
    if (SENTENCE_END.test(w.text) || (SOFT_BREAK.test(w.text) && w.end - cur[0].start >= SOFT_BREAK_AFTER_S)) flush();
  }
  flush();
  return segs;
}
