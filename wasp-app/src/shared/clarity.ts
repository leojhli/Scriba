// Pronunciation feedback from ElevenLabs Scribe + Claude only (no Azure):
// - clarity: how sure Scribe was of each word you said (its logprob), 0–100. It measures whether a
//   listener would catch the word, which is the point for a learner, but it isn't a per-sound score.
// - the tip: Claude reads the line, what Scribe heard and the clear/unclear words, and suggests the
//   one most likely sound to fix. Claude never hears the audio; it reasons from the transcript.
import { normalize } from "./score";
import type { Word } from "./segments";
import type { ShadowResult } from "./types";

type Diff = ShadowResult["diff"];
type Pron = NonNullable<ShadowResult["pronunciation"]>;

/** A Scribe logprob (≤ 0) as 0–100: the probability Scribe gave the word. */
export const clarityOf = (logprob: number): number => Math.round(100 * Math.exp(Math.min(0, logprob)));

/**
 * Clarity per word of the line, lined up with the word diff. score() builds the diff from the
 * same normalised tokens of what was heard, so walking the diff in order consumes the heard tokens
 * in order: "ok", "wrong" and "extra" each use one, "missed" none. A heard word that normalises to
 * several tokens (a Chinese word → its characters) gives each of them its clarity.
 *
 * `overall`: the average over the line's words, where a missed or wrong word counts as 0.
 * Null when Scribe gave no confidences, or the tokens don't line up (never guess).
 */
export function clarityFromScribe(diff: Diff, heard: Word[]): Pron | null {
  const toks: (number | null)[] = [];
  for (const w of heard) for (const _ of normalize(w.text)) toks.push(w.logprob === undefined ? null : clarityOf(w.logprob));
  const used = diff.filter((d) => d.status !== "missed").length;
  if (!toks.some((c) => c !== null) || toks.length !== used) return null;

  const words: Pron["words"] = [];
  let k = 0;
  let sum = 0;
  let n = 0;
  diff.forEach((d, i) => {
    const c = d.status === "missed" ? null : toks[k++];
    if (d.status === "extra") return; // not part of the line
    n++;
    if (d.status !== "ok") return; // missed or wrong: 0 towards the overall
    const score = c ?? 100;
    sum += score;
    if (c !== null) words.push({ word: d.word, score, i });
  });
  return { overall: n ? Math.round(sum / n) : 0, source: "scribe", words };
}

/** Below this a word counts as unclear (Azure's "mispronounced" line is 60; Scribe is a little stricter). */
export const UNCLEAR = 70;

/** A tip is worth a Claude call when something was missed, wrong, added or unclear (not for silence). */
export function needsTip(diff: Diff, pron: Pron | null, heard: string): boolean {
  if (!heard.trim()) return false;
  return diff.some((d) => d.status !== "ok") || !!pron?.words.some((w) => w.score < UNCLEAR);
}

/** What Claude gets to write the tip from. */
export function tipInput(line: string, heard: string, diff: Diff, pron: Pron | null, language: string | null) {
  const byI = new Map((pron?.words ?? []).map((w) => [w.i, w]));
  return {
    ...(language ? { language } : {}),
    line,
    heard,
    words: diff.map((d, i) => {
      const w = byI.get(i);
      return { word: d.word, status: d.status, ...(w ? { [pron?.source === "azure" ? "pronunciation" : "clarity"]: w.score } : {}) };
    }),
  };
}
