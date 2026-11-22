import type { ShadowResult } from "./types";

/** Lowercase, strip accents (NFD + combining marks) and punctuation, split on whitespace. */
export function normalize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

type Diff = ShadowResult["diff"];

/**
 * Word-level LCS between what was expected and what was heard.
 * Matches are "ok". Between matches, expected/heard words are paired up as
 * "wrong" (substitutions); leftovers are "missed" (expected) or "extra" (heard).
 * accuracy = ok / expected words. paceRatio = heardDur / origDur.
 */
export function score(expected: string, heard: string, heardDur: number, origDur: number): ShadowResult {
  const E = normalize(expected);
  const H = normalize(heard);
  const paceRatio = origDur > 0 && heardDur > 0 ? heardDur / origDur : 1;

  // LCS table, dp[i][j] = LCS of E[i..] and H[j..]
  const dp = Array.from({ length: E.length + 1 }, () => new Array<number>(H.length + 1).fill(0));
  for (let i = E.length - 1; i >= 0; i--)
    for (let j = H.length - 1; j >= 0; j--)
      dp[i][j] = E[i] === H[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const diff: Diff = [];
  let i = 0;
  let j = 0;
  let gapE: string[] = [];
  let gapH: string[] = [];
  const flushGap = () => {
    const n = Math.min(gapE.length, gapH.length);
    for (let k = 0; k < gapE.length; k++) diff.push({ word: gapE[k], status: k < n ? "wrong" : "missed" });
    for (let k = n; k < gapH.length; k++) diff.push({ word: gapH[k], status: "extra" });
    gapE = [];
    gapH = [];
  };

  while (i < E.length || j < H.length) {
    if (i < E.length && j < H.length && E[i] === H[j]) {
      flushGap();
      diff.push({ word: E[i], status: "ok" });
      i++;
      j++;
    } else if (j >= H.length || (i < E.length && dp[i + 1][j] >= dp[i][j + 1])) {
      gapE.push(E[i++]);
    } else {
      gapH.push(H[j++]);
    }
  }
  flushGap();

  const ok = diff.filter((d) => d.status === "ok").length;
  return { diff, accuracy: E.length ? ok / E.length : 0, paceRatio };
}
